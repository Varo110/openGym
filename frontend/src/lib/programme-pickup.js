import { EXIDX, exOr } from './exercises.js'
import { defaultIncrement } from './progression.js'
import { modeOf, isBw } from './history.js'
import { modeForSet } from './workout-model.js'

// Keep pickup history compatibility local to this contribution. The richer history contract
// is introduced by the later phase branch and must not be pulled into this branch's base.
const isWorkRow = set => {
  if (!set || set.warmup === true) return false
  return set.phase == null || String(set.phase).trim().toLowerCase() === 'work'
}
const unitToken = value => {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (['kg', 'kilogram', 'kilograms'].includes(token)) return 'kg'
  if (['lb', 'lbs', 'pound', 'pounds'].includes(token)) return 'lb'
  return token || null
}
const unitOf = (value, fallback = null) => unitToken(value?.unit ?? value?.weightUnit ?? value?.target?.unit) || unitToken(fallback)
const historyUnitCompatible = (input, expectedUnit = null) => {
  const actual = unitOf(input)
  const expected = unitToken(expectedUnit)
  return !actual || !expected || actual === expected
}
const historyEntryCompatible = (entry, expectedUnit = null, inheritedUnit = null) =>
  historyUnitCompatible(inheritedUnit, expectedUnit) && historyUnitCompatible(entry, expectedUnit || inheritedUnit)
import { muscleGroupsOf, musclesOf } from './muscles.js'
import { strengthOf } from './recovery.js'

export const PICKUP_MODES = ['max', 'deload']
export const PICKUP_POLICIES = ['linear', 'greyskull', 'double', 'time', 'off']

const finite = value => {
  if (typeof value === 'string' && value.trim() === '') return false
  return value !== null && value !== '' && Number.isFinite(Number(value))
}
const numberOr = (value, fallback = 0) => finite(value) ? Number(value) : fallback
const COMPLETED_PICKUP_STATUSES = new Set(['complete', 'completed', 'finished', 'done'])

function versionedNamespaceOf(value) {
  if (value?.version === 1 && Array.isArray(value.definitions) && Array.isArray(value.cycles)) return value
  if (value?.programmes?.version === 1) return value.programmes
  return null
}

const statusOf = value => String(value || '').toLowerCase()
const isActiveCycle = cycle => statusOf(cycle?.status) === 'active'

function cycleProgrammeIdentity(cycle) {
  return cycle?.programmeId || cycle?.definitionId || cycle?.programmeSnapshot?.id || cycle?.programmeSnapshot?.definitionId
    || cycle?.snapshot?.definitionId || cycle?.snapshot?.id || null
}

function programmeIdOf(programme, cycle) {
  return cycleProgrammeIdentity(cycle) || programme?.programmeId || programme?.id || programme?.definitionId || null
}

function cycleIdOf(cycle) {
  return cycle?.id || null
}

export function isPickupCycleEligible(cycle) {
  return COMPLETED_PICKUP_STATUSES.has(String(cycle?.status || '').toLowerCase())
}

function targetOf(exercise) {
  const source = exercise && typeof exercise === 'object' ? exercise : { id: exercise }
  return { ...source, ...(source.target && typeof source.target === 'object' ? source.target : {}), id: source.id }
}

function configuredValue(exercise, kind, bodyweight) {
  const cfg = targetOf(exercise)
  if (kind === 'cardio') return null
  if (bodyweight && kind === 'time') return numberOr(cfg.sec ?? cfg.seconds ?? cfg.durationSec)
  if (bodyweight) return numberOr(cfg.reps ?? cfg.r)
  return numberOr(cfg.weight ?? cfg.w)
}

export function pickupIncrement(exercise, unit = 'kg') {
  const cfg = targetOf(exercise)
  if (finite(cfg.inc) && Number(cfg.inc) > 0) return Number(cfg.inc)
  return defaultIncrement(exercise?.id || cfg.id, unit)
}

/** Floor a load after applying a percentage; all arguments are already in display units. */
export function snapPickupLoad(value, percent, increment, minimum = 0) {
  const displayValue = numberOr(value)
  const step = numberOr(increment)
  const scaled = displayValue * numberOr(percent, 100) / 100
  if (!(step > 0)) return Math.max(numberOr(minimum), Number(scaled.toFixed(2)))
  const snapped = Math.max(numberOr(minimum), Math.floor((scaled + 1e-9) / step) * step)
  return Number(snapped.toFixed(2))
}

export function stepDeloadPercent(value, delta) {
  return Math.max(50, Math.min(100, numberOr(value, 90) + numberOr(delta)))
}

function compatibleHistory(workouts, unit) {
  return (Array.isArray(workouts) ? workouts : []).filter(workout => historyUnitCompatible(workout, unit))
}

function historyRows(workouts, id, unit, target) {
  const kind = modeOf(target)
  return compatibleHistory(workouts, unit).flatMap(workout =>
    (workout?.entries || []).filter(entry => String(entry?.id) === String(id) && historyEntryCompatible(entry, unit, workout.unit)).flatMap(entry =>
      (entry.sets || []).filter(set => set?.done === true && isWorkRow(set) && modeForSet(set, target) === kind)))
}

function metricValue(row, kind, bodyweight) {
  if (kind === 'time' && bodyweight) return numberOr(row.sec ?? row.seconds ?? row.durationSec)
  if (kind === 'reps' && bodyweight) return numberOr(row.r ?? row.reps)
  return numberOr(row.w ?? row.weight)
}

export function highestWorkingValue(workouts, exercise, unit = 'kg') {
  const cfg = targetOf(exercise)
  const kind = modeOf(cfg)
  if (kind === 'cardio') return null
  const bodyweight = isBw(cfg)
  const rows = historyRows(workouts, cfg.id, unit, cfg)
  return Math.max(0, ...rows.map(row => metricValue(row, kind, bodyweight)))
}

function exerciseConfig(entry, custom = {}) {
  const id = entry?.id || entry
  const known = EXIDX[id] || exOr(id) || {}
  return { ...known, ...(typeof entry === 'object' ? entry : {}), ...(custom[id] || {}), id }
}

function suggestionPercent(value) {
  if (!finite(value)) return null
  const numeric = Number(value)
  // strengthOf exposes 0…1 while persisted/UI suggestion maps use percentages.
  // Pickup controls move in five-point increments; quantise retained-strength suggestions to
  // that same display contract rather than exposing an uneditable 98% value.
  return numeric >= 0 && numeric <= 1 ? Math.round(numeric * 20) * 5 : numeric
}

function suggestionFor(exercise, suggestions) {
  const direct = suggestions?.[exercise.id]
  if (finite(direct)) return suggestionPercent(direct)
  for (const slug of muscleGroupsOf(exercise)) {
    if (finite(suggestions?.[slug])) return suggestionPercent(suggestions[slug])
  }
  return null
}

function floorBodyweight(value, percent) {
  return Math.max(1, Math.floor(numberOr(value) * numberOr(percent, 100) / 100))
}

function valueFor({ base, bodyweight, mode, percent, increment }) {
  if (base == null) return null
  if (mode !== 'deload') return bodyweight ? Math.max(1, numberOr(base)) : Math.max(0, numberOr(base))
  return bodyweight ? floorBodyweight(base, percent) : snapPickupLoad(base, percent, increment)
}

export function pickupRows({ exercises = [], workouts = [], unit = 'kg', mode = 'max', percent = 90, custom = {}, suggestions = {}, previousRows = [] } = {}) {
  return exercises.map(entry => {
    const exercise = exerciseConfig(entry, custom)
    const cfg = targetOf(exercise)
    const kind = modeOf(cfg)
    const cardio = kind === 'cardio'
    const bodyweight = !cardio && isBw(cfg)
    const increment = pickupIncrement(exercise, unit)
    const highest = highestWorkingValue(workouts, exercise, unit)
    const configured = configuredValue(exercise, kind, bodyweight)
    const base = cardio ? null : highest > 0 ? highest : configured
    const suggestion = suggestionFor(exercise, suggestions)
    const previous = previousRows.find(row => String(row?.id) === String(exercise.id))
    const manual = !!previous?.manual
    const value = cardio ? null : manual
      ? (bodyweight ? Math.max(1, numberOr(previous.value)) : Math.max(0, numberOr(previous.value)))
      : valueFor({ base, bodyweight, mode, percent, increment })
    return {
      ...exercise,
      kind,
      cardio,
      bodyweight,
      defaultIncrement: !EXIDX[exercise.id] && !(finite(cfg.inc) && Number(cfg.inc) > 0),
      increment,
      base,
      value,
      suggestion,
      manual,
    }
  })
}

export function derivePickupSuggestions({ workouts = [], exercises = [], unit = null, now = Date.now() } = {}) {
  const filtered = compatibleHistory(workouts, unit).map(workout => ({
    ...workout,
    entries: (workout.entries || []).filter(entry => historyEntryCompatible(entry, unit, workout.unit)),
  }))
  const strength = strengthOf(filtered, now)
  const suggestions = {}
  for (const entry of exercises) {
    const exercise = exerciseConfig(entry)
    const muscles = musclesOf(exercise)
    const primary = Object.entries(muscles).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (primary && finite(strength[primary])) suggestions[exercise.id] = suggestionPercent(strength[primary])
  }
  return suggestions
}

export function applyPickupSuggestion(row) {
  if (row.cardio || row.manual || row.suggestion == null || row.base == null) return row
  const value = row.bodyweight
    ? floorBodyweight(row.base, row.suggestion)
    : snapPickupLoad(row.base, row.suggestion, row.increment)
  return { ...row, value, manual: false }
}

export function updatePickupValue(rows, id, value) {
  return rows.map(row => String(row.id) === String(id)
    ? { ...row, value: row.bodyweight ? Math.max(1, numberOr(value)) : Math.max(0, numberOr(value)), manual: true }
    : row)
}

export function pickupExercisesFromProgramme(programme, cycle = null) {
  const selected = cycle || programme?.cycle || (programme?.snapshot ? programme : null)
    || (Array.isArray(programme?.weeks) ? programme : null) || pickupCycleFor(programme)
  const weeks = Array.isArray(selected?.snapshot?.weeks) ? selected.snapshot.weeks
    : Array.isArray(selected?.snapshot) ? selected.snapshot
      : Array.isArray(selected?.weeks) ? selected.weeks : []
  const rows = []
  const byId = new Map()
  for (const week of weeks) {
    const days = Array.isArray(week?.days) ? week.days : Object.values(week?.days || {})
    for (const day of days) for (const session of Array.isArray(day?.sessions) ? day.sessions : []) {
      const routine = [session?.routine, session?.routineSnapshot, session?.snapshot]
        .find(candidate => candidate && typeof candidate === 'object' && Array.isArray(candidate.ex)) || {}
      const routineId = session?.routineId || routine?.id || session?.id || 'routine'
      for (const [exerciseIndex, exercise] of (Array.isArray(routine?.ex) ? routine.ex : []).entries()) {
        const id = exercise?.id
        const key = id == null ? null : String(id)
        if (key == null) continue
        const pickupKey = `${routineId}:${key}:${exerciseIndex}`
        const existing = byId.get(key)
        if (existing) {
          existing.pickupKeys = [...existing.pickupKeys, pickupKey]
          continue
        }
        const row = { ...exercise, key: pickupKey, pickupKeys: [pickupKey] }
        byId.set(key, row)
        rows.push(row)
      }
    }
  }
  return rows
}

export function pickupCycleFor(programme, preferred = null) {
  if (preferred && typeof preferred === 'object') return isPickupCycleEligible(preferred) ? preferred : null
  const cycles = Array.isArray(programme?.cycles) ? programme.cycles : []
  const activeProgrammeIds = new Set(
    cycles
      .filter(item => isActiveCycle(item))
      .map(item => cycleProgrammeIdentity(item))
      .filter(id => id != null)
      .map(id => String(id))
  )
  return [...cycles].reverse().find(item => {
    if (!isPickupCycleEligible(item)) return false
    const identity = cycleProgrammeIdentity(item)
    return !identity || !activeProgrammeIds.has(String(identity))
  }) || null
}

/** Resolve the IDs carried by Plan/Stats/Workout route state to the real namespace objects. */
export function resolvePickupContext({ state = {}, namespace = null, programme = null, cycle = null, programmeId = null, cycleId = null } = {}) {
  const source = versionedNamespaceOf(namespace) || versionedNamespaceOf(state) || state?.programmes || namespace || {}
  const definitions = Array.isArray(source?.definitions) ? source.definitions : []
  const cycles = Array.isArray(source?.cycles) ? source.cycles : []
  const explicitProgrammeInput = programme && !(programme.version === 1 && Array.isArray(programme.definitions) && Array.isArray(programme.cycles))
  const requestedProgrammeId = programmeId ?? state?.programmeId ?? (programme?.version === 1 ? null : programme?.id) ?? null
  const requestedCycleId = cycleId ?? state?.cycleId ?? null
  const cycleCandidate = cycle || state?.cycle || (requestedCycleId != null
    ? cycles.find(item => String(item?.id) === String(requestedCycleId)) || null
    : null)
  const repeatRequest = state?.mode === 'repeat' || state?.intent === 'repeat' || state?.startMode === 'repeat'
  const explicitProgrammeIdentity = explicitProgrammeInput
    ? programme?.id || programme?.definitionId || programme?.programmeId || null
    : null
  const explicitCycleIdentity = cycle ? cycleIdOf(cycle) : (cycleCandidate ? cycleIdOf(cycleCandidate) : null)
  const cycleProgrammeId = cycleCandidate ? cycleProgrammeIdentity(cycleCandidate) : null
  const selectedDefinitionFromCycle = cycleProgrammeId
    ? definitions.find(item => String(item?.id) === String(cycleProgrammeId)) || null
    : null
  const selectedDefinition = explicitProgrammeInput
    ? programme
    : requestedProgrammeId != null
      ? definitions.find(item => String(item?.id) === String(requestedProgrammeId)) || null
      : selectedDefinitionFromCycle
  const requestedProgrammeIdentity = requestedProgrammeId || selectedDefinition?.id || cycleProgrammeId || null
  const cycleScopeMismatch = requestedProgrammeIdentity != null && cycleProgrammeId != null
    && String(cycleProgrammeId) !== String(requestedProgrammeIdentity)
  const hasActiveProgrammeCycle = requestedProgrammeIdentity != null
    && cycles.some(item => isActiveCycle(item) && String(cycleProgrammeIdentity(item) || '') === String(requestedProgrammeIdentity))
  const blockedByActive = repeatRequest && hasActiveProgrammeCycle
  const requestedCycleMissing = requestedCycleId != null && !cycleCandidate
  const programmeIdMismatch = requestedProgrammeId != null && explicitProgrammeIdentity != null
    && String(explicitProgrammeIdentity) !== String(requestedProgrammeId)
  const cycleIdMismatch = requestedCycleId != null && explicitCycleIdentity != null
    && String(explicitCycleIdentity) !== String(requestedCycleId)
  const selectedCycle = cycleScopeMismatch || programmeIdMismatch || cycleIdMismatch || blockedByActive
    || (repeatRequest && !isPickupCycleEligible(cycleCandidate))
    ? null
    : cycleCandidate
  const snapshotDefinition = selectedCycle?.programmeSnapshot && typeof selectedCycle.programmeSnapshot === 'object'
    ? selectedCycle.programmeSnapshot
    : null
  const resolvedProgramme = selectedDefinition || snapshotDefinition || null
  const resolvedProgrammeId = resolvedProgramme ? (requestedProgrammeId ?? programmeIdOf(resolvedProgramme, selectedCycle)) : null
  const resolvedCycleId = selectedCycle ? (requestedCycleId ?? cycleIdOf(selectedCycle)) : null
  return {
    programme: resolvedProgramme,
    cycle: selectedCycle,
    programmeId: resolvedProgrammeId,
    cycleId: resolvedCycleId,
    valid: !cycleScopeMismatch && !programmeIdMismatch && !cycleIdMismatch && !requestedCycleMissing && !blockedByActive && !(repeatRequest && cycleCandidate && !isPickupCycleEligible(cycleCandidate)),
    namespace: source,
  }
}

function normalizePolicy(value) {
  const normalized = String(value || '').toLowerCase().trim()
  if (normalized === 'greyskull lp' || normalized === 'greyskull-lp') return 'greyskull'
  if (normalized === 'none' || normalized === 'no automatic' || normalized === 'no automatic progression') return 'off'
  return normalized
}

export function savedPickupPolicy({ programme = null, cycle = null, state = {}, savedPolicy = null } = {}) {
  const candidates = [
    state?.savedPolicy,
    state?.policy,
    savedPolicy,
    cycle?.policy,
    cycle?.prog,
    cycle?.progressionPolicy,
    cycle?.progression,
    cycle?.progression?.policy,
    programme?.policy,
    programme?.prog,
    programme?.progressionPolicy,
    programme?.progression,
    programme?.progression?.policy,
  ]
  const snapshot = cycle?.snapshot?.weeks || []
  for (const week of snapshot) {
    const days = Array.isArray(week?.days) ? week.days : Object.values(week?.days || {})
    for (const day of days) for (const session of day?.sessions || []) {
      const routine = [session?.routine, session?.routineSnapshot, session?.snapshot]
        .find(candidate => candidate && typeof candidate === 'object' && (candidate.prog || candidate.policy || candidate.progressionPolicy || Array.isArray(candidate.ex)))
      const value = routine?.prog || routine?.policy || routine?.progressionPolicy
      if (value != null) candidates.push(value)
      for (const exercise of routine?.ex || []) {
        const exercisePolicy = exercise?.prog || exercise?.policy || exercise?.progressionPolicy
        if (exercisePolicy != null) candidates.push(exercisePolicy)
      }
    }
  }
  return candidates.map(normalizePolicy).find(value => PICKUP_POLICIES.includes(value)) || 'off'
}

export function buildPickupAction({ intent = null, startMode = 'start', loadMode = null, mode = 'max', percent = 90, policy = 'off', rows = [], programme = null, cycle = null, programmeId = null, cycleId = null, unit = null } = {}) {
  const normalizedIntent = (intent || (startMode === 'repeat' ? 'repeat' : (mode === 'start' || mode === 'repeat' ? mode : 'start'))) === 'repeat' ? 'repeat' : 'start'
  const normalizedLoadMode = loadMode || (mode === 'deload' ? 'deload' : 'max')
  const retainedPercent = normalizedLoadMode === 'deload'
    ? Math.max(50, Math.min(100, numberOr(percent, 90)))
    : 100
  const normalizedPolicy = PICKUP_POLICIES.includes(policy) ? policy : normalizePolicy(policy)
  const finalRows = rows.map(row => ({ ...row }))
  const startingValues = {}
  const seenKeys = new Set()
  for (const row of finalRows) {
    if (row?.value === null || row?.value === undefined || row.value === '') continue
    if (!finite(row?.value)) continue
    const keys = Array.isArray(row?.pickupKeys) && row.pickupKeys.length
      ? row.pickupKeys
      : [row?.key || row?.id]
    for (const key of keys) {
      if (key == null || seenKeys.has(String(key))) continue
      seenKeys.add(String(key))
      startingValues[key] = Number(row.value)
    }
  }
  return {
    type: 'programme-pickup',
    // `mode` is the lifecycle intent consumed by the reserved route. `loadMode`
    // is deliberately separate so repeat/start cannot be confused with max/deload.
    mode: normalizedIntent,
    loadMode: normalizedLoadMode === 'deload' ? 'deload' : 'max',
    percent: retainedPercent,
    deloadPercent: normalizedLoadMode === 'deload' ? 100 - retainedPercent : 0,
    // Rows already contain the final displayed values. The lifecycle must not
    // apply the deload a second time; `startMode` records that fact explicitly.
    startMode: 'highest',
    startingValuesAreFinal: normalizedLoadMode === 'deload',
    policy: PICKUP_POLICIES.includes(normalizedPolicy) ? normalizedPolicy : 'off',
    unit: unit || null,
    rows: finalRows,
    startingValues,
    programmeId: programmeId || programmeIdOf(programme, cycle),
    cycleId: cycleId || cycleIdOf(cycle),
  }
}

/**
 * Deliver the single pickup action schema to the reserved programme lifecycle route.
 * The route owns state mutation; this adapter only validates intent/identity and
 * forwards final displayed values without applying another load transformation.
 */
export function consumePickupAction(action, handlers = {}) {
  if (!action || action.type !== 'programme-pickup') return null
  if (!['start', 'repeat'].includes(action.mode) || !action.programmeId) return null
  if (action.mode === 'repeat' && !action.cycleId) return null
  const handler = action.mode === 'repeat' ? handlers.repeat : handlers.start
  if (typeof handler !== 'function') return null
  return handler({
    ...action,
    progression: action.policy,
    startingValues: { ...(action.startingValues || {}) },
    rows: (action.rows || []).map(row => ({ ...row })),
  })
}
