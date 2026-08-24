import { localTZ, uid } from './format.js'
import { t } from './i18n-core.js'
import {
  materializeCycleInstances,
  projectProgrammeQueue,
  scheduleWriteContext,
  week1StartDate
} from './programmes.js'
import {
  bestWeightForEntry,
  isBw,
  lastEntryFor,
  metricModeForEntry,
  metricRowsForEntry,
  modeOf
} from './history.js'
import { REP_CAP } from './onerm.js'
// Programme completion only needs to exclude explicitly marked warm-up rows. Keep the
// ownership boundary local instead of importing the later phase/runtime helper set.
const isWorkRow = set => {
  if (!set || set.warmup === true) return false
  return set.phase == null || String(set.phase).trim().toLowerCase() === 'work'
}
import { defaultIncrement, nextPrescription } from './progression.js'
import { EXIDX } from './exercises.js'

function adaptiveE1RMFor(source, exerciseId) {
  let best = 0
  for (const workout of source?.workouts || []) {
    if (!historyUnitMatches(workout, source?.unit)) continue
    for (const entry of workout?.entries || []) {
      if (String(entry?.id) !== String(exerciseId)) continue
      for (const set of entry?.sets || []) {
        if (set?.done !== true || set?.warmup === true || (set?.phase != null && set.phase !== 'work')) continue
        const weight = Number(set?.w)
        const reps = Number(set?.r)
        if (!(weight > 0) || !(reps >= 1) || reps > REP_CAP) continue
        best = Math.max(best, reps === 1 ? weight : weight * (1 + reps / 30))
      }
    }
  }
  return best > 0 ? Math.round(best * 10) / 10 : 0
}

export const PROGRAMME_NAMESPACE_VERSION = 1

// Persist the palette key rather than a resolved colour so programme colours remain tied to
// the app's accent variables in both light and dark themes. `null` deliberately means no tint.
export const PROGRAMME_COLOURS = Object.freeze([
  { key: 'lime', css: 'var(--green)' },
  { key: 'sky', css: 'var(--blue)' },
  { key: 'orange', css: 'var(--orange)' },
  { key: 'gold', css: 'var(--yellow)' },
  { key: 'violet', css: 'var(--purple)' },
  { key: 'pink', css: 'var(--pink)' },
  { key: 'teal', css: 'var(--teal)' }
])

const PROGRAMME_COLOUR_BY_KEY = new Map(PROGRAMME_COLOURS.map(colour => [colour.key, colour]))

export function normalizeProgrammeColour(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return PROGRAMME_COLOUR_BY_KEY.has(key) ? key : null
}

export function programmeColourValue(value) {
  return PROGRAMME_COLOUR_BY_KEY.get(normalizeProgrammeColour(value))?.css || null
}

const clone = value => {
  if (Array.isArray(value)) return value.map(clone)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const sourceOf = state => state?.S && typeof state.S === 'object' ? state.S : state || {}
const lower = value => String(value || '').trim().toLowerCase()
const cycleIdOf = cycle => cycle?.id || cycle?.cycleId || null
const definitionIdOf = definition => definition?.id || definition?.programmeId || null
const calendarDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const parsed = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed / (24 * 60 * 60 * 1000)
    : NaN
}

function namespaceOf(state) {
  const source = sourceOf(state)
  if (source?.version === PROGRAMME_NAMESPACE_VERSION && (Array.isArray(source.cycles) || Array.isArray(source.definitions))) return source
  if (source?.programmes && !Array.isArray(source.programmes) && typeof source.programmes === 'object') return source.programmes
  return null
}

/** Return the versioned Programme namespace without turning legacy arrays into programme templates. */
export function programmeNamespace(state) {
  const namespace = namespaceOf(state)
  if (namespace) return namespace
  // S.programmes is an intentionally inert legacy/document namespace. Only a versioned object
  // with explicit definitions and cycles is eligible for the Programme UI or engine queue.
  return { version: PROGRAMME_NAMESPACE_VERSION, definitions: [], cycles: [] }
}

function definitionsFrom(namespace) {
  for (const key of ['definitions', 'programmes', 'templates']) {
    if (Array.isArray(namespace?.[key])) return namespace[key]
  }
  return []
}

function cyclesFrom(namespace) {
  return Array.isArray(namespace?.cycles) ? namespace.cycles : []
}

export function programmeDefinitions(state) {
  return definitionsFrom(programmeNamespace(state))
}

export function programmeCycles(state) {
  return cyclesFrom(programmeNamespace(state))
}

export function programmeDefinitionOf(state, id) {
  if (id == null) return null
  return programmeDefinitions(state).find(definition => String(definitionIdOf(definition)) === String(id)) || null
}

export function programmeCycleOf(state, id) {
  if (id == null) return null
  return programmeCycles(state).find(cycle => String(cycleIdOf(cycle)) === String(id)) || null
}

export function isActiveProgrammeCycle(cycle) {
  return ['active', 'running', 'current'].includes(lower(cycle?.status))
}

export function isCompletedProgrammeCycle(cycle) {
  return ['completed', 'complete', 'done', 'finished'].includes(lower(cycle?.status))
}

export function activeProgrammeCycles(state) {
  return programmeCycles(state).filter(isActiveProgrammeCycle)
}

export function completedProgrammeCycles(state) {
  return programmeCycles(state).filter(isCompletedProgrammeCycle)
}

function cycleProgrammeId(cycle) {
  return cycle?.programmeId ?? cycle?.definitionId ?? cycle?.programme?.id ?? null
}

export function activeProgrammeCycleFor(state, programmeId) {
  return activeProgrammeCycles(state).find(cycle => String(cycleProgrammeId(cycle)) === String(programmeId)) || null
}

/** A definition is ready whenever it has no active cycle; completed history is shown as Ready (Done). */
export function readyProgrammeDefinitions(state) {
  const activeDefinitions = new Set(activeProgrammeCycles(state).map(cycle => String(cycleProgrammeId(cycle))))
  return programmeDefinitions(state).filter(definition => {
    const id = definitionIdOf(definition)
    return id != null && !activeDefinitions.has(String(id))
  })
}

function definitionWeeks(definition) {
  const source = objectOf(definition)
  if (Array.isArray(source.weeks)) return source.weeks
  if (Array.isArray(source.weekTemplates)) return source.weekTemplates
  if (Array.isArray(source.snapshot?.weeks)) return source.snapshot.weeks
  return []
}

const WEEK_MODES = ['normal', 'deload', 'rest']
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

function safeMode(value) {
  const mode = lower(value)
  return WEEK_MODES.includes(mode) ? mode : 'normal'
}

function blankWeek(weekIndex) {
  return {
    weekIndex,
    mode: 'normal',
    days: WEEKDAYS.map(weekday => ({ weekday, sessions: [] }))
  }
}

function routineSession(routine, weekIndex, weekday, sessionIndex = 0) {
  if (!routine?.id) return null
  const suffix = `${routine.id}:w${weekIndex}:d${weekday}:s${sessionIndex + 1}`
  return {
    id: suffix,
    sessionTemplateId: suffix,
    routineId: routine.id,
    routineSnapshot: clone(routine)
  }
}

function copySessionForWeek(session, weekIndex, weekday, sessionIndex) {
  const source = clone(session || {})
  const routineId = source.routineId || source.routineSnapshot?.id || source.routine?.id || 'session'
  const suffix = `${routineId}:w${weekIndex}:d${weekday}:s${sessionIndex + 1}`
  delete source.instanceId
  return {
    ...source,
    id: suffix,
    sessionTemplateId: suffix,
    routineId,
    ...(source.routineSnapshot ? { routineSnapshot: clone(source.routineSnapshot) } : {})
  }
}

function copyWeekShape(week, weekIndex, { fillDays = false, rewriteSessionIds = false } = {}) {
  const source = objectOf(week)
  const days = Array.isArray(source.days)
    ? source.days.map((day, dayIndex) => {
      const weekday = Number(day?.weekday ?? day?.day ?? dayIndex + 1) || dayIndex + 1
      return {
        ...clone(day),
        weekday,
        sessions: Array.isArray(day?.sessions)
          ? day.sessions.map((session, sessionIndex) => rewriteSessionIds
            ? copySessionForWeek(session, weekIndex, weekday, sessionIndex)
            : clone(session))
          : []
      }
    })
    : []
  const filled = fillDays
    ? WEEKDAYS.map(weekday => days.find(day => day.weekday === weekday) || { weekday, sessions: [] })
    : days
  return {
    ...clone(source),
    weekIndex,
    mode: safeMode(source.mode),
    days: filled
  }
}

function currentWeekFromState(state) {
  const source = sourceOf(state)
  const routines = Array.isArray(source.routines) ? source.routines : []
  const schedule = source.week && typeof source.week === 'object' ? source.week : {}
  return {
    weekIndex: 1,
    mode: 'normal',
    days: WEEKDAYS.map(weekday => {
      const jsDay = weekday === 7 ? 0 : weekday
      const routineId = schedule[jsDay] ?? schedule[String(jsDay)]
      const routine = routines.find(item => String(item.id) === String(routineId))
      const session = routineSession(routine, 1, weekday)
      return { weekday, sessions: session ? [session] : [] }
    })
  }
}

export function programmeBuilderSources(state) {
  return [
    { value: 'current', label: 'My current week', kind: 'current' },
    { value: 'blank', label: 'Blank programme', kind: 'blank' },
    ...programmeDefinitions(state).map(definition => ({
      value: `programme:${definitionIdOf(definition)}`,
      label: definition.name || definition.title || 'Programme',
      kind: 'programme',
      definitionId: definitionIdOf(definition),
      progression: definition.progression || 'linear'
    }))
  ]
}

/** Return independent week templates for the v16 builder; no source object is mutated. */
export function programmeWeeksFromSource(state, sourceId = 'blank', length = 1) {
  const count = Math.max(1, Math.min(52, Math.round(Number(length) || 1)))
  const source = sourceOf(state)
  let seed = []
  let fillDays = false
  if (sourceId === 'current') {
    seed = [currentWeekFromState(source)]
    fillDays = true
  } else if (sourceId && sourceId.startsWith('programme:')) {
    const definition = programmeDefinitionOf(source, sourceId.slice('programme:'.length))
    seed = definitionWeeks(definition)
  }
  return Array.from({ length: count }, (_, index) => {
    const template = seed[index] || (seed.length ? seed[seed.length - 1] : null)
    return copyWeekShape(template || blankWeek(index + 1), index + 1, { fillDays: fillDays || !template })
  })
}

export function cycleWeekMode(week, requestedMode = null) {
  const current = safeMode(week?.mode)
  const next = requestedMode && WEEK_MODES.includes(lower(requestedMode))
    ? lower(requestedMode)
    : WEEK_MODES[(WEEK_MODES.indexOf(current) + 1) % WEEK_MODES.length]
  return { ...clone(week), mode: next }
}

/** Copy a week by zero-based index to any zero-based destination indexes. */
export function copyProgrammeWeekToTargets(weeks, sourceIndex, targetIndexes = []) {
  if (!Array.isArray(weeks) || !weeks[sourceIndex]) return Array.isArray(weeks) ? clone(weeks) : []
  const next = clone(weeks)
  const source = next[sourceIndex]
  for (const targetIndex of targetIndexes) {
    const index = Number(targetIndex)
    if (!Number.isInteger(index) || index < 0 || index >= next.length || index === sourceIndex) continue
    next[index] = copyWeekShape(source, index + 1, { fillDays: false, rewriteSessionIds: true })
  }
  return next
}

export function setProgrammeDaySessions(weeks, weekIndex, weekday, sessions) {
  const next = clone(weeks)
  const week = next[weekIndex]
  if (!week) return next
  const dayIndex = Array.isArray(week.days) ? week.days.findIndex(day => Number(day?.weekday) === Number(weekday)) : -1
  const day = dayIndex >= 0 ? week.days[dayIndex] : { weekday: Number(weekday), sessions: [] }
  const updated = { ...clone(day), weekday: Number(weekday), sessions: clone(Array.isArray(sessions) ? sessions : []) }
  if (dayIndex >= 0) week.days[dayIndex] = updated
  else week.days = [...(week.days || []), updated].sort((a, b) => Number(a.weekday) - Number(b.weekday))
  return next
}

/** Refresh every cloned occurrence of a routine when its draft is edited in the programme builder. */
export function syncProgrammeRoutineSnapshots(weeks, routine) {
  if (!routine?.id) return clone(weeks || [])
  return (Array.isArray(weeks) ? weeks : []).map(week => ({
    ...clone(week),
    days: (week?.days || []).map(day => ({
      ...clone(day),
      sessions: (day?.sessions || []).map(session => {
        const id = session?.routineId || session?.routineSnapshot?.id
        return String(id) === String(routine.id)
          ? { ...clone(session), routineId: routine.id, routineSnapshot: clone(routine) }
          : clone(session)
      })
    }))
  }))
}

/** Remove invalid routine occurrences before a definition is persisted. */
export function sanitizeProgrammeWeeks(weeks) {
  return (Array.isArray(weeks) ? weeks : []).map((week, index) => ({
    ...clone(week),
    weekIndex: Number(week?.weekIndex) || index + 1,
    days: (week?.days || []).map(day => ({
      ...clone(day),
      sessions: (day?.sessions || []).filter(session => {
        const snapshot = session?.routineSnapshot
        return Boolean(session?.routineId || snapshot?.id) && Array.isArray(snapshot?.ex) && snapshot.ex.length > 0
      })
    }))
  }))
}

function sessionExercises(definition) {
  const rows = new Map()
  definitionWeeks(definition).forEach(week => {
    ;(Array.isArray(week?.days) ? week.days : []).forEach(day => {
      ;(Array.isArray(day?.sessions) ? day.sessions : []).forEach(session => {
        const routine = session?.routineSnapshot || session?.routine || {}
        ;(Array.isArray(routine.ex) ? routine.ex : []).forEach((cfg, index) => {
          const routineId = session.routineId || routine.id || 'routine'
          const key = `${routineId}:${cfg.id}:${index}`
          // A pickup choice is per routine/exercise occurrence, not per calendar copy. The
          // same routine may appear in every week; keep the first template and let the cycle
          // snapshot apply that choice to each generated occurrence.
          if (!rows.has(key)) rows.set(key, { cfg, routine, routineId, index, key })
        })
      })
    })
  })
  return [...rows.values()]
}

function hasStartableSessions(definition) {
  return definitionWeeks(definition).some(week => safeMode(week?.mode) !== 'rest' &&
    (Array.isArray(week?.days) ? week.days : []).some(day => day?.rest !== true && day?.mode !== 'rest' &&
      (Array.isArray(day?.sessions) ? day.sessions : []).some(session => {
        const routine = session?.routineSnapshot || session?.routine || session?.snapshot
        return Array.isArray(routine?.ex) && routine.ex.length > 0
      })))
}

function lastSetFor(entry) {
  const sets = Array.isArray(entry?.sets) ? entry.sets.filter(set => set?.done !== false) : []
  return sets.length ? sets[sets.length - 1] : null
}

function unitToken(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (['kg', 'kilogram', 'kilograms'].includes(token)) return 'kg'
  if (['lb', 'lbs', 'pound', 'pounds'].includes(token)) return 'lb'
  return token || null
}

function historyUnitMatches(workout, expectedUnit) {
  const expected = unitToken(expectedUnit)
  if (!expected) return true
  const actual = unitToken(workout?.unit)
  return actual != null && actual === expected
}

function bestRecordedWeight(state, exerciseId) {
  // A history value is useful for pickup only when its unit is explicit and matches the
  // profile. Unitless and cross-unit rows stay out of the baseline instead of becoming a
  // silent kg/lb conversion.
  let best = 0
  for (const workout of state?.workouts || []) {
    if (!historyUnitMatches(workout, state?.unit)) continue
    for (const entry of workout?.entries || []) {
      if (String(entry?.id) !== String(exerciseId)) continue
      for (const set of entry?.sets || []) {
        if (set?.done !== true || !isWorkRow(set)) continue
        const value = Number(set?.w)
        if (Number.isFinite(value) && value > best) best = value
      }
    }
  }
  return best
}

// The load for a target rep count, derived from the estimated 1RM via the inverse
// Epley formula: heavier short sets and lighter long sets both land on a weight the
// user can actually complete for the programme's prescription. The estimation cap belongs
// to 1RM estimation, not to load conversion — a 12-rep prescription must land lighter
// than a 10-rep one, so the real target reps are used (capped at 20 for sanity).
function loadForRepTarget(e1rm, targetReps) {
  const reps = Math.min(Math.max(1, Number(targetReps) || 10), 20)
  return e1rm > 0 ? Math.round(e1rm / (1 + reps / 30) / 2.5) * 2.5 : 0
}

function pickupBaseline(state, cfg, mode, last) {
  if (mode === 'reps') {
    const best = bestRecordedWeight(state, cfg.id)
    const bodyweight = isBw(cfg) && !(Number(cfg.weight) > 0 || Number(cfg.resolvedWeight) > 0)
    if (bodyweight && !(best > 0)) return Number(last?.target?.reps || lastSetFor(last)?.r || cfg.reps) || 0
    if (best > 0 || Number(cfg.weight) > 0) return Math.max(best, Number(cfg.weight) || 0)
    return Number(last?.target?.reps || lastSetFor(last)?.r || cfg.reps) || 0
  }
  if (mode === 'time') return Number(last?.target?.sec || lastSetFor(last)?.sec || cfg.sec || cfg.seconds) || 0
  return Number(last?.target?.min || lastSetFor(last)?.min || cfg.min) || 0
}

/** History-derived rows used by ProgrammePickup; rows retain a stable key for manual overrides. */
export function pickupExerciseRows(state, definition, options = {}) {
  const source = { workouts: [], ...sourceOf(state) }
  const progression = options.progression || definition?.progression || 'off'
  return sessionExercises(definition).map(({ cfg, routine, routineId, index, key }) => {
    const mode = modeOf(cfg)
    const last = lastEntryFor(source, cfg.id, mode)
    const rawBest = mode === 'reps' ? bestRecordedWeight(source, cfg.id) : 0
    const configuredLoad = mode === 'reps' && (!isBw(cfg) || Number(cfg.weight) > 0 || Number(cfg.resolvedWeight) > 0)
    const weighted = mode === 'reps' && (configuredLoad || rawBest > 0)
    const e1rm = configuredLoad ? adaptiveE1RMFor(source, cfg.id, options.now ?? Date.now()) : 0
    const targetReps = mode === 'reps' ? (Number(cfg.reps) || 10) : 0
    // The baseline default is the 1RM-derived load for THIS prescription's rep target,
    // so a 3-rep historical weight never lands on a 12-rep set unchanged.
    const repAdjusted = loadForRepTarget(e1rm, targetReps)
    const baseline = mode === 'reps' && repAdjusted > 0
      ? repAdjusted
      : pickupBaseline(source, cfg, mode, last)
    const plan = nextPrescription(source, { ...cfg, prog: progression }, routine)
    const suggestion = mode === 'reps'
      ? (Number(plan.weight) > 0 ? Number(plan.weight) : repAdjusted > 0 ? repAdjusted : Number(plan.reps) || baseline)
      : mode === 'time'
        ? Number(plan.sec) || baseline
        : Number(plan.min) || baseline
    return {
      key,
      id: cfg.id,
      routineId,
      index,
      name: cfg.name || cfg.n || EXIDX[cfg.id]?.n || cfg.id,
      mode,
      unit: mode === 'reps' ? (weighted ? (source.unit || 'kg') : 'reps') : mode === 'time' ? 's' : 'min',
      baseline,
      suggestion,
      last,
      cfg,
      routine,
      best: rawBest,
      e1rm: mode === 'reps' && e1rm > 0 ? Math.round(e1rm * 10) / 10 : 0,
      targetReps
    }
  })
}

function snapLoad(value, step) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return step > 0 ? Math.round(numeric / step) * step : Math.round(numeric * 10) / 10
}

function exerciseValue(cfg, mode, key, startingValues) {
  const hasOverride = startingValues && Object.prototype.hasOwnProperty.call(startingValues, key)
  const override = hasOverride ? Number(startingValues[key]) : NaN
  if (Number.isFinite(override)) return override
  if (mode === 'reps') return (!isBw(cfg) || Number(cfg.weight) > 0 || Number(cfg.resolvedWeight) > 0)
    ? Number(cfg.weight || cfg.resolvedWeight) || 0
    : Number(cfg.reps) || 0
  if (mode === 'time') return Number(cfg.sec || cfg.seconds) || 0
  return Number(cfg.min) || 0
}

function configuredWeekMode(week, index, options) {
  return safeMode(options.weekModes?.[index] || week?.mode)
}

function runtimePolicy(mode, requested) {
  const selected = requested || 'off'
  return ['reps', 'time', 'cardio'].includes(mode)
    ? (mode === 'cardio' ? 'off' : (mode === 'reps'
      ? ['off', 'linear', 'greyskull', 'double'].includes(selected) ? selected : 'off'
      : ['off', 'time'].includes(selected) ? selected : 'off'))
    : 'off'
}

/** Apply pickup choices to immutable week templates before the engine materializes sessions. */
export function prepareProgrammeWeeks(weeks, options = {}) {
  const sourceWeeks = Array.isArray(weeks) ? weeks : []
  const requested = (options.lengthWeeks ?? options.weeks?.length ?? sourceWeeks.length) || 1
  const length = Math.max(1, Math.min(52, Math.round(Number(requested) || 1)))
  const policy = options.progression || 'off'
  const unit = options.unit || 'kg'
  const startFactor = options.startMode === 'deload'
    ? Math.max(0, 1 - Math.min(90, Math.max(0, Number(options.deloadPercent) || 10)) / 100)
    : 1
  return Array.from({ length }, (_, index) => {
    const original = sourceWeeks[index] || sourceWeeks[sourceWeeks.length - 1] || blankWeek(index + 1)
    const weekIndex = index + 1
    const mode = configuredWeekMode(original, index, options)
    const week = copyWeekShape(original, weekIndex, { fillDays: false })
    week.mode = mode
    week.days = week.days.map(day => ({
      ...day,
      sessions: (day.sessions || []).map(session => {
        const routine = session.routineSnapshot || session.routine || session.snapshot
        if (!routine || !Array.isArray(routine.ex)) return session
        const routineId = session.routineId || routine.id || 'routine'
        const nextRoutine = {
          ...clone(routine),
          ex: routine.ex.map((cfg, exerciseIndex) => {
            const modeOfExercise = modeOf(cfg)
            const key = `${routineId}:${cfg.id}:${exerciseIndex}`
            const base = exerciseValue(cfg, modeOfExercise, key, options.startingValues)
            const startingMode = options.startingValueModes?.[key]
            const weighted = modeOfExercise === 'reps' && (!isBw(cfg) || Number(cfg.weight) > 0 || Number(cfg.resolvedWeight) > 0 || startingMode === 'weight')
            const started = options.startingValuesAreFinal === true || modeOfExercise === 'cardio' || (modeOfExercise === 'reps' && !weighted)
              ? base
              : base * startFactor
            const selectedPolicy = runtimePolicy(modeOfExercise, policy)
            const step = Number(cfg.inc) > 0 ? Number(cfg.inc) : defaultIncrement(cfg.id, unit)
            const next = {
              ...clone(cfg),
              prog: selectedPolicy,
              programmeProgression: policy,
              programmeWeek: weekIndex,
              programmeStartMode: options.startMode || 'highest',
              programmeInitial: weekIndex === 1,
              programmeWeekMode: mode,
              programmeDeloadPercent: Number(options.deloadPercent) > 0 ? Number(options.deloadPercent) : 10
            }
            if (modeOfExercise === 'reps') {
              if (weighted) {
                const load = options.startingValuesAreFinal === true
                  ? Math.round(started * 10) / 10
                  : snapLoad(started, step)
                next.weight = load
                next.resolvedWeight = load
              } else {
                next.weight = 0
                next.reps = Math.max(1, Math.round(started))
              }
            } else if (modeOfExercise === 'time') {
              next.sec = Math.max(1, Math.round(started))
              if (Number(cfg.weight) > 0) next.weight = options.startingValuesAreFinal === true ? Math.round(Number(cfg.weight) * 10) / 10 : snapLoad(Number(cfg.weight) * startFactor, step)
            } else {
              next.min = Math.max(1, Math.round(started * 10) / 10)
            }
            if (mode === 'deload') {
              next.sets = Math.max(1, Math.ceil(Number(next.sets || 1) / 2))
              const alreadyStartedLight = options.startMode === 'deload' && weekIndex === 1
              const deloadFactor = 1 - Math.min(90, Math.max(0, Number(options.deloadPercent) || 10)) / 100
              if (modeOfExercise === 'reps') {
                if (weighted) {
                  if (next.programmePreDeloadWeight == null) next.programmePreDeloadWeight = Number(next.weight) || 0
                  if (!alreadyStartedLight && Number(next.weight) > 0) {
                    next.weight = snapLoad(next.weight * deloadFactor, step)
                    next.resolvedWeight = next.weight
                  }
                } else {
                  if (next.programmePreDeloadReps == null) next.programmePreDeloadReps = Number(next.reps) || 0
                  if (!alreadyStartedLight && Number(next.reps) > 0) next.reps = Math.max(1, Math.floor(next.reps * deloadFactor))
                }
              } else if (modeOfExercise === 'time') {
                if (next.programmePreDeloadSec == null) next.programmePreDeloadSec = Number(next.sec) || 0
                if (!alreadyStartedLight && Number(next.sec) > 0) next.sec = Math.max(1, Math.round(next.sec * deloadFactor))
                if (Number(next.weight) > 0) {
                  if (next.programmePreDeloadWeight == null) next.programmePreDeloadWeight = Number(next.weight) || 0
                  if (!alreadyStartedLight) next.weight = snapLoad(next.weight * deloadFactor, step)
                }
              }
            }
            return next
          })
        }
        return { ...session, routineSnapshot: nextRoutine }
      })
    }))
    return week
  })
}

function definitionSnapshot(definition) {
  const source = objectOf(definition)
  const { weeks: _weeks, weekTemplates: _weekTemplates, snapshot: _snapshot, color: legacyColour, ...rest } = source
  const rawColour = Object.prototype.hasOwnProperty.call(source, 'colour') ? source.colour : legacyColour
  return {
    ...clone(rest),
    id: definitionIdOf(definition),
    name: String(source.name || source.title || 'Programme'),
    colour: normalizeProgrammeColour(rawColour),
    ...(source.emoji != null ? { emoji: source.emoji } : {}),
    ...(source.progression != null ? { progression: source.progression } : {}),
    weeks: clone(definitionWeeks(definition))
  }
}

function isoNow(value) {
  const at = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString()
}

function maxWeeks(definition) {
  return Math.max(1, definitionWeeks(definition).reduce((max, week, index) => {
    const number = Number(week?.weekIndex ?? week?.index ?? index + 1)
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0))
}

/** Build a durable active cycle from a definition's week templates. */
export function createProgrammeCycle(definition, options = {}) {
  const source = objectOf(definition)
  const programmeId = definitionIdOf(source)
  if (!programmeId) return null
  const now = options.now ?? Date.now()
  const timeZone = options.timeZone || source.timeZone || localTZ()
  const context = scheduleWriteContext({ now, timeZone })
  const anchor = week1StartDate({ now, timeZone })
  const snapshot = definitionSnapshot(source)
  const configured = Array.isArray(options.weeks) || options.startingValues != null || options.progression != null ||
    Array.isArray(options.weekModes) || options.startMode === 'deload' || options.deloadPercent != null
  if (configured) {
    snapshot.weeks = prepareProgrammeWeeks(options.weeks || snapshot.weeks, {
      ...options,
      lengthWeeks: options.lengthWeeks ?? options.weeks?.length ?? snapshot.weeks.length
    })
  }
  const cycleId = options.cycleId || `cycle:${programmeId}:${uid()}`
  const createdAt = context.recordedAt || isoNow(now)
  return {
    id: cycleId,
    programmeId,
    programmeRevision: Number(source.revision ?? source.version ?? 1) || 1,
    status: 'active',
    createdAt,
    startedAt: createdAt,
    completedAt: null,
    completionReason: null,
    week1StartDate: anchor,
    timeZone: context.timeZone,
    timeZoneOffsetMinutes: context.offsetMinutes,
    calendarDate: context.calendarDate,
    lengthWeeks: snapshot.weeks.length || maxWeeks(source),
    progression: options.progression || source.progression || source.progressionStyle || null,
    startMode: options.startMode || 'highest',
    deloadPercent: Number.isFinite(Number(options.deloadPercent)) ? Number(options.deloadPercent) : null,
    unit: options.unit || source.unit || null,
    startingValues: options.startingValues ? clone(options.startingValues) : null,
    startingValueModes: options.startingValueModes ? clone(options.startingValueModes) : null,
    startingValuesAreFinal: options.startingValuesAreFinal === true,
    projectionPrepared: configured,
    colour: snapshot.colour,
    programmeSnapshot: snapshot,
    snapshot: { weeks: clone(snapshot.weeks), colour: snapshot.colour }
  }
}

function namespaceDraft(state) {
  const source = sourceOf(state)
  if (source?.version === PROGRAMME_NAMESPACE_VERSION && !source.programmes && (Array.isArray(source.cycles) || Array.isArray(source.definitions))) {
    if (!Array.isArray(source.cycles)) source.cycles = []
    if (!Array.isArray(source.definitions)) source.definitions = []
    return source
  }
  if (source.programmes && !Array.isArray(source.programmes) && typeof source.programmes === 'object') {
    if (!Array.isArray(source.programmes.cycles)) source.programmes.cycles = []
    if (!Array.isArray(source.programmes.definitions)) {
      const legacy = Array.isArray(source.programmes.programmes) ? source.programmes.programmes : []
      source.programmes.definitions = legacy
    }
    if (source.programmes.version !== PROGRAMME_NAMESPACE_VERSION) source.programmes.version = PROGRAMME_NAMESPACE_VERSION
    return source.programmes
  }
  source.programmes = { version: PROGRAMME_NAMESPACE_VERSION, definitions: [], cycles: [] }
  return source.programmes
}

function definitionFromCycle(cycle) {
  const snapshot = cycle?.programmeSnapshot || cycle?.programme
    || (cycle?.snapshot && typeof cycle.snapshot === 'object' ? cycle.snapshot : null)
  if (!snapshot || typeof snapshot !== 'object') return null
  const colour = Object.prototype.hasOwnProperty.call(snapshot, 'colour')
    ? snapshot.colour
    : Object.prototype.hasOwnProperty.call(snapshot, 'color') ? snapshot.color : cycle?.colour
  return {
    ...clone(snapshot),
    id: definitionIdOf(snapshot) || cycleProgrammeId(cycle),
    colour: normalizeProgrammeColour(colour),
    weeks: clone(definitionWeeks(snapshot))
  }
}

/** Return the effective active-cycle snapshot used by the editor, including lazy projections. */
export function programmeEditorDefinitionForCycle(cycle) {
  return definitionFromCycle(projectedCycle(cycle))
}

function resolveDefinition(state, definitionOrId) {
  if (definitionOrId && typeof definitionOrId === 'object') return definitionOrId
  const found = programmeDefinitionOf(state, definitionOrId)
  if (found) return found
  const cycles = programmeCycles(state).filter(cycle => String(cycleProgrammeId(cycle)) === String(definitionOrId))
  return definitionFromCycle(cycles.at(-1))
}

function addDefinitionIfMissing(namespace, definition) {
  const id = definitionIdOf(definition)
  if (!id) return
  if (!Array.isArray(namespace.definitions)) namespace.definitions = []
  if (!namespace.definitions.some(item => String(definitionIdOf(item)) === String(id))) {
    namespace.definitions.push(clone({ ...definition, id }))
  }
}

/** Start the definition in a mutable store draft, returning an existing active cycle if present. */
export function startProgrammeCycleInState(state, definitionOrId, options = {}) {
  const namespace = namespaceDraft(state)
  const definition = resolveDefinition({ ...sourceOf(state), programmes: namespace }, definitionOrId)
  if (!definition) return null
  if (!hasStartableSessions(definition)) return null
  const programmeId = definitionIdOf(definition)
  const existing = namespace.cycles.find(cycle => isActiveProgrammeCycle(cycle) && String(cycleProgrammeId(cycle)) === String(programmeId))
  if (existing) return existing
  addDefinitionIfMissing(namespace, definition)
  const cycle = createProgrammeCycle(definition, options)
  if (!cycle) return null
  namespace.cycles.push(cycle)
  return cycle
}

export function completeProgrammeCycleInState(state, cycleId, options = {}) {
  const namespace = namespaceDraft(state)
  const cycle = namespace.cycles.find(item => String(cycleIdOf(item)) === String(cycleId))
  if (!cycle || !isActiveProgrammeCycle(cycle)) return cycle || null
  const now = options.now ?? Date.now()
  const context = scheduleWriteContext({ now, timeZone: options.timeZone || cycle.timeZone })
  cycle.status = 'completed'
  cycle.completedAt = context.recordedAt || isoNow(now)
  cycle.completionReason = options.reason || 'early'
  cycle.completionCalendarDate = context.calendarDate
  captureProgrammeCompletionSummaries(state, cycle)
  return cycle
}

/** Apply edits to one active cycle's immutable snapshot without changing its reusable definition. */
export function updateActiveProgrammeCycleInState(state, cycleId, input = {}, options = {}) {
  const namespace = namespaceDraft(state)
  const cycle = namespace.cycles.find(item => String(cycleIdOf(item)) === String(cycleId))
  if (!cycle || !isActiveProgrammeCycle(cycle)) return null
  const source = objectOf(input)
  const weeks = Array.isArray(source.weeks) ? clone(source.weeks) : cycleSnapshotWeeks(cycle)
  const snapshot = definitionSnapshot({
    ...clone(cycle.programmeSnapshot || {}),
    ...clone(source),
    id: cycleProgrammeId(cycle),
    weeks
  })
  const now = options.now ?? Date.now()
  cycle.programmeSnapshot = snapshot
  cycle.colour = snapshot.colour
  cycle.snapshot = { ...clone(cycle.snapshot || {}), weeks: clone(snapshot.weeks), colour: snapshot.colour }
  cycle.lengthWeeks = snapshot.weeks.length || cycle.lengthWeeks || 1
  cycle.progression = snapshot.progression || cycle.progression || null
  cycle.projectionPrepared = true
  cycle.editedAt = isoNow(now)
  cycle.cycleRevision = (Number(cycle.cycleRevision) || 0) + 1
  return cycle
}

/** Repeat a definition/cycle while leaving the prior completed cycle immutable in history. */
export function repeatProgrammeCycleInState(state, definitionOrCycleId, options = {}) {
  const namespace = namespaceDraft(state)
  let definition = resolveDefinition({ ...sourceOf(state), programmes: namespace }, definitionOrCycleId)
  const sourceCycle = namespace.cycles.find(cycle => String(cycleIdOf(cycle)) === String(definitionOrCycleId))
  if (!definition && sourceCycle) definition = definitionFromCycle(sourceCycle)
  if (!definition) return null
  if (!hasStartableSessions(definition)) return null
  const programmeId = definitionIdOf(definition)
  const existing = namespace.cycles.find(cycle => isActiveProgrammeCycle(cycle) && String(cycleProgrammeId(cycle)) === String(programmeId))
  if (existing) return null
  addDefinitionIfMissing(namespace, definition)
  const cycle = createProgrammeCycle(definition, options)
  if (!cycle) return null
  cycle.repeatOf = sourceCycle?.id || (typeof definitionOrCycleId === 'object' ? definitionOrCycleId.id : null) || null
  namespace.cycles.push(cycle)
  return cycle
}

export function addProgrammeDefinitionInState(state, definition) {
  const namespace = namespaceDraft(state)
  const source = objectOf(definition)
  const id = definitionIdOf(source) || `programme:${uid()}`
  const rawColour = Object.prototype.hasOwnProperty.call(source, 'colour') ? source.colour : source.color
  const next = {
    ...clone(source),
    id,
    name: String(source.name || source.title || 'Programme'),
    colour: normalizeProgrammeColour(rawColour),
    weeks: clone(definitionWeeks(source))
  }
  const existing = namespace.definitions.find(item => String(definitionIdOf(item)) === String(id))
  if (existing) Object.assign(existing, next)
  else namespace.definitions.push(next)
  return next
}

export function createProgrammeDefinition(input = {}, options = {}) {
  const source = objectOf(input)
  const rawColour = Object.prototype.hasOwnProperty.call(source, 'colour') ? source.colour : source.color
  const weeks = Array.isArray(source.weeks) ? source.weeks : []
  const requestedLength = options.lengthWeeks ?? source.lengthWeeks ?? (weeks.length || 1)
  const length = Math.max(1, Math.min(52, Math.round(Number(requestedLength) || 1)))
  const templates = Array.from({ length }, (_, index) => clone(weeks[index] || {
    weekIndex: index + 1,
    mode: 'normal',
    days: []
  }))
  templates.forEach((week, index) => {
    week.weekIndex = Number(week.weekIndex ?? index + 1) || index + 1
  })
  return {
    id: source.id || `programme:${uid()}`,
    name: String(source.name || source.title || 'Programme'),
    emoji: source.emoji || 'dumbbell',
    progression: source.progression || source.progressionStyle || 'linear',
    colour: normalizeProgrammeColour(rawColour),
    weeks: templates,
    createdAt: source.createdAt || new Date().toISOString()
  }
}

function cycleSnapshotWeeks(cycle) {
  return Array.isArray(cycle?.snapshot?.weeks) ? cycle.snapshot.weeks : Array.isArray(cycle?.weeks) ? cycle.weeks : []
}

function projectedCycle(cycle) {
  if (!cycle || cycle.projectionPrepared === true) return clone(cycle)
  const weeks = cycleSnapshotWeeks(cycle)
  const configured = cycle.startingValues != null || cycle.progression != null || cycle.startMode === 'deload' || cycle.deloadPercent != null
  if (!configured || !weeks.length) return clone(cycle)
  const prepared = prepareProgrammeWeeks(weeks, {
    progression: cycle.progression || 'off',
    startMode: cycle.startMode || 'highest',
    deloadPercent: cycle.deloadPercent,
    startingValues: cycle.startingValues,
    startingValueModes: cycle.startingValueModes,
    startingValuesAreFinal: cycle.startingValuesAreFinal === true,
    unit: cycle.unit || 'kg',
    lengthWeeks: cycle.lengthWeeks || weeks.length
  })
  return {
    ...clone(cycle),
    projectionPrepared: true,
    programmeSnapshot: { ...(clone(cycle.programmeSnapshot) || {}), weeks: clone(prepared) },
    snapshot: { ...(clone(cycle.snapshot) || {}), weeks: clone(prepared) }
  }
}

function projectedCycles(state) {
  return programmeCycles(state).map(projectedCycle)
}

export function programmeCycleItems(cycle, options = {}) {
  return materializeCycleInstances(projectedCycle(cycle), options)
}

/** Use the shared mixed queue for day ownership; this includes projected/owed dates. */
export function programmeScheduleForDate(state, date, options = {}) {
  try {
    const queue = programmeProjection(state, options)
    return queue.items.filter(item => item.source === 'programme' && item.projectedDate === date)
  } catch {
    return []
  }
}

export function programmeProjection(state, options = {}) {
  const source = sourceOf(state)
  const namespace = programmeNamespace(source)
  try {
    return projectProgrammeQueue({
      ...clone(namespace),
      cycles: projectedCycles(source),
      workouts: clone(source.workouts || []),
      programmeDispositions: clone(source.programmeDispositions || null)
    }, options)
  } catch {
    return { items: [], cycleQueues: [], fronts: [], programmeFronts: [], queue: [], eligible: [], owed: [], front: null, blocked: null, diagnostics: [] }
  }
}

export function programmeNameForItem(state, item) {
  const definition = programmeDefinitionOf(state, item?.programmeId)
  const cycle = programmeCycleOf(state, item?.cycleId)
  return cycle?.programmeSnapshot?.name || definition?.name || item?.programmeId || 'Programme'
}

export function programmeLabelForItem(state, item) {
  const source = sourceOf(state)
  const definition = programmeDefinitionOf(state, item?.programmeId)
  const cycle = programmeCycleOf(state, item?.cycleId)
  const name = cycle?.programmeSnapshot?.name || definition?.name || item?.programmeId || 'Programme'
  const snapshotRoutine = item?.routineSnapshot
  const routine = (snapshotRoutine?.name ? snapshotRoutine : null)
    || (Array.isArray(source.routines)
      ? source.routines.find(candidate => String(candidate.id) === String(item?.routineId))
      : null)
    || snapshotRoutine
  const routineName = routine?.name || item?.routineId || t('Routine')
  return t('{0} · {1}', name, routineName)
}

export function programmeColourForItem(state, item) {
  const definition = programmeDefinitionOf(state, item?.programmeId)
  const cycle = programmeCycleOf(state, item?.cycleId)
  const cycleSnapshot = cycle?.programmeSnapshot
  let colour
  if (cycleSnapshot && Object.prototype.hasOwnProperty.call(cycleSnapshot, 'colour')) colour = cycleSnapshot.colour
  else if (cycle?.snapshot && Object.prototype.hasOwnProperty.call(cycle.snapshot, 'colour')) colour = cycle.snapshot.colour
  else if (cycle && Object.prototype.hasOwnProperty.call(cycle, 'colour')) colour = cycle.colour
  else if (definition && Object.prototype.hasOwnProperty.call(definition, 'colour')) colour = definition.colour
  else colour = definition?.color
  return programmeColourValue(colour)
}

export function programmeCurrentWeek(cycle, options = {}) {
  const weeks = cycleSnapshotWeeks(cycle)
  if (!weeks.length) return 1
  const items = programmeCycleItems(cycle, options)
  const date = scheduleWriteContext({ now: options.now ?? Date.now(), timeZone: options.timeZone || cycle?.timeZone }).calendarDate
  const due = items.filter(item => item.nominalDate <= date)
  const current = due.length ? Math.max(...due.map(item => Number(item.weekIndex) || 1)) : 1
  const max = Math.max(...weeks.map((week, index) => Number(week?.weekIndex ?? index + 1) || index + 1))
  return Math.min(max, Math.max(1, current))
}

export function programmeWeekState(week = {}, index = 0) {
  const mode = lower(week.mode || week.kind || week.status)
  return {
    index: Number(week.weekIndex ?? week.index ?? index + 1) || index + 1,
    mode: mode === 'deload' || mode === 'rest' ? mode : 'normal',
    label: mode === 'deload' ? 'Deload' : mode === 'rest' ? 'Rest' : 'Build'
  }
}

export function programmeSummary(state, cycle, options = {}) {
  const definition = programmeDefinitionOf(state, cycleProgrammeId(cycle))
  const snapshot = cycle?.programmeSnapshot || {}
  const weeks = cycleSnapshotWeeks(cycle)
  return {
    cycle,
    definition,
    name: snapshot.name || definition?.name || cycleProgrammeId(cycle) || 'Programme',
    emoji: snapshot.emoji || definition?.emoji || 'dumbbell',
    weeks,
    currentWeek: programmeCurrentWeek(cycle, options),
    totalWeeks: cycle?.lengthWeeks || weeks.length || 1,
    progression: snapshot.progression || definition?.progression || cycle?.progression || null
  }
}

function targetValueForTimeline(target = {}, cfg = {}, mode = modeOf(cfg), unit = 'kg') {
  const source = { ...cfg, ...objectOf(target) }
  if (mode === 'time') return `${Number(source.sec || source.seconds || 0) || 0}s`
  if (mode === 'cardio') return `${Number(source.min) || 0}m`
  const reps = Number(source.reps || source.r || 0) || 0
  const weight = Number(source.weight ?? source.w ?? 0) || 0
  return weight > 0 ? `${weight} ${unit} × ${reps}` : `${reps} reps`
}

function timelineWorkoutWeek(workout) {
  const source = workout?.programmeStep || workout?.programmeInstance || workout?.programme || workout
  const week = Number(source?.weekIndex ?? source?.week ?? source?.programmeWeek)
  return Number.isInteger(week) && week > 0 ? week : null
}

function timelineWorkoutSource(workout) {
  return workout?.programmeStep || workout?.programmeInstance || workout?.programme || workout || {}
}

function timelineWorkoutInstanceId(workout) {
  const source = timelineWorkoutSource(workout)
  return source?.instanceId || workout?.instanceId || null
}

function timelineWorkoutDate(workout) {
  const source = timelineWorkoutSource(workout)
  const raw = source?.nominalDate || workout?.nominalDate || workout?.date || workout?.d || workout?.start || workout?.end
  const time = raw == null ? NaN : Date.parse(String(raw))
  return Number.isFinite(time) ? time : null
}

function timelineWorkoutActualDate(workout) {
  const raw = workout?.d || workout?.date || workout?.start || workout?.end
  const time = raw == null ? NaN : Date.parse(String(raw))
  return Number.isFinite(time) ? time : null
}

function timelineWorkoutAtOrBeforeItem(workout, item, itemDate) {
  if (timelineWorkoutInstanceId(workout) && timelineWorkoutInstanceId(workout) === item.instanceId) return true
  const source = timelineWorkoutSource(workout)
  const workoutDate = timelineWorkoutDate(workout)
  if (workoutDate != null && itemDate != null) {
    if (workoutDate < itemDate) return true
    if (workoutDate > itemDate) return false
  }
  const workoutWeekday = Number(source.weekday ?? workout.weekday)
  const itemWeekday = Number(item.weekday)
  if (Number.isInteger(workoutWeekday) && Number.isInteger(itemWeekday) && workoutWeekday !== itemWeekday) {
    return workoutWeekday < itemWeekday
  }
  const workoutOrdinal = Number(source.ordinal ?? workout.ordinal)
  const itemOrdinal = Number(item.ordinal)
  if (Number.isInteger(workoutOrdinal) && Number.isInteger(itemOrdinal) && workoutOrdinal !== itemOrdinal) {
    return workoutOrdinal < itemOrdinal
  }
  // A tagged record with only the same nominal date is the record for that item. This keeps
  // rescheduled/late records attached to their session while still excluding a later weekday.
  if (workoutDate != null && itemDate != null && workoutDate === itemDate) return true
  const actualDate = timelineWorkoutActualDate(workout)
  return actualDate != null && itemDate != null && actualDate <= itemDate
}

function timelineWorkoutsForItem(source, cycle, item) {
  const cycleId = cycleIdOf(cycle)
  const weekIndex = Number(item.weekIndex) || 1
  const itemDate = timelineWorkoutDate({ d: item.nominalDate })
  return (Array.isArray(source.workouts) ? source.workouts : []).filter(workout => {
    if (!workoutBelongsToCycle(workout, cycleId)) return false
    const workoutWeek = timelineWorkoutWeek(workout)
    if (workoutWeek != null) {
      if (workoutWeek < weekIndex) return true
      if (workoutWeek > weekIndex) return false
      return timelineWorkoutAtOrBeforeItem(workout, item, itemDate)
    }
    const workoutDate = timelineWorkoutDate(workout)
    if (workoutDate == null || itemDate == null) return false
    return workoutDate <= itemDate
  })
}

/** Build the active detail's per-exercise last → next timeline without mutating persisted state. */
function exerciseNameOf(source, cfg) {
  if (cfg?.name) return cfg.name
  if (cfg?.n) return cfg.n
  const custom = (source?.customEx || []).find(item => String(item.id) === String(cfg?.id))
  if (custom?.n) return custom.n
  return EXIDX[cfg?.id]?.n || cfg?.id
}

export function programmeTimelineForCycle(state, cycle, options = {}) {
  const source = { unit: 'kg', workouts: [], ...sourceOf(state) }
  const items = programmeCycleItems(cycle, options)
  const currentWeek = programmeCurrentWeek(cycle, options)
  const weeks = cycleSnapshotWeeks(cycle).map((week, index) => {
    const weekIndex = Number(week?.weekIndex ?? index + 1) || index + 1
    const weekItems = items.filter(item => Number(item.weekIndex) === weekIndex)
    return {
      index: weekIndex,
      mode: safeMode(week?.mode),
      current: weekIndex === currentWeek,
      guidance: weekIndex === currentWeek ? 'current' : weekIndex < currentWeek ? 'checkpoint' : 'upcoming',
      items: weekItems.map(item => {
        const timelineSource = { ...source, workouts: timelineWorkoutsForItem(source, cycle, item) }
        const routine = item.routineSnapshot || {}
        const exercises = (Array.isArray(routine.ex) ? routine.ex : []).map((cfg, index) => {
          const mode = modeOf(cfg)
          const occurrenceId = `${cfg.id}#${index + 1}`
          const last = lastEntryFor(timelineSource, cfg.id, mode, occurrenceId)
          const policy = runtimePolicy(mode, cfg.prog || cycle.progression || 'off')
          const resolved = { ...cfg, prog: policy, occurrenceId }
          const deload = safeMode(week?.mode) === 'deload' || cfg.programmeWeekMode === 'deload'
          const plan = deload ? { policy, kind: 'hold', why: [] } : nextPrescription(timelineSource, resolved, routine)
          const lastTarget = last?.target || lastSetFor(last) || null
          const nextTarget = deload || (plan?.kind && ['off', 'first'].includes(plan.kind)) ? cfg : plan
          const unit = mode === 'reps' ? (source.unit || 'kg') : mode === 'time' ? 's' : 'min'
          return {
            key: `${item.instanceId}:${occurrenceId}`,
            id: cfg.id,
            name: exerciseNameOf(source, cfg),
            mode,
            policy,
            kind: plan.kind,
            last: lastTarget ? targetValueForTimeline(lastTarget, cfg, mode, unit) : '—',
            next: targetValueForTimeline(nextTarget, cfg, mode, unit),
            why: plan.why || [],
            notes: cfg.notes || null,
            sg: cfg.sg || null,
            rest: cfg.workRestSec != null ? Number(cfg.workRestSec) : null
          }
        })
        return {
          ...item,
          routineName: routine.name || item.routineId,
          exercises
        }
      })
    }
  })
  return { cycle, currentWeek, totalWeeks: weeks.length || 1, weeks }
}

function workoutBelongsToCycle(workout, cycleId) {
  return workout?.cycleId === cycleId || workout?.programmeInstance?.cycleId === cycleId ||
    workout?.programmeStep?.cycleId === cycleId
}

/** Summarise the strongest mode-compatible metric recorded inside a completed cycle. */
export function programmePRSummary(state, cycle) {
  const source = { unit: 'kg', workouts: [], ...sourceOf(state) }
  const best = new Map()
  source.workouts.filter(workout => workoutBelongsToCycle(workout, cycleIdOf(cycle))).forEach(workout => {
    ;(workout.entries || []).forEach(entry => {
      const mode = metricModeForEntry(entry, modeOf(entry))
      const rows = metricRowsForEntry(entry, mode)
      if (!rows.length) return
      let value = 0
      let unit = mode === 'reps' ? (workout.unit || source.unit || 'kg') : mode === 'time' ? 's' : 'min'
      if (mode === 'reps') value = bestWeightForEntry(entry)
      else if (mode === 'time') value = Math.max(...rows.map(row => Number(row.sec) || 0))
      else value = Math.max(...rows.map(row => Number(row.min) || 0))
      if (!(value > 0)) return
      const name = entry.name || entry.exerciseName || entry.label || entry.id || 'Exercise'
      const previous = best.get(name)
      if (!previous || value > previous.value) best.set(name, { name, value, unit, mode })
    })
  })
  return [...best.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

/** Week-1 -> final-week progress per exercise: best working weight, estimated 1RM and
 *  total volume, captured from the cycle's own workouts at completion so historical
 *  programmes keep the before/after picture even if workouts are later pruned. */
export function programmeProgressSummary(state, cycle) {
  const source = { unit: 'kg', workouts: [], customEx: [], ...sourceOf(state) }
  const cycleId = cycleIdOf(cycle)
  const dateOnly = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)
  const start = dateOnly(cycle?.week1StartDate)
  const startDay = calendarDay(start)
  const lengthWeeks = Math.max(1, Number(cycle?.lengthWeeks) || 1)
  const byExercise = new Map()
  const push = (name, week, metric, value) => {
    if (!(value > 0)) return
    let bucket = byExercise.get(name)
    if (!bucket) { bucket = { name, weeks: new Map() }; byExercise.set(name, bucket) }
    const w = bucket.weeks.get(week)
    if (!w) bucket.weeks.set(week, { weight: 0, rm1: 0, volume: 0 })
    const row = bucket.weeks.get(week)
    if (metric === 'weight') row.weight = Math.max(row.weight, value)
    if (metric === 'rm1') row.rm1 = Math.max(row.rm1, value)
    if (metric === 'volume') row.volume += value
  }
  const nameOf = entry => entry?.name || entry?.exerciseName || entry?.label || (() => {
    const custom = (source.customEx || []).find(item => String(item.id) === String(entry?.id))
    return custom?.n || EXIDX[entry?.id]?.n || entry?.id || 'Exercise'
  })()
  ;(Array.isArray(source.workouts) ? source.workouts : []).forEach(workout => {
    if (!workoutBelongsToCycle(workout, cycleId)) return
    const d = dateOnly(workout?.d || workout?.start)
    const provenance = workout?.programmeStep || workout?.programmeInstance || workout?.programme || workout
    const persistedWeek = Number(provenance?.weekIndex ?? provenance?.week ?? provenance?.programmeWeek)
    let week = Number.isInteger(persistedWeek) && persistedWeek > 0 ? persistedWeek : 1
    if (!(Number.isInteger(persistedWeek) && persistedWeek > 0) && d && Number.isFinite(startDay)) {
      const day = calendarDay(d)
      if (Number.isFinite(day)) week = Math.floor((day - startDay) / 7) + 1
    }
    week = Math.max(1, Math.min(lengthWeeks, week))
    ;(workout.entries || []).forEach(entry => {
      const mode = modeOf(entry.target || entry)
      const name = nameOf(entry)
      ;(entry.sets || []).forEach(set => {
        if (!isWorkRow(set) || set.done !== true) return
        const w = Number(set.w) || 0
        const r = Number(set.r) || 0
        if (w <= 0 || r < 1) return
        if (mode === 'reps') {
          push(name, week, 'weight', w)
          push(name, week, 'rm1', w * (1 + Math.min(r, REP_CAP) / 30))
          push(name, week, 'volume', w * r)
        }
      })
    })
  })
  return [...byExercise.values()].map(bucket => {
    const weeks = [...bucket.weeks.keys()].sort((a, b) => a - b)
    const first = bucket.weeks.get(weeks[0])
    const last = bucket.weeks.get(weeks[weeks.length - 1])
    return {
      name: bucket.name,
      unit: source.unit || 'kg',
      weeks: weeks.length,
      weight: first && last ? { first: Math.round(first.weight * 10) / 10, last: Math.round(last.weight * 10) / 10 } : null,
      rm1: first && last ? { first: Math.round(first.rm1 * 10) / 10, last: Math.round(last.rm1 * 10) / 10 } : null,
      volume: first && last ? { first: Math.round(first.volume), last: Math.round(last.volume) } : null
    }
  }).sort((a, b) => (b.weight?.last || 0) - (a.weight?.last || 0) || a.name.localeCompare(b.name))
}

function captureProgrammeCompletionSummaries(state, cycle) {
  const source = sourceOf(state)
  cycle.prSummary = programmePRSummary(source, cycle)
  cycle.progressSummary = programmeProgressSummary(source, cycle)
}

/** Reconcile active cycles after a state write; queue status is derived, never persisted per item. */
export function reconcileProgrammeCyclesInState(state, options = {}) {
  const namespace = namespaceOf(state)
  if (!namespace || !Array.isArray(namespace.cycles)) return []
  const source = sourceOf(state)
  const projection = programmeProjection(source, options)
  const changed = []
  namespace.cycles.filter(isActiveProgrammeCycle).forEach(cycle => {
    const items = projection.items.filter(item => item.source === 'programme' && item.cycleId === cycle.id)
    const settled = items.length > 0 && items.every(item => ['completed', 'partial-advanced', 'skipped'].includes(item.status))
    if (!settled) return
    const context = scheduleWriteContext({ now: options.now ?? Date.now(), timeZone: options.timeZone || cycle.timeZone })
    cycle.status = 'completed'
    cycle.completedAt = context.recordedAt || isoNow(options.now)
    cycle.completionReason = 'automatic'
    cycle.completionCalendarDate = context.calendarDate
    cycle.completedSessions = items.filter(item => item.status === 'completed').length
    captureProgrammeCompletionSummaries(source, cycle)
    changed.push(cycle)
  })
  return changed
}

export { definitionWeeks }
