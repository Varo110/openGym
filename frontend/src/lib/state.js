// State-boundary normalisation for localStorage, /api/data, imports and active workouts.
//
// The workout helpers deliberately stay pure; this module is the one place that applies them
// to the persisted application shape. It preserves unknown/user-owned fields while adding the
// explicit phase and target fields required by newer code, so old JSON remains readable.
import { normalizeEntry, normalizePhase, normalizePhaseList, normalizeTarget, normalizeWeightUnit, workoutVolumeFromEntries, isWarmupOnlyTarget, withoutWorkLoad, normalizeAmrapRolesForSets } from './workout-model.js'
import { normalizeDayPlan } from './history.js'
import { normalizeMuscleGroups, hasExplicitMuscleMetadata } from './muscles.js'
import { normalizeExerciseAnnotations, normalizeRoutineGroupMeta } from './annotations.js'

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const arrayOf = value => Array.isArray(value) ? value : []
const clone = value => JSON.parse(JSON.stringify(value))

function normalizeProgrammes(value, fallback = []) {
  if (Array.isArray(value)) return clone(value)
  if (value && typeof value === 'object') return clone(value)
  return Array.isArray(fallback) ? clone(fallback) : []
}

function hasExplicitTargetKind(...inputs) {
  return inputs.some(input => {
    const source = objectOf(input)
    if (['kind', 'targetKind', 'targetType', 'type', 'amrap', 'isAmrap'].some(key => Object.prototype.hasOwnProperty.call(source, key))) return true
    return ['reps', 'sec', 'seconds', 'durationSec'].some(key => typeof source[key] === 'string' && source[key].trim().toLowerCase() === 'amrap')
  })
}

export const STATE_VERSION = 3

function normalizeWarmup(input) {
  const raw = objectOf(input)
  const source = { ...objectOf(raw.target), ...raw }
  const phase = source.phase == null ? 'warmup' : normalizePhase(source.phase, 'warmup')
  const target = normalizeTarget({ ...source, phase }, { phase })
  const out = { ...raw, ...source, phase, mode: target.mode }
  if (target.mode === 'time') out.sec = target.sec
  else if (target.mode === 'reps') out.reps = target.reps
  if (target.weightPrescription) out.weightPrescription = { ...target.weightPrescription }
  if (source.restSec != null) out.restSec = Math.max(0, Math.round(Number(source.restSec) || 0))
  return out
}

function optionalSeconds(source, names) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(source, name) || source[name] == null || source[name] === '') continue
    const n = Number(source[name])
    if (Number.isFinite(n) && n >= 0) return Math.round(n)
  }
  return undefined
}

function hasTargetFields(entry) {
  return ['mode', 'reps', 'amrapMinReps', 'targetReps', 'minReps', 'sec', 'seconds',
    'durationSec', 'min', 'speed', 'weight', 'kind', 'targetKind', 'targetType',
    'cap', 'amrapMaxSec', 'prog', 'weightPrescription', 'load'].some(key => Object.prototype.hasOwnProperty.call(entry, key))
}

function normalizeRoutine(input) {
  const source = objectOf(input)
  const phases = normalizePhaseList(source.phases)
  const warmupRestSec = optionalSeconds(source, ['warmupRestSec', 'warmupRest'])
  const workRestSec = optionalSeconds(source, ['workRestSec', 'workRest', 'restSec'])
  return normalizeRoutineGroupMeta({
    ...source,
    id: source.id || null,
    name: String(source.name || 'Routine'),
    ...(phases == null ? {} : { phases }),
    ...(warmupRestSec === undefined ? {} : { warmupRestSec }),
    ...(workRestSec === undefined ? {} : { workRestSec }),
    ex: arrayOf(source.ex).filter(Boolean).map(raw => {
      const entry = objectOf(raw)
      const nestedTarget = objectOf(entry.target)
      const explicitKind = hasExplicitTargetKind(entry, nestedTarget)
      const targetInput = { ...nestedTarget, ...entry }
      const target = Object.keys(nestedTarget).length || hasTargetFields(entry)
        ? normalizeTarget(targetInput) : null
      const warmupOnly = !!target && isWarmupOnlyTarget(targetInput)
      const normalizedNestedTarget = target && Object.keys(nestedTarget).length
        ? { ...(warmupOnly ? withoutWorkLoad(nestedTarget) : nestedTarget), ...target }
        : null
      const entryBase = warmupOnly ? withoutWorkLoad(entry) : entry
      const out = {
        ...entryBase,
        id: entry.id || null,
        ...(target ? {
          phase: target.phase,
          mode: target.mode,
          ...(explicitKind ? { kind: target.kind } : {}),
          sets: target.sets,
          reps: target.reps,
          ...(target.amrapMinReps != null ? { amrapMinReps: target.amrapMinReps } : {}),
          sec: target.sec,
          ...(target.amrapMaxSec != null ? { amrapMaxSec: target.amrapMaxSec } : {}),
          ...(Object.prototype.hasOwnProperty.call(target, 'weight') ? { weight: target.weight } : {}),
          ...(target.min != null ? { min: target.min } : {}),
          ...(target.speed != null ? { speed: target.speed } : {}),
          ...(target.weightPrescription ? { weightPrescription: { ...target.weightPrescription } } : {}),
          ...(normalizedNestedTarget ? { target: normalizedNestedTarget } : {})
        } : {}),
        ...(Array.isArray(entry.warmup) ? { warmup: entry.warmup.map(normalizeWarmup) } : {})
      }
      if (target?.mode === 'reps') {
        delete out.cap
        delete out.amrapMaxSec
      }
      return out
    })
  })
}

function normalizeCustomExercise(input) {
  const source = objectOf(input)
  const groups = hasExplicitMuscleMetadata(source) ? normalizeMuscleGroups(source) : []
  return {
    ...source,
    ...(groups.length ? {
      tg: groups[0],
      sm: groups.slice(1),
      muscleGroups: groups
    } : {})
  }
}

function normalizeEntryForState(input) {
  const source = objectOf(input)
  const normalized = normalizeEntry(source)
  const warmupOnly = isWarmupOnlyTarget(source.target || source, source)
  const sourceBase = warmupOnly ? withoutWorkLoad(source) : source
  const sets = normalizeAmrapRolesForSets(arrayOf(source.sets).map((raw, index) => {
    const canonical = normalized.sets[index] || {}
    // A legacy boolean warm-up flag with no explicit phase is a warm-up row: keep the
    // phase aligned so phase-authoritative checks read it as warm-up, not work.
    const phaseAdjusted = raw && raw.phase === 'work' && raw.warmup === true
      ? { ...canonical, phase: 'warmup' }
      : canonical
    // Keep the legacy/cardio fields that are not part of the reps/time canonical result shape.
    return { ...objectOf(raw), ...phaseAdjusted }
  }), source.target || source)
  const out = { ...sourceBase, ...normalized, sets }
  if (normalized.target) {
    const target = {
      ...(warmupOnly ? withoutWorkLoad(objectOf(source.target)) : objectOf(source.target)),
      ...normalized.target
    }
    if (!hasExplicitTargetKind(source, source.target)) delete target.kind
    if (target.mode === 'reps') {
      delete target.cap
      delete target.amrapMaxSec
    }
    out.target = target
  }
  else delete out.target
  return out
}

function normalizeWorkout(input, expectedUnit = null) {
  const source = objectOf(input)
  const entries = arrayOf(source.entries).filter(Boolean).map(normalizeEntryForState)
  return {
    ...source,
    entries,
    vol: workoutVolumeFromEntries({ ...source, entries }, expectedUnit)
  }
}

function normalizeActive(input, demoteProgression = true) {
  if (!input) return null
  const source = objectOf(input)
  return {
    ...source,
    entries: arrayOf(source.entries).filter(Boolean).map(raw => {
      const entry = normalizeEntryForState(raw)
      const policy = entry.target?.prog || entry.target?.progressionPolicy || entry.plan?.policy || null
      const coherentEntry = policy != null && entry.plan
        ? { ...entry, plan: { ...entry.plan, policy } }
        : entry
      if (!demoteProgression || policy == null || policy === 'greyskull') return coherentEntry
      return {
        ...coherentEntry,
        sets: coherentEntry.sets.map(set => set.amrapRole === 'progression'
          ? { ...set, amrapRole: 'amrap' }
          : set)
      }
    })
  }
}

function normalizeFinishedUndo(input, expectedUnit = null) {
  const source = objectOf(input)
  if (!source.workoutId) return null
  return {
    workoutId: source.workoutId,
    workoutEnd: source.workoutEnd ?? null,
    instanceId: source.instanceId ?? null,
    replacedIndex: Number.isInteger(source.replacedIndex) ? source.replacedIndex : -1,
    replacedWorkout: source.replacedWorkout ? normalizeWorkout(source.replacedWorkout, expectedUnit) : null,
    previousExWeights: clone(objectOf(source.previousExWeights)),
    ...(source.programmesBefore == null ? {} : { programmesBefore: clone(source.programmesBefore) })
  }
}

/**
 * Return a JSON-safe, backwards-compatible state object. No source object is mutated.
 * `defaults` is supplied by the Zustand store so this module does not own UI defaults.
 */
export function normalizeState(input, defaults = {}) {
  const source = objectOf(input)
  const base = clone(objectOf(defaults))
  const expectedUnit = normalizeWeightUnit(source.unit ?? base.unit) || 'kg'
  const out = {
    ...base,
    ...source,
    schemaVersion: STATE_VERSION,
    reminder: { ...(base.reminder || {}), ...objectOf(source.reminder) },
    bodyweight: arrayOf(source.bodyweight),
    routines: arrayOf(source.routines).filter(Boolean).map(normalizeRoutine),
    workouts: arrayOf(source.workouts).filter(Boolean).map(workout => normalizeWorkout(workout, expectedUnit)),
    active: normalizeActive(source.active),
    lastFinishedSession: normalizeActive(source.lastFinishedSession, false),
    lastFinishedUndo: normalizeFinishedUndo(source.lastFinishedUndo, expectedUnit),
    customEx: arrayOf(source.customEx).filter(Boolean).map(normalizeCustomExercise),
    programmes: normalizeProgrammes(source.programmes, base.programmes)
  }
  out.exerciseAnnotations = normalizeExerciseAnnotations(source.exerciseAnnotations, out.customEx)
  return normalizeDayPlan(out)
}

export { normalizeEntryForState, normalizeRoutine, normalizeWorkout }
