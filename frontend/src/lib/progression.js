// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf, entryMode, repStep } from './history.js'
import { EXIDX } from './exercises.js'
import { modeForEntry, modeForSet, normalizeLoggedSet, normalizeTarget, amrapMinRepsFor, historyUnitCompatible, historyEntryCompatible, historyUnitFor, isWarmupRow, isWorkRow, amrapRoleForSet as resolveAmrapRoleForSet } from './workout-model.js'
import { amrapTargetForSet } from './workout-runtime.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double'],
  time: ['off', 'time'],
  cardio: ['off']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  time: 'Add time'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  time: 'Hold every set for the full duration and the target goes up.'
}

/** Greyskull's final work set is AMRAP even when an old plan only stored `prog`. */
export function targetKindFor(target = {}, policy = '') {
  const source = objectOf(target)
  const marker = source.kind ?? source.targetKind ?? source.targetType ?? source.type
  if (typeof marker === 'string') {
    const value = marker.trim().toLowerCase()
    if (value === 'amrap' || value === 'as-many-as-possible' || value === 'as_many_as_possible') return 'amrap'
    if (value === 'fixed') return 'fixed'
  }
  if (source.amrap === true || source.isAmrap === true) return 'amrap'
  if (source.amrap === false) return 'fixed'
  return source.prog === 'greyskull' || policy === 'greyskull' ? 'amrap' : 'fixed'
}

// Sessions of repeated misses before a deload. Greyskull resets on the first failure by
// design; the general linear policy gives you two more cracks at it first.
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
const DELOAD_FACTOR = 0.9

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}
export const DEFAULT_SEC_INCREMENT = 5
// Where adding another set of push-ups stops being progress and starts being a way to spend
// an evening. Past this the honest advice is load or a harder variation (issue #33).
export const MAX_BW_SETS = 6

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode, fallbackProg) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  // Precedence: the exercise's own rule wins, then the plan/routine's, then the
  // user's default progression from Settings, then the built-in default.
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || fallbackProg || (m === 'reps' ? 'linear' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

const round1 = v => Math.round(v * 10) / 10
// Snap to a loadable multiple of the step.
function snap(v, step) {
  if (!(step > 0)) return round1(v)
  return round1(Math.round(v / step) * step)
}
// Back off by DELOAD_FACTOR, landing on something you can actually load. Rounding to the
// nearest step keeps the cut close to the intended 10 %, but on small weights the nearest
// step can be the weight you started from — so a deload that did not actually reduce
// anything takes one step down instead. Never goes below a single step.
export function deloadTo(cur, step) {
  let next = snap(cur * DELOAD_FACTOR, step)
  if (next >= cur) next = snap(cur - step, step)
  return Math.max(step, next)
}

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

// A partial historical target is common while migrating between app versions. Only use a
// recorded target's mode-specific fields when that mode matches the actual rows; otherwise a
// stale target from before a mode switch would reintroduce the wrong unit family.
function explicitTargetMode(target) {
  const source = objectOf(target)
  if (source.mode === 'reps' || source.mode === 'time' || source.mode === 'cardio') return source.mode
  if (source.sec != null || source.seconds != null || source.durationSec != null) return 'time'
  if (source.min != null || source.speed != null) return 'cardio'
  if (source.reps != null || source.targetReps != null || source.minReps != null || source.amrapMinReps != null) return 'reps'
  return null
}

// Progression retains a conservative migration guard for persisted targets: a raw result field
// that contradicts the recorded target is not silently converted into a successful session. This
// is deliberately narrower than modeForSet's parent-authoritative resolver: an explicitly tagged
// row mode wins, while old raw rows remain eligible for row-aware consumers such as workRowsForMode.
function rawResultModeOf(set) {
  const source = objectOf(set)
  const result = objectOf(source.result)
  for (const value of [source.mode, result.mode]) {
    const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (token === 'reps' || token === 'time' || token === 'cardio') return token
  }
  const has = names => names.some(name => source[name] != null || result[name] != null)
  if (has(['min', 'minutes', 'speed'])) return 'cardio'
  if (has(['sec', 'seconds', 'durationSec', 'actualSec'])) return 'time'
  if (has(['r', 'reps', 'actualReps'])) return 'reps'
  return null
}

function hasContradictoryRawResult(entry, targetMode) {
  if (!targetMode) return false
  return (entry?.sets || []).some(set => {
    if (!isWorkRow(set)) return false
    const rawMode = rawResultModeOf(set)
    return rawMode != null && rawMode !== targetMode
  })
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
export function readSession(entry, fallback, expectedUnit = null, policyOverride = '', inheritedUnit = null) {
  if (!historyEntryCompatible(entry, expectedUnit, inheritedUnit)) {
    return { mode: null, kind: 'fixed', goal: 0, amrapMinReps: null, reps: [], weight: 0, low: 0, amrap: 0, ok: false, unit: null }
  }
  const fallbackTarget = fallback || {}
  const hasUnitField = ['unit', 'weightUnit', 'loadUnit'].some(key => entry?.[key] != null && entry[key] !== '')
  const contextualEntry = inheritedUnit && !hasUnitField ? { ...entry, unit: inheritedUnit } : entry
  const unit = historyUnitFor(contextualEntry, expectedUnit)
  const fallbackMode = modeOf({ ...fallbackTarget, id: entry && entry.id })
  const recordedTarget = objectOf(entry && entry.target)
  const hasRecordedTarget = Object.keys(recordedTarget).length > 0
  const recordedMode = explicitTargetMode(recordedTarget)
  // `modeForEntry` returns null for incompatible work rows. Keep that ambiguity instead of
  // silently applying the current plan's fallback and counting only whichever row came first.
  const inferredMode = entry ? modeForEntry(entry) : null
  const ambiguous = !!entry && inferredMode == null
  const mode = ambiguous ? null : (recordedMode || inferredMode || fallbackMode)
  // A targetless legacy entry may belong to a different mode than today's plan. Do not borrow
  // today's reps/time goal in that case; sessionsFor also filters it before progression uses it.
  const targetMode = mode || fallbackMode
  const compatibleTarget = hasRecordedTarget && (!recordedMode || recordedMode === targetMode)
  const targetSource = compatibleTarget
    ? { ...fallbackTarget, ...recordedTarget }
    : (!ambiguous && inferredMode === fallbackMode ? fallbackTarget : {})
  const target = normalizeTarget({ ...targetSource, mode: targetMode }, { ...fallbackTarget, mode: targetMode })
  const targetForSets = { ...target, mode: targetMode }
  // `normalizeTarget` gives every target a canonical `kind: fixed`, but that default must not
  // erase whether a legacy record explicitly requested fixed or simply omitted `kind`.
  const kindSource = hasRecordedTarget ? recordedTarget : targetSource
  const effectivePolicy = policyOverride || targetSource.prog || fallbackTarget.prog || null
  const policyAllowsAmrapProgression = effectivePolicy == null || effectivePolicy === 'greyskull'
  const rowRoleAmrap = policyAllowsAmrapProgression && Array.isArray(entry?.sets) && entry.sets.some(set => isWorkRow(set)
    && (set.amrapRole === 'amrap' || set.amrapRole === 'progression'))
  const kind = effectivePolicy != null && !policyAllowsAmrapProgression
    ? 'fixed'
    : rowRoleAmrap
    ? 'amrap'
    : targetKindFor(kindSource, policyOverride || targetSource.prog || fallbackTarget.prog)
  const rows = (ambiguous ? [] : ((entry && entry.sets) || []))
    .map((set, index) => ({ set, index }))
    .filter(item => !isWarmupRow(item.set) && modeForSet(item.set, targetForSets) === targetMode)
    .map(item => ({
      ...item,
      normalized: normalizeLoggedSet(item.set, targetForSets),
      role: resolveAmrapRoleForSet(entry, item.index, kind === 'amrap'),
      amrapTarget: kind === 'amrap' ? amrapTargetForSet(entry, item.index) : null
    }))
  const sets = rows.map(row => row.normalized)
  const planned = target.sets || sets.length
  const enough = sets.length >= planned
  const drivers = kind === 'amrap' ? rows.filter(row => row.role === 'progression') : []
  const driver = drivers.length === 1 ? drivers[0] : null
  const noAmrapDriver = kind === 'amrap' && !driver
  const progressionRows = kind === 'amrap'
    ? rows.filter(row => row.role === 'none' || row.role === 'progression')
    : rows

  if (targetMode === 'time') {
    const goal = kind === 'amrap'
      ? (driver?.amrapTarget || target.sec || 0)
      : target.sec || 0
    const held = progressionRows.map(row => (row.normalized.done ? (row.normalized.sec || 0) : 0))
    const driverHeld = driver?.normalized.done ? (driver.normalized.sec || 0) : 0
    const fixedHeld = progressionRows.filter(row => row.role !== 'progression')
      .map(row => (row.normalized.done ? (row.normalized.sec || 0) : 0))
    return {
      mode, kind, goal, held, amrap: kind === 'amrap' ? driverHeld : (held.length ? held[held.length - 1] : 0),
      weight: kind === 'amrap' && driver
        ? (driver.normalized.w || 0)
        : Math.max(0, ...progressionRows.filter(row => row.normalized.done).map(row => row.normalized.w || 0)),
      best: Math.max(0, ...held), noAmrapDriver,
      ok: goal > 0 && enough && held.length > 0 && !noAmrapDriver
        && fixedHeld.every(value => value >= goal) && (kind !== 'amrap' || driverHeld >= goal), unit
    }
  }
  const goal = kind === 'amrap'
    ? (driver?.amrapTarget || amrapMinRepsFor(target, target.reps) || 0)
    : (target.reps || 0)
  const reps = progressionRows.map(row => (row.normalized.done ? (row.normalized.r || 0) : 0))
  const driverReps = driver?.normalized.done ? (driver.normalized.r || 0) : 0
  const fixedReps = progressionRows.filter(row => row.role !== 'progression')
    .map(row => (row.normalized.done ? (row.normalized.r || 0) : 0))
  return {
    mode, kind, goal, amrapMinReps: kind === 'amrap' ? goal : null, reps,
    weight: kind === 'amrap' && driver
      ? (driver.normalized.w || 0)
      : Math.max(0, ...progressionRows.filter(row => row.normalized.done).map(row => row.normalized.w || 0)),
    count: reps.length,
    low: reps.length ? Math.min(...reps) : 0,
    amrap: kind === 'amrap' ? driverReps : (reps.length ? reps[reps.length - 1] : 0),
    noAmrapDriver,
    ok: goal > 0 && enough && reps.length > 0 && !noAmrapDriver
      && fixedReps.every(value => value >= goal) && (kind !== 'amrap' || driverReps >= goal), unit
  }
}

const occurrenceIdForProgressionEntry = (entry, index) => entry?.occurrenceId || `${entry?.id ?? 'entry'}#${index + 1}`

function programmeHoldFor(entry) {
  const target = objectOf(entry?.target)
  const disposition = entry?.programmeHoldDisposition || target.programmeHoldDisposition
    || (target.programmeWeekMode === 'deload' ? 'deload' : null)
  if (disposition !== 'deload') return {}
  const holdWeight = Number(target.programmeHoldWeight)
  const holdReps = Number(target.programmeHoldReps)
  const holdSec = Number(target.programmeHoldSec)
  return {
    programmeDisposition: 'deload-hold',
    ...(Number.isFinite(holdWeight) && holdWeight >= 0 ? { programmeHoldWeight: holdWeight } : {}),
    ...(Number.isFinite(holdReps) && holdReps > 0 ? { programmeHoldReps: holdReps } : {}),
    ...(Number.isFinite(holdSec) && holdSec > 0 ? { programmeHoldSec: holdSec } : {})
  }
}

function progressionEntryFor(workout, exId, occurrenceId) {
  const entries = (Array.isArray(workout?.entries) ? workout.entries : []).filter(entry => entry?.id === exId)
  if (!occurrenceId) return entries[0] || null
  return entries.find((entry, index) => occurrenceIdForProgressionEntry(entry, index) === occurrenceId) || null
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(S, exId, fallback, policyOverride = '', occurrenceId = null) {
  const out = []
  const desiredMode = fallback ? modeOf({ ...fallback, id: exId }) : null
  ;(S.workouts || []).forEach(w => {
    if (!historyUnitCompatible(w, S.unit)) return
    const entry = progressionEntryFor(w, exId, occurrenceId)
    if (!entry || !historyEntryCompatible(entry, S.unit, w.unit) || (desiredMode && entryMode(entry) !== desiredMode)) return
    // Do not reinterpret a record whose persisted prescription explicitly belongs to the other
    // mode. This catches the reverse direction too: a stale timed target with rep-shaped legacy
    // fields must not become a valid reps session merely because the current plan is reps.
    const recordedMode = explicitTargetMode(entry.target)
    if (desiredMode && recordedMode && recordedMode !== desiredMode) return
    if (recordedMode && hasContradictoryRawResult(entry, recordedMode)) return
    const partialOutcome = w.partial === true && (entry.progression === 'none' || entry.progression === 'miss')
      ? entry.progression
      : null
    if (partialOutcome) {
      const session = readSession(entry, fallback, S.unit, policyOverride, w.unit)
      if (!session.mode) return
      // A partial entry can contain no completed rows at all. Keep the prescribed load/target in
      // the miss so a later partial record cannot fall through to and advance stale older history.
      out.push({
        d: w.d,
        ...session,
        weight: session.weight || Number(entry.target?.weight) || Number(fallback?.weight) || 0,
        partialDisposition: partialOutcome === 'none' ? 'hold' : 'miss',
        ...programmeHoldFor(entry),
        occurrenceId: occurrenceId || null
      })
      return
    }
    if ((entry.sets || []).some(s => s?.done === true && !s.warmup && s.phase !== 'warmup')) {
      out.push({ d: w.d, ...readSession(entry, fallback, S.unit, policyOverride, w.unit), ...programmeHoldFor(entry), occurrenceId: occurrenceId || null })
    }
  })
  return out
}

// How many sessions in a row ended in a miss, counting back from the most recent.
export function stallCount(sessions, filter = {}) {
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    const session = sessions[i]
    if (session.phase && session.phase !== 'work') continue
    if (filter.mode && session.mode !== filter.mode) continue
    if (filter.unit && session.unit !== filter.unit) continue
    if (session.ok) break
    n++
  }
  return n
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said.
 */
export function nextPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode, S && S.defaultProg)
  const unit = S.unit || 'kg'
  const inc = cfg.inc > 0 ? cfg.inc : (mode === 'time' ? DEFAULT_SEC_INCREMENT : defaultIncrement(cfg.id, unit))
  if (policy === 'off') return { policy, kind: 'off' }

  const effectiveFallback = {
    ...cfg,
    ...(cfg.prog == null && policy === 'greyskull' ? { prog: 'greyskull' } : {})
  }
  const sessions = sessionsFor(S, cfg.id, effectiveFallback, policy, cfg.occurrenceId).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  if (!last) return { policy, kind: 'first', why: ['Nothing logged yet — this session sets the baseline.'] }

  const stalls = stallCount(sessions)
  const deloadAt = DELOAD_AFTER[policy] || 3

  // A partial Programme entry with `progression: none` is an explicit hold. It must stay a
  // hold even when the editor happened to mark every currently visible row done.
  if (last.partialDisposition === 'hold') {
    return {
      policy,
      kind: 'hold',
      weight: last.weight || cfg.weight,
      reps: mode === 'reps' ? (last.goal || cfg.reps) : undefined,
      sec: mode === 'time' ? (last.goal || cfg.sec) : undefined,
      why: ['This partial session was held — finish the prescribed work before progressing.']
    }
  }

  if (last.programmeDisposition === 'deload-hold') {
    return {
      policy,
      kind: 'hold',
      weight: mode === 'reps' ? (last.programmeHoldWeight ?? last.weight ?? cfg.weight) : undefined,
      reps: mode === 'reps' ? (last.programmeHoldReps || last.goal || cfg.reps) : undefined,
      sec: mode === 'time' ? (last.programmeHoldSec || last.goal || cfg.sec) : undefined,
      why: ['The programme deload paused progression — resume the pre-deload target before adding load.']
    }
  }

  if (last.noAmrapDriver) {
    return {
      policy,
      kind: 'hold',
      weight: mode === 'reps' ? (last.weight || cfg.weight) : undefined,
      reps: mode === 'reps' ? (last.goal || cfg.reps) : undefined,
      sec: mode === 'time' ? (last.goal || cfg.sec) : undefined,
      why: ['No progression-driver set — hold the current target.']
    }
  }

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, step: inc, why: ['Held every set for the full time — target up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs ahead
  // of the individual policies because it is true for all of them. Note the trigger is the
  // *logged* weight, not the `bw` flag: a dip done with a belt has a load to progress and
  // belongs on the normal policies, and a barbell lift logged at 0 has nothing to add to.
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0
    if (!last.ok || goal <= 0) return { policy, kind: 'hold', weight: 0, reps: goal || undefined, why: ['Bodyweight — same target again until every set is clean.'] }
    // A ceiling turns "+1 rep forever" into a plan (issue #33). Past the top of the range the
    // reps go back to the bottom and a set is added instead, which is how bodyweight work
    // actually progresses once a set of 30 push-ups stops being a strength stimulus.
    const top = cfg.repsMax > 0 ? cfg.repsMax : 0
    if (top > 0 && goal >= top) {
      const sets = Math.max(1, cfg.sets || last.count || 1) + 1
      const bottom = Math.max(1, Math.min(cfg.reps || top, top))
      if (sets <= MAX_BW_SETS) return { policy, kind: 'up', weight: 0, reps: bottom, sets, why: ['{0} reps in every set — add a set and go back to {1}.', goal, bottom] }
      // Out of sets worth adding: more volume is no longer the answer, load or a harder
      // variation is — and that is a decision for a person, not a policy.
      return { policy, kind: 'hold', weight: 0, reps: goal, why: ['{0} sets of {1} — time to add weight or move to a harder variation.', sets - 1, goal] }
    }
    // Unilateral work steps by two, so the total stays even and both sides get the rep.
    const next = goal + repStep(cfg)
    return { policy, kind: 'up', weight: 0, reps: next, why: ['Bodyweight — every rep last time, so go for {0} this time.', next] }
  }
  if (policy === 'double') {
    const top = cfg.reps || last.goal || 10
    const bottom = Math.min(cfg.repsMin || Math.max(1, top - 2), top)
    if (last.ok) return { policy, kind: 'up', weight: snap(w + inc, inc), reps: bottom, step: inc, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', inc, unit, bottom] }
    if (stalls >= deloadAt) {
      const dw = deloadTo(w, inc)
      return { policy, kind: 'deload', weight: dw, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', stalls, dw, unit] }
    }
    const aim = Math.min(top, Math.max(bottom, last.low + repStep(cfg)))
    return { policy, kind: 'hold', weight: w, reps: aim, why: ['Same weight — aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.kind === 'amrap' && last.goal > 0 && last.amrap >= last.goal * 2
    const step = dbl ? inc * 2 : inc
    return {
      policy, kind: 'up', weight: snap(w + step, inc), step, doubleJump: dbl,
      why: dbl
        ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, step, unit]
        : ['Every rep last time — {0} {1} more.', step, unit]
    }
  }
  if (policy === 'greyskull' && last.kind === 'amrap' && !last.ok
    && (cfg.amrapMissPolicy === 'maintain' || routine?.amrapMissPolicy === 'maintain')) {
    return { policy, kind: 'hold', weight: w, why: ['AMRAP missed its minimum — maintain the same weight and try again.'] }
  }
  if (stalls >= deloadAt) {
    const dw = deloadTo(w, inc)
    return {
      policy, kind: 'deload', weight: dw,
      why: stalls > 1
        ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription(sets, p) {
  if (!p || p.kind === 'off' || p.kind === 'first') return sets
  const out = sets.map(s => {
    // Never rewrite a logged set, and never rewrite a warm-up: the prescription speaks to
    // the work rows only (either warm-up schema - explicit phase or legacy boolean).
    if (s.done || s.warmup || s.phase === 'warmup') return s
    const o = { ...s }
    if (p.weight != null) o.w = p.weight
    if (p.reps != null) o.r = p.reps
    if (p.sec != null) o.sec = p.sec
    return o
  })
  // A policy that decided on a set count gets to grow the list — bodyweight progression adds
  // a set where a barbell would have added a plate. Only ever upwards, and only by copying a
  // row that is already there: a session in progress must not lose a set it has logged.
  const workRows = out.filter(s => !s.warmup && s.phase !== 'warmup')
  if (!workRows.length) return out
  if (p.sets > workRows.length) {
    const seed = workRows[workRows.length - 1] || out[out.length - 1]
    const roleAware = workRows.some(set => Object.prototype.hasOwnProperty.call(set, 'amrapRole'))
    while (workRows.length < p.sets) {
      out.push({ ...seed, done: false, ...(roleAware ? { amrapRole: 'none' } : {}) })
      workRows.push(out[out.length - 1])
    }
  }
  return out
}
