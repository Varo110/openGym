// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { isoOf, weekKey, fmtNum } from './format.js'
import { isCardio, isBodyweightEq } from './exercises.js'
import { normalizePhase, modeForSet, modeForEntry, setVolume, workoutVolumeFromEntries, historyUnitCompatible, historyEntryCompatible, cachedWeightFor, isWarmupRow, isWorkRow, isAmrapRoleEligibleSet, normalizeWeightPrescription } from './workout-model.js'
import { workRowsForMode } from './workout-runtime.js'
import { bestEligibleSetOf } from './onerm.js'
import { isProgrammeSession } from './partial.js'
// i18n-core, not i18n: this file is imported by mcp/, which is plain Node with no Vite and no
// React. i18n.js is the Vite half — import.meta.glob over the locale packs, useSyncExternalStore
// for the hook — and it re-exports this very `t` from core, so nothing changes here except what
// gets dragged along behind it.
import { t } from './i18n-core.js'

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  if (cfg && (cfg.sec != null || cfg.seconds != null || cfg.durationSec != null)) return 'time'
  if (cfg && (cfg.min != null || cfg.speed != null)) return 'cardio'
  return isCardio(cfg && cfg.id) ? 'cardio' : 'reps'
}
export const isTimed = cfg => modeOf(cfg) === 'time'

/** Mode of a workout entry, including records that predate explicit targets. */
export function entryMode(entry) {
  return modeForEntry(entry, modeOf({ id: entry?.id }))
}

// Two flags that ride on top of a mode rather than making new ones (issues #31/#32), because
// "bodyweight" and "per side" are true of a rep set and of a timed hold alike:
//   bodyweight — the exercise carries no load of its own, so `w` means *added* weight and is
//                asked for only once you say there is some. Seeded from the equipment field.
//                Spelled out rather than `bw`, which a workout already uses for the weigh-in
//                it was logged at — two different things one letter apart is a bug waiting.
//   side       — the exercise is unilateral. You still log what you did: 16, the total across
//                both sides. The split is derived for planning ("8 per side"), never entered
//                — a number that sometimes means one side and sometimes both is the thing
//                that made this ambiguous in the first place, and one rep count that always
//                means the same thing beats two that need a legend.
// Both are absent on every plan, workout and backup written before they existed, and absent
// reads as false, so nothing needs migrating.
export const isBw = cfg => (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : isBodyweightEq(cfg && cfg.id))
export const isPerSide = cfg => !!(cfg && cfg.side)
// What one side did, for display only. Half of an odd total is shown as it falls (8.5) rather
// than rounded away: it means the sides were not even, which is worth seeing.
export const sideReps = reps => (reps || 0) / 2
// Unilateral work moves in pairs, so its rep target steps by two — 16, 18, 20 — and a total
// that stayed odd would put a rep on one side and not the other.
export const repStep = cfg => (isPerSide(cfg) ? 2 : 1)

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export const EFFORT = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 }
}
// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(kind, cur, dir) {
  const e = EFFORT[kind]
  if (!e) return cur ?? null
  if (cur == null) return dir < 0 ? null : e.min
  const n = Math.round((cur + dir * e.step) * 100) / 100
  if (dir < 0 && n < e.min) return null
  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n)
}
// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind, v) =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v))
// Which scale a profile logs. `showRir` is the boolean this replaced and is only consulted
// when the profile has no answer of its own — an explicit 'none' has to win over it, or a
// backup or another device that still carries the old flag would switch the column back on.
export const effortOf = S => {
  const e = S && S.effort
  return e === 'none' || EFFORT[e] ? e : (S && S.showRir ? 'rir' : 'none')
}
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id, s, cfg) {
  const c = cfg || { id }
  // Row mode is authoritative when a phase uses a different mode from its parent target.
  // Preserve the old id-only cardio fallback for legacy callers.
  const mode = !cfg && isCardio(id) ? 'cardio' : modeForSet(s, c)
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '')
  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  // A per-side set needs no mark here: the number logged is the total, the same as every
  // other set in the app.
  const reps = s.r || 0
  if (isBw({ ...c, id: c.id ?? id })) {
    const load = s.w > 0 ? `+${fmtNum(s.w)} × ` : ''
    return `${load}${reps}` + effortTail(s)
  }
  return `${fmtNum(s.w || 0)}×${reps}` + effortTail(s)
}
// Default config for a freshly added exercise.
export function defaultConfig(id, mode) {
  const m = mode || modeOf({ id })
  if (m === 'cardio') return { sets: 1, min: 20, speed: 8 }
  // Written only when it is true, so a barbell config is byte-for-byte what it was before
  // the flag existed and a plan file gains nothing it does not need.
  const bw = isBodyweightEq(id) ? { bodyweight: true } : {}
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw }
}
// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg, unit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  const load = cfg.weight ? ' · ' + (isBw(cfg) ? '+' : '') + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  // This is the line with room for it, so the split is spelled out: "3 × 16 · 8/side".
  const split = isPerSide(cfg) ? ' · ' + t('{0}/side', fmtNum(sideReps(cfg.reps))) : ''
  return `${n} × ${cfg.reps}${load}${split}`
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
}

const occurrenceIdForHistoryEntry = (entry, index) => entry?.occurrenceId || `${entry?.id ?? 'entry'}#${index + 1}`

function matchingHistoryEntries(workout, exId) {
  return (Array.isArray(workout?.entries) ? workout.entries : [])
    .filter(entry => entry?.id === exId)
    .map((entry, index) => ({ entry, index }))
}

function selectHistoryEntry(workout, exId, occurrenceId) {
  const candidates = matchingHistoryEntries(workout, exId)
  if (!occurrenceId) return candidates[0]?.entry || null
  return candidates.find(({ entry, index }) => occurrenceIdForHistoryEntry(entry, index) === occurrenceId)?.entry || null
}

export function lastEntryFor(S, exId, desiredMode, occurrenceId = null) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const workout = S.workouts[i]
    if (!historyUnitCompatible(workout, S.unit)) continue
    const en = selectHistoryEntry(workout, exId, occurrenceId)
    if (en && !historyEntryCompatible(en, S.unit, workout.unit)) continue
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    const workSets = en
      ? (desiredMode
        ? workRowsForMode(en, desiredMode)
        : en.sets.filter(isWorkRow))
        .filter(s => s.done === true)
      : []
    if (workSets.length) return { d: workout.d, sets: workSets, target: en.target || null, occurrenceId: occurrenceId || occurrenceIdForHistoryEntry(en, matchingHistoryEntries(workout, exId).findIndex(item => item.entry === en)) }
  }
  return null
}

// Completed, exact-id performance history for compact UI surfaces. Unlike `lastEntryFor`, this
// keeps the last few compatible sessions and carries only display-safe derived fields: completed
// work rows, the session date, and an optional reps-only estimate. It deliberately does not return
// the original entry, so notes, cues, timers, and other private/configuration fields cannot leak
// into a history summary or a plan payload.
export function lastPerformancesFor(S, exId, desiredMode, occurrenceId = null, limit = 3) {
  const mode = desiredMode === 'time' || desiredMode === 'cardio' || desiredMode === 'reps' ? desiredMode : null
  const rows = []
  const workouts = Array.isArray(S?.workouts) ? S.workouts : []
  const maximum = Math.max(1, Number(limit) || 3)
  for (let wi = workouts.length - 1; wi >= 0 && rows.length < maximum; wi--) {
    const workout = workouts[wi]
    if (!historyUnitCompatible(workout, S?.unit)) continue
    const matches = matchingHistoryEntries(workout, exId)
    const candidates = occurrenceId
      ? matches.filter(({ entry, index }) => occurrenceIdForHistoryEntry(entry, index) === occurrenceId)
      : matches.slice(0, 1)
    for (const { entry, index } of candidates) {
      if (!historyEntryCompatible(entry, S?.unit, workout.unit)) continue
      const resolvedMode = mode || modeOf({ ...(entry.target || {}), id: exId })
      const sets = workRowsForMode(entry, resolvedMode).filter(set => set?.done === true)
      if (!sets.length) continue
      const safe = {
        date: workout.d || null,
        occurrenceId: occurrenceId || occurrenceIdForHistoryEntry(entry, index),
        mode: resolvedMode,
        ...(entry.target?.bodyweight != null ? { bodyweight: !!entry.target.bodyweight } : {}),
        sets: sets.map(set => ({ ...set })),
      }
      if (resolvedMode === 'reps') {
        const best = bestEligibleSetOf({ ...entry, target: { ...(entry.target || {}), mode: 'reps' }, sets }, 'epley', S?.unit)
        if (best) safe.e1rm = best.est
      }
      rows.push(safe)
      break
    }
  }
  return rows.map((performance, index) => {
    const olderBest = rows.slice(index + 1).reduce((best, item) => Math.max(best, Number(item.e1rm) || 0), 0)
    return { ...performance, ...(performance.e1rm != null && performance.e1rm > olderBest ? { pr: true } : {}) }
  })
}

const plannedNumber = (value, fallback = null) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function plannedPrescription(target) {
  const prescription = normalizeWeightPrescription(target, target?.weight)
  if (!prescription || !['fixed', 'percentage'].includes(prescription.kind)) return null
  return { ...prescription }
}

function plannedWarmupRows(rows) {
  if (!Array.isArray(rows)) return null
  return rows.map(row => {
    const mode = row?.mode === 'time' ? 'time' : 'reps'
    const value = Math.max(1, Math.round(plannedNumber(mode === 'time' ? row?.sec : row?.reps, mode === 'time' ? 30 : 8)))
    const prescription = plannedPrescription(row)
    const rest = plannedNumber(row?.restSec)
    return {
      ...(row?.phase ? { phase: normalizePhase(row.phase, 'warmup') } : {}), mode,
      ...(mode === 'time' ? { sec: value } : { reps: value }),
      ...(prescription ? { weightPrescription: prescription } : {}),
      ...(rest != null ? { restSec: Math.round(rest) } : {})
    }
  })
}

/** Project only reusable plan fields from the latest safe completed setup. */
export function lastSetupFor(S, exId, desiredMode) {
  const mode = desiredMode === 'time' ? 'time' : desiredMode === 'reps' ? 'reps' : null
  if (!mode || !Array.isArray(S?.workouts)) return null
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const workout = S.workouts[i]
    if (workout?.complete === false || workout?.plannedComplete === false || workout?.partial === true) continue
    if (!historyUnitCompatible(workout, S?.unit)) continue
    const entries = Array.isArray(workout?.entries) ? workout.entries : []
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex--) {
      const entry = entries[entryIndex]
    if (!entry || entry.id !== exId) continue
    const target = entry?.target
    if (!target || typeof target !== 'object' || Array.isArray(target)) continue
    if (entry.complete === false || entry.plannedComplete === false || entry.partial === true) continue
    if (!historyEntryCompatible(entry, S?.unit, workout.unit) || modeOf({ ...target, id: exId }) !== mode) continue
    if (!(entry.sets || []).some(set => isWorkRow(set) && modeForSet(set, target) === mode && set?.done === true)) continue

    const sets = Math.max(1, Math.round(plannedNumber(target.sets, 1)))
    const value = Math.max(1, Math.round(plannedNumber(mode === 'time' ? target.sec : target.reps, mode === 'time' ? 45 : 10)))
    const amrap = target.kind === 'amrap'
    const roles = (entry.sets || []).map((set, index) => ({ set, index })).filter(({ index }) => isAmrapRoleEligibleSet(entry, index))
    const explicitRoles = roles.some(({ set }) => Object.prototype.hasOwnProperty.call(set || {}, 'amrapRole'))
    const prescription = plannedPrescription(target)
    const warmup = plannedWarmupRows(target.warmup)
    const config = {
      mode, sets, ...(mode === 'time' ? { sec: value } : { reps: value }),
      ...(amrap ? { kind: 'amrap' } : target.kind === 'fixed' ? { kind: 'fixed' } : {}),
      ...(amrap && mode === 'reps' ? { amrapMinReps: Math.max(1, Math.round(plannedNumber(target.amrapMinReps, value))) } : {}),
      ...(amrap && mode === 'time' && plannedNumber(target.amrapMaxSec) > 0 ? { amrapMaxSec: Math.max(value, Math.round(plannedNumber(target.amrapMaxSec))) } : {}),
      ...(plannedNumber(target.weight) != null ? { weight: plannedNumber(target.weight) } : {}),
      ...(prescription ? { weightPrescription: prescription } : {}),
      ...(warmup ? { warmup } : {}),
      ...(plannedNumber(target.warmupRestSec) != null ? { warmupRestSec: Math.round(plannedNumber(target.warmupRestSec)) } : {}),
      ...(plannedNumber(target.workRestSec) != null ? { workRestSec: Math.round(plannedNumber(target.workRestSec)) } : {}),
      ...(plannedNumber(target.restSec) != null ? { restSec: Math.round(plannedNumber(target.restSec)) } : {}),
      ...(plannedNumber(target.prepSec) != null ? { prepSec: Math.round(plannedNumber(target.prepSec)) } : {}),
      ...(target.prog || target.progressionPolicy ? { prog: target.prog || target.progressionPolicy } : {}),
      ...(plannedNumber(target.inc) > 0 ? { inc: plannedNumber(target.inc) } : {}),
      ...(plannedNumber(target.repsMin) > 0 ? { repsMin: Math.round(plannedNumber(target.repsMin)) } : {}),
      ...(target.amrapMissPolicy ? { amrapMissPolicy: target.amrapMissPolicy } : {}),
      ...(target.bodyweight != null ? { bodyweight: !!target.bodyweight } : {}),
      ...(mode === 'reps' && target.side != null ? { side: !!target.side } : {}),
      ...(mode === 'reps' && plannedNumber(target.repsMax) > 0 ? { repsMax: Math.round(plannedNumber(target.repsMax)) } : {}),
      ...(amrap && explicitRoles ? { amrapRoles: roles.map(({ set }) => ['none', 'amrap', 'progression'].includes(set.amrapRole) ? set.amrapRole : 'none') } : {})
    }
    const targetValue = mode === 'reps' ? config.amrapMinReps || value : value
    return { date: workout.d || null, summary: `${sets} × ${targetValue} ${t(mode === 'time' ? 'seconds' : 'reps')}${amrap ? ` · ${t('AMRAP')} ≥ ${targetValue}` : ''}`, config }
    }
  }
  return null
}

/** Latest unit-compatible completed Work entry with an eligible reps-based 1RM estimate. */
export function latestEligibleRepsEntryFor(S, exId, occurrenceId = null) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const workout = S.workouts[i]
    if (!historyUnitCompatible(workout, S.unit)) continue
    const candidates = matchingHistoryEntries(workout, exId)
    const en = selectHistoryEntry(workout, exId, occurrenceId)
    if (!en || !historyEntryCompatible(en, S.unit, workout.unit)) continue
    if (!bestEligibleSetOf(en)) continue
    const occurrenceIndex = candidates.findIndex(item => item.entry === en)
    return {
      d: workout.d,
      sets: en.sets.filter(isWorkRow).filter(s => s.done === true),
      target: en.target || null,
      occurrenceId: occurrenceId || occurrenceIdForHistoryEntry(en, occurrenceIndex)
    }
  }
  return null
}

/**
 * Resolve the only history a live workout is allowed to consult.
 *
 * Routine and Programme sessions keep the normal profile-wide history. A fresh freestyle has no
 * history by definition. Repeat carries one immutable snapshot of the selected freestyle only;
 * global workouts and the global confirmed-weight cache stay out of every in-session editor path.
 */
export function activeWorkoutHistoryPolicy(active) {
  const explicit = active?.historyPolicy?.kind
  if (explicit === 'fresh-freestyle' || explicit === 'selected-freestyle') return explicit
  const isLegacyFreestyle = active && active.routineId == null && !isProgrammeSession(active) && !active.instanceId
  return isLegacyFreestyle ? 'fresh-freestyle' : 'global'
}

export function activeWorkoutHistoryState(S, active = S?.active) {
  const policy = activeWorkoutHistoryPolicy(active)
  if (policy === 'global') return S
  if (policy === 'fresh-freestyle') return { ...S, workouts: [], exWeights: {} }
  const selected = active?.historyPolicy?.workout
  return { ...S, workouts: selected ? [selected] : [], exWeights: {} }
}

/**
 * Return the completed entry used to resolve one active work load.
 *
 * Fresh Freestyle and selected Repeat retain their scoped active-session history for ordinary
 * setup/display/replay. Explicit theoretical-1RM percentage prescriptions are different: the
 * owner-authorized calculator uses exact-compatible account history for every active policy. This
 * returns the latest compatible entry as a compatibility reference only; canonical Adaptive and
 * Latest values are resolved by percentage1RMForExercise, never by bestEligibleSetOf(reference).
 */
export function activeWorkoutLoadReference(S, active, target = {}, exId, desiredMode = 'reps') {
  const prescription = normalizeWeightPrescription(target, target?.weight)
  const explicitPercentage = prescription?.kind === 'percentage'
  const scoped = activeWorkoutHistoryState(S, active)
  const source = explicitPercentage ? S : scoped
  if (explicitPercentage) return latestEligibleRepsEntryFor(source, exId)
  return lastEntryFor(source, exId, desiredMode)
}

const METRIC_MODES = ['reps', 'time', 'cardio']
const completedRowsForMode = (entry, mode) => workRowsForMode(entry, mode).filter(s => s.done === true && !isWarmupRow(s))

/** Completed work rows for one chart/strength metric, resolved through the row mode contract. */
export function metricRowsForEntry(entry, mode) {
  const requested = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
  const resolved = METRIC_MODES.includes(requested) ? requested : metricModeForEntry(entry)
  return resolved ? completedRowsForMode(entry, resolved) : []
}

/** The authoritative metric for an entry; reps rows take precedence over timed/cardio rows. */
export function metricModeForEntry(entry, fallback = null) {
  for (const mode of METRIC_MODES) {
    if (completedRowsForMode(entry, mode).length) return mode
  }
  return modeForEntry(entry, fallback)
}

/** Best strength weight from completed work-phase reps rows, with a guarded legacy topW fallback. */
export function bestWeightForEntry(entry = {}) {
  const target = entry.target || entry
  const workRows = Array.isArray(entry.sets)
    ? entry.sets.filter(isWorkRow)
    : []
  const repsRows = metricRowsForEntry(entry, 'reps')
  if (!repsRows.length) {
    // Timed/cardio-only entries carry no reps rows; fall back to the max weight over
    // completed non-warm-up work rows so the strength view never reads 0 for them.
    return workRows.reduce((best, set) => {
      if (set?.done !== true || isWarmupRow(set)) return best
      const weight = Number(set.w)
      return Number.isFinite(weight) && weight > best ? weight : best
    }, 0)
  }

  let best = 0
  repsRows.forEach(set => {
    const weight = Number(set?.w)
    if (Number.isFinite(weight) && weight > best) best = weight
  })

  const parentMode = modeForSet({}, target)
  const hasNonRepsWorkRow = workRows.some(set => modeForSet(set, target) !== 'reps')
  const hasWarmupRow = Array.isArray(entry.sets) && entry.sets.some(isWarmupRow)
  const topWeight = Number(entry.topW)
  // topW predates phase-tagged warm-ups. It remains a fallback for legacy all-work records,
  // but cannot override resolved work rows once any warm-up marker exists.
  if (parentMode === 'reps' && !hasNonRepsWorkRow && !hasWarmupRow
    && Number.isFinite(topWeight) && topWeight > best) best = topWeight
  return best
}


export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => {
    if (!historyUnitCompatible(w, S.unit)) return
    w.entries.forEach(e => {
      if (e.id !== exId) return
      if (!historyEntryCompatible(e, S.unit, w.unit)) return
      const entryBest = bestWeightForEntry(e)
      if (entryBest > best) best = entryBest
    })
  })
  return best
}
// Day overrides used to be one routine id (or the special `rest` value). New writes use a
// list, but every load path runs this copy-on-read normalizer so old backups and server state
// become the new shape without changing callers that still hold an old object.
export function normalizeDayPlan(S) {
  const source = S && typeof S === 'object' && !Array.isArray(S) ? S : {}
  const raw = source.dayPlan
  const dayPlan = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).map(([iso, value]) => [iso, Array.isArray(value) ? value.slice() : [value]]))
    : {}
  return { ...source, dayPlan }
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const asRoutineIds = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
const knownRoutineIds = S => new Set((S?.routines || []).map(r => r.id))
const validRoutineIds = (S, value) => {
  const known = knownRoutineIds(S)
  return [...new Set(asRoutineIds(value).filter(id => id && id !== 'rest' && known.has(id)))]
}

// All routines effective for a day, in the order stored by the plan. `week` deliberately stays
// scalar: it is the recurring fallback, while a date override can add morning + evening plans.
// A `rest` override is exclusive, and an empty list is the same explicit no-plan override.
export function effectiveRoutineIds(S, iso) {
  const dayPlan = S?.dayPlan || {}
  const hasOverride = hasOwn(dayPlan, iso)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const raw = hasOverride ? dayPlan[iso] : S?.week?.[wd]
  if (asRoutineIds(raw).includes('rest')) return []

  const ids = validRoutineIds(S, raw)
  if (ids.length || !hasOverride || (Array.isArray(raw) && raw.length === 0)) return ids

  // Preserve the old helper's behavior for a stale/unknown override: fall back to the weekly
  // routine rather than turning a bad legacy id into an unexpected rest day. Empty arrays remain
  // explicit rest overrides, while a list containing valid ids already returned above.
  return validRoutineIds(S, S?.week?.[wd])
}

export function effectiveRoutineId(S, iso) {
  return effectiveRoutineIds(S, iso)[0] || null
}
export function effectiveRoutines(S, iso) {
  const routines = new Map((S?.routines || []).map(r => [r.id, r]))
  return effectiveRoutineIds(S, iso).map(id => routines.get(id)).filter(Boolean)
}
export function effectiveRoutine(S, iso) {
  return effectiveRoutines(S, iso)[0] || null
}

const isProgrammeWorkout = workout => workout?.programmeSession === true
  || workout?.sessionType === 'programme'
  || workout?.kind === 'programme'
  || workout?.programmeId != null
  || workout?.cycleId != null
  || workout?.programmeInstance != null
  || workout?.programmeStep != null

const isExplicitClassicConversion = workout => workout?.classicConversion === true
  || workout?.convertedFromWeek != null
  || (workout?.programmeCreatedFromWeek != null && workout?.classic === true)

// Conversion records retain Programme provenance but settle the classic slot they were converted
// from. Every classic completion projection must use this classifier rather than generic Programme
// detection, so the same immutable history cannot be Done on one surface and Start on another.
const isClassicWorkoutRecord = workout => !isProgrammeWorkout(workout)
  || isExplicitClassicConversion(workout)

// A classic planned session is complete for a local calendar date only when a classic workout (or an
// explicitly marked converted-week workout) is recorded on that date. Programme records carry their
// own queue identity and must not silently settle an unrelated classic slot.
export function completedRoutineIdsForDate(S, iso) {
  const done = new Set()
  ;(S?.workouts || []).forEach(w => {
    if (String(w?.d || '').slice(0, 10) !== iso || !w?.routineId) return
    if (w?.plannedComplete === false || w?.complete === false || w?.partial === true) return
    if (!isClassicWorkoutRecord(w)) return
    done.add(w.routineId)
  })
  return done
}

/** The exact unfinished history record eligible for an explicit weekly Resume action. */
export function resumableWeeklyWorkout(S, session = {}) {
  if (S?.active) return null
  const source = session.source === 'programme' ? 'programme' : 'classic'
  const calendarDate = String(session.calendarDate || '').slice(0, 10)
  const records = (S?.workouts || []).filter(workout => {
    if (String(workout?.routineId ?? '') !== String(session.routineId ?? '')) return false
    if (source === 'programme') {
      const nominalDate = String(workout?.programmeStep?.nominalDate || workout?.d || '').slice(0, 10)
      return isProgrammeWorkout(workout)
        && !!session.instanceId
        && String(workout?.instanceId ?? workout?.programmeInstance?.instanceId ?? '') === String(session.instanceId)
        && nominalDate === calendarDate
    }
    return isClassicWorkoutRecord(workout)
      && String(workout?.d || '').slice(0, 10) === calendarDate
  })
  const complete = records.some(workout => source === 'programme'
    ? workout?.complete === true && workout?.partial !== true
    : workout?.plannedComplete !== false && workout?.complete !== false && workout?.partial !== true)
  if (complete) return null
  const unfinished = workout =>
    workout?.plannedComplete === false || workout?.complete === false || workout?.partial === true
  if (session.recordId != null) {
    return records.find(workout => String(workout?.id ?? '') === String(session.recordId) && unfinished(workout)) || null
  }
  return [...records].reverse().find(unfinished) || null
}

/** Canonical identity and lifecycle status for a scheduled session on any first-party surface. */
export function weeklySessionStatus(S, session = {}) {
  const active = S?.active
  const source = session.source === 'programme' ? 'programme' : 'classic'
  const calendarDate = String(session.calendarDate || '').slice(0, 10)
  const sameRoutine = String(active?.routineId ?? '') === String(session.routineId ?? '')
  const activeProgramme = isProgrammeWorkout(active)
  const activeProgrammeDate = String(active?.programmeStep?.nominalDate
    || active?.d
    || '').slice(0, 10)
  const activeMatches = source === 'programme'
    ? activeProgramme
      && !!session.instanceId
      && String(active?.instanceId ?? active?.programmeInstance?.instanceId ?? '') === String(session.instanceId)
      && sameRoutine
      && activeProgrammeDate === calendarDate
    : !!active
      && !activeProgramme
      && sameRoutine
      && String(active?.d || '').slice(0, 10) === calendarDate

  // Checking the final set does not end a session. Only an explicit Finish/Discard mutation may
  // clear active, so identity always wins over inferred completion while the session is present.
  if (activeMatches) return 'resume'
  if (resumableWeeklyWorkout(S, session)) return 'resume'

  if (source === 'programme') {
    if (session.status === 'completed' || session.status === 'finished') return 'done'
    if (session.status === 'incomplete' || session.status === 'partial-advanced') return 'incomplete'
    if (session.status === 'skipped') return 'skipped'
    if (session.status === 'owed') return 'owed'
    return 'start'
  }

  const records = (S?.workouts || []).filter(workout =>
    String(workout?.d || '').slice(0, 10) === calendarDate
    && String(workout?.routineId ?? '') === String(session.routineId ?? '')
    && isClassicWorkoutRecord(workout))
  if (!records.length) return 'start'
  const hasCompletedAttempt = records.some(workout =>
    workout?.plannedComplete !== false
    && workout?.complete !== false
    && workout?.partial !== true)
  return hasCompletedAttempt ? 'done' : 'incomplete'
}

// Return the selected routine only while it remains open; stale selections fall forward to the
// first uncompleted plan. A null result means the caller must show an explicit choose-another or
// freestyle path rather than silently starting a completed plan.
export function reconcileStartSessionChoice(todayPlans, doneToday, chosen) {
  const selectedIsOpen = chosen && todayPlans.some(r => r.id === chosen && !doneToday.has(r.id))
  if (selectedIsOpen) return chosen
  return todayPlans.find(r => !doneToday.has(r.id))?.id || null
}

export function buildSets(S, cfg, options = {}) {
  const n = Math.max(1, cfg.sets || 1)
  const mode = modeOf(cfg)
  const last = lastEntryFor(S, cfg.id, mode, cfg.occurrenceId)
  const preferLast = !!options.preferLast

  const sets = []
  // Last time's set at the same position, falling back to its final set when the plan grew.
  const prevAt = i => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)

  if (mode === 'cardio') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i)
      sets.push({ min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false })
    }
    return sets
  }
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false })
    }
    return sets
  }
  const conf = cachedWeightFor(S.exWeights?.[cfg.id], S.unit)
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    // Planned sessions may use the confirmed working weight, while freestyle should reproduce
    // the load of each matching set when that option is requested.
    const w = preferLast && usable ? usable.w : (cfg.resolvedWeight != null ? cfg.resolvedWeight : (conf > 0 ? conf : (usable ? usable.w : cfg.weight)))
    // The prescribed effort target rides on the planned sets so the effort column starts at
    // the plan; the logged value may then drift as the session actually feels. The scale
    // follows the user's main-menu setting: RIR when set to RIR, RPE (10 - RIR) when RPE.
    const effortKind = effortOf(S)
    const plannedEffort = cfg.rir != null ? cfg.rir : (usable ? usable.rir : undefined)
    sets.push({
      w, r: usable ? usable.r : cfg.reps, done: false,
      ...(effortKind === 'rpe' && plannedEffort != null ? { rpe: Math.max(0, 10 - plannedEffort) } : {}),
      ...(effortKind === 'rir' && plannedEffort != null ? { rir: plannedEffort } : {})
    })
  }
  return sets
}
export function workoutVolume(w, expectedUnit = null) {
  return workoutVolumeFromEntries(w, expectedUnit)
}

/** All completed workouts safe to show or aggregate for the current profile unit. */
export function workoutsForUnit(S) {
  return (S?.workouts || []).filter(workout => historyUnitCompatible(workout, S?.unit))
}

/** Completed volume grouped by explicit phase. Timed/cardio rows remain zero volume. */
export function volumeByPhase(w, expectedUnit = null) {
  const out = { warmup: 0, work: 0 }
  if (!historyUnitCompatible(w, expectedUnit)) return out
  ;(w?.entries || []).forEach(entry => {
    if (!historyEntryCompatible(entry, expectedUnit, w.unit)) return
    ;(entry.sets || []).forEach(set => {
      // Warm-ups keep their own bucket (tonnage semantics: warm-up volume counts,
      // but as warm-up volume, never as work).
      const phase = isWarmupRow(set) ? 'warmup' : normalizePhase(set.phase, 'work')
      out[phase] = (out[phase] || 0) + setVolume(set, entry.target || entry)
    })
  })
  return out
}

/** Completed set counts grouped by phase for review screens and migration checks. */
export function setsByPhase(w, expectedUnit = null) {
  const out = { warmup: 0, work: 0 }
  if (!historyUnitCompatible(w, expectedUnit)) return out
  ;(w?.entries || []).forEach(entry => {
    if (!historyEntryCompatible(entry, expectedUnit, w.unit)) return
    ;(entry.sets || []).forEach(set => {
      if (!set.done) return
      const phase = isWarmupRow(set) ? 'warmup' : normalizePhase(set.phase, 'work')
      out[phase] = (out[phase] || 0) + 1
    })
  })
  return out
}

export function entryVolumeByPhase(entry, expectedUnit = null, inheritedUnit = null) {
  const out = { warmup: 0, work: 0 }
  if (!historyEntryCompatible(entry, expectedUnit, inheritedUnit)) return out
  ;(entry?.sets || []).forEach(set => {
    const phase = isWarmupRow(set) ? 'warmup' : normalizePhase(set.phase, 'work')
    out[phase] = (out[phase] || 0) + setVolume(set, entry.target || entry)
  })
  return out
}
export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export const lastBW = S => (S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null)

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
// Purely pair two adjacent entries. Existing contiguous groups on either side are merged, so
// pairing the end of one group with the start of another produces one display unit. A caller can
// provide a group id (useful when restoring a known id); otherwise an existing id is preferred,
// with a deterministic unused id for two previously ungrouped entries.
export function pairAdjacent(items, first, second, groupId) {
  if (!Array.isArray(items)) throw new TypeError('Superset entries must be an array')
  if (!Number.isInteger(first) || !Number.isInteger(second) || !items[first] || !items[second]) {
    throw new RangeError('Superset entry indexes are invalid')
  }
  if (Math.abs(first - second) !== 1) throw new RangeError('Superset entries must be adjacent')

  const next = items.map(e => ({ ...e }))
  const left = Math.min(first, second)
  const right = Math.max(first, second)
  const group = groupId || next[left].sg || next[right].sg || freshSg(next, left, right)
  const members = new Set([...contiguousSgGroup(next, left), ...contiguousSgGroup(next, right)])
  members.forEach(i => { next[i].sg = group })
  return next
}

// Remove one entry from its superset and clean any ids that no longer have an adjacent partner.
// This is pure so the active workout can replace its entries atomically through the store.
export function unpairSuperset(items, idx) {
  if (!Array.isArray(items)) throw new TypeError('Superset entries must be an array')
  if (!Number.isInteger(idx) || !items[idx]) throw new RangeError('Superset entry index is invalid')
  const next = items.map(e => ({ ...e }))
  delete next[idx].sg
  next.forEach((e, i) => {
    if (e.sg && !(next[i - 1]?.sg === e.sg || next[i + 1]?.sg === e.sg)) delete e.sg
  })
  return next
}

function contiguousSgGroup(items, idx) {
  const sg = items[idx]?.sg
  if (!sg) return [idx]
  let first = idx
  let last = idx
  while (first > 0 && items[first - 1]?.sg === sg) first--
  while (last + 1 < items.length && items[last + 1]?.sg === sg) last++
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

function freshSg(items, first, second) {
  const base = `sg-${Math.min(first, second)}-${Math.max(first, second)}`
  let sg = base
  let n = 2
  while (items.some(e => e.sg === sg)) sg = `${base}-${n++}`
  return sg
}

export function supersetUnits(items) {
  const units = []
  items.forEach((e, i) => {
    const prev = items[i - 1]
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1].push(i)
    else units.push([i])
  })
  return units
}
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  const workouts = workoutsForUnit(S)
  if (!workouts.length) return 0
  const weeks = new Set(workouts.map(w => weekKey(w.d)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur))
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}

/**
 * Cascade a weight change forward: following sets in the same canonical phase that are still
 * undone take the new value (null deletes the key). Done sets are never rewritten.
 */
export function cascadeWeight(rows, from, value) {
  const warm = !!(rows[from]?.warmup || rows[from]?.phase === 'warmup')
  const next = rows.slice()
  for (let j = from + 1; j < next.length; j++) {
    if ((!!(next[j].warmup || next[j].phase === 'warmup')) === warm && !next[j].done) {
      if (value == null) delete next[j].w
      else next[j].w = value
    }
  }
  return next
}

/** Insert a warm-up row before the first work row, copying the preceding warm-up's values. */
export function insertWarmupRow(rows, mode, target) {
  const firstWork = rows.findIndex(x => !isWarmupRow(x))
  const at = firstWork === -1 ? rows.length : firstWork
  const l = rows[at - 1] || rows[rows.length - 1]
  const warm = mode === 'cardio'
    ? { min: l ? l.min : (target.min || 20), speed: l ? l.speed : (target.speed || 8), done: false, phase: 'warmup', warmup: true }
    : mode === 'time'
      ? { sec: l ? l.sec : (target.sec || 45), w: l ? (l.w || 0) : (target.weight || 0), done: false, phase: 'warmup', warmup: true }
      : { w: l ? l.w : 0, r: l ? l.r : target.reps, done: false, phase: 'warmup', warmup: true }
  const next = rows.slice()
  next.splice(at, 0, warm)
  return next
}

/** Remove the row at `i`, never emptying the entry below one row. */
export function removeRowAt(rows, i) {
  if (rows.length <= 1) return rows.slice()
  const next = rows.slice()
  next.splice(i, 1)
  return next
}

/** Completed non-warm-up sets across a workout's entries. */
export function workSetsDone(w) {
  // Conservative work-count boundary: a legacy boolean warm-up flag marks the row as a
  // warm-up regardless of any normalized work phase, so counts never drift upward for
  // old records.
  return (w?.entries || []).reduce(
    (n, e) => n + (e.sets || []).filter(s => s.done && !s.warmup && s.phase !== 'warmup').length, 0,
  )
}
