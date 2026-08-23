import { is1RMEligible, isWarmupRow, modeForSet, historyUnitCompatible, historyEntryCompatible } from './workout-model.js'
// Estimated one-rep max (issue #18).
//
// Deliberately knows nothing about the exercise database: an estimate needs a weight AND a
// rep count, and only reps-mode sets carry both. Cardio sets ({min, speed}) and timed sets
// ({sec, w}) therefore drop out of every scan here on their own — there is no exercise-type
// check to keep in sync.
//
// Formulas are the usual submaximal-load estimators. Epley is the default because it is the
// one most lifters have seen; all of them agree closely at low reps and diverge as reps rise,
// which is exactly why REP_CAP exists.

// Above this many reps an estimate says more about work capacity than about maximal strength,
// and the formulas disagree by double digits. Refusing to guess beats printing a fantasy.
export const REP_CAP = 12

export const FORMULAS = {
  // Epley 1985 — w · (1 + r/30)
  epley: (w, r) => w * (1 + r / 30),
  // Brzycki 1993 — w · 36/(37 − r); undefined at r ≥ 37, but REP_CAP is far below that
  brzycki: (w, r) => w * 36 / (37 - r),
  // Lombardi 1989 — w · r^0.10
  lombardi: (w, r) => w * Math.pow(r, 0.1)
}
export const DEFAULT_FORMULA = 'epley'

export const PERCENTAGE_SOURCES = ['adaptive', 'latest']
export const E1RM_FULL_RETENTION_MS = 21 * 24 * 60 * 60 * 1000
export const E1RM_HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000
export const E1RM_FLOOR = 0.5

/** Canonical source for a percentage prescription; absent/legacy values use Adaptive. */
export function normalizePercentageSource(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (token === 'latest' || token === 'latest-session' || token === 'latest_session') return 'latest'
  return 'adaptive'
}

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or more reps than REP_CAP.
// A single rep is not an estimate — it is the measurement — and comes back unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null
  if (reps > REP_CAP) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const est = reps === 1 ? weight : fn(weight, Math.round(reps))
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(entry, formula = DEFAULT_FORMULA) {
  let best = null
  ;(entry?.sets || []).forEach(s => {
    if (!s.done || isWarmupRow(s)) return
    const est = estimate1RM(s.w, s.r, formula)
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(s.w), r: Math.round(Number(s.r)) }
  })
  return best
}

// Canonical input for theoretical prescriptions: a completed Work reps row that passes the
// model's unit/mode/load checks and the same estimator used everywhere else in this module.
// A bare history-set array has no parent target; an explicitly reps-labelled row may therefore
// override a caller's target mode, while an unlabelled row under a timed target remains ineligible.
export function bestEligibleSetOf(entry, formula = DEFAULT_FORMULA, expectedUnit = null, fallbackTarget = null) {
  const sets = Array.isArray(entry) ? entry : (entry?.sets || [])
  const parentTarget = Array.isArray(entry) ? fallbackTarget : (entry?.target || entry)
  let best = null
  sets.forEach(set => {
    const mode = modeForSet(set, parentTarget || set)
    const target = Array.isArray(entry) && parentTarget && parentTarget.mode !== 'reps' && mode === 'reps'
      ? { ...parentTarget, mode: 'reps' }
      : parentTarget
    if (!is1RMEligible(set, target, expectedUnit)) return
    const est = estimate1RM(set.w, set.r, formula)
    if (est !== null && (!best || est > best.est)) {
      best = { est, w: Number(set.w), r: Math.round(Number(set.r)), set }
    }
  })
  return best
}

function workoutTimestamp(workout, index) {
  if (typeof workout?.d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(workout.d)) {
    const day = Date.parse(workout.d.slice(0, 10) + 'T12:00:00Z')
    if (Number.isFinite(day)) return day
  }
  const start = Number(workout?.start)
  return Number.isFinite(start) ? start : index
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function retentionForAge(ageMs) {
  const age = Math.max(0, Number(ageMs) || 0)
  if (age <= E1RM_FULL_RETENTION_MS) return 1
  return Math.max(E1RM_FLOOR, 0.5 ** ((age - E1RM_FULL_RETENTION_MS) / E1RM_HALF_LIFE_MS))
}

function median(values) {
  const ordered = values.slice().sort((a, b) => a - b)
  if (!ordered.length) return null
  const middle = Math.floor(ordered.length / 2)
  return round1(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2)
}

function optionsFor(formulaOrOptions) {
  if (typeof formulaOrOptions === 'string') return { formula: formulaOrOptions, options: {} }
  const options = formulaOrOptions && typeof formulaOrOptions === 'object' ? formulaOrOptions : {}
  return { formula: options.formula || DEFAULT_FORMULA, options }
}

/** Best eligible estimate for each compatible completed session, newest first. */
export function eligible1RMSessions(S, exId, formula = DEFAULT_FORMULA) {
  const expectedUnit = S?.unit || null
  const sessions = []
  ;(S?.workouts || []).forEach((workout, index) => {
    if (!historyUnitCompatible(workout, expectedUnit)) return
    const entries = Array.isArray(workout?.entries) ? workout.entries : []
    let bestSession = null
    for (const entry of entries) {
      if (entry?.id !== exId || !historyEntryCompatible(entry, expectedUnit, workout.unit)) continue
      const target = entry.target || entry
      if (target?.mode && target.mode !== 'reps') continue
      const best = bestEligibleSetOf(entry, formula, expectedUnit, { ...target, mode: 'reps' })
      if (best && (!bestSession || best.est > bestSession.est)) bestSession = best
    }
    if (bestSession) sessions.push({ date: workout.d || null, timestamp: workoutTimestamp(workout, index), index, ...bestSession })
  })
  return sessions.sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)
}

/** Explain the canonical percentage source, including the inputs used by Adaptive. */
export function percentage1RMDetailsForExercise(S, exId, source = 'adaptive', formulaOrOptions = {}) {
  const { formula, options } = optionsFor(formulaOrOptions)
  const sessions = eligible1RMSessions(S, exId, formula)
  if (!sessions.length) return null
  const normalized = normalizePercentageSource(source)
  const selected = normalized === 'latest' ? sessions.slice(0, 1) : sessions.slice(0, 3)
  const medianEstimate = median(selected.map(session => session.est))
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const latest = selected[0]
  const retention = normalized === 'latest' ? 1 : retentionForAge(now - latest.timestamp)
  const estimate = round1(medianEstimate * retention)
  return {
    source: normalized,
    sessions: selected,
    median: medianEstimate,
    latestDate: latest.date,
    latestTimestamp: latest.timestamp,
    ageMs: Math.max(0, now - latest.timestamp),
    retention,
    estimate
  }
}

/** Resolve a percentage prescription from exact-id, mode, and unit-compatible history. */
export function percentage1RMForExercise(S, exId, source = 'adaptive', formulaOrOptions = {}) {
  return percentage1RMDetailsForExercise(S, exId, source, formulaOrOptions)?.estimate ?? null
}

/** Canonical Adaptive e1RM used by current-strength consumers and percentage loads. */
export function adaptive1RMForExercise(S, exId, now, formula = DEFAULT_FORMULA) {
  return percentage1RMForExercise(S, exId, 'adaptive', { now, formula })
}

// One point per workout in which the exercise produced an estimate — feeds the trend chart.
// Chronological, matching the order workouts are appended in.
export function e1rmSeries(S, exId, formula = DEFAULT_FORMULA) {
  const pts = []
  ;(S.workouts || []).forEach(w => {
    const entry = w.entries.find(e => e.id === exId)
    if (!entry) return
    const best = bestSetOf(entry, formula)
    if (best) pts.push({ t: w.start, d: w.d, y: best.est, w: best.w, r: best.r })
  })
  return pts
}

// All-time best estimate for an exercise, with the set and date it came from — the source
// matters, because "142.5 kg est. from 100×10" is a very different claim from "from 140×1".
export function best1RM(S, exId, formula = DEFAULT_FORMULA) {
  let best = null
  e1rmSeries(S, exId, formula).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t } })
  return best
}

// Did this workout beat every estimate that came before it? Used for the finish summary,
// so it compares against history that does not yet contain `w`.
export function is1RMRecord(S, exId, entry, formula = DEFAULT_FORMULA) {
  const now = bestSetOf(entry, formula)
  if (!now) return null
  const prev = best1RM(S, exId, formula)
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null
}
