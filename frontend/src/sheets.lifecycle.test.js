import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { beginWorkout, discardWorkout, finishWorkout, programmeExitSheet, repeatFreestyleSheet, resumeWeeklySession, saveProgrammeExit, startFlow, startFreestyleFlow, undoFinish } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { setNav } from './lib/nav.js'
import { workoutVolumeFromEntries } from './lib/workout-model.js'
import { applyWorkConfigToEntry } from './lib/workout-runtime.js'
import { addProgrammeDefinitionInState, createProgrammeDefinition } from './lib/programmes-ui.js'
import { completedRoutineIdsForDate, weeklySessionStatus } from './lib/history.js'
import { recordProgrammeSetRemoval } from './lib/partial.js'
import { replaceOrInsertActiveExercise } from './lib/active-workout-editing.js'

const LIFT = EXDB.find(exercise => exercise.bp !== 'cardio').id
const ROW_LIFT = EXDB.find(exercise => exercise.bp !== 'cardio' && exercise.id !== LIFT).id
const REPLACEMENT_LIFT = EXDB.find(exercise => exercise.bp !== 'cardio' && exercise.id !== LIFT && exercise.id !== ROW_LIFT).id

const routine = {
  id: 'r1',
  name: 'Lifecycle routine',
  phases: ['warmup', 'work'],
  prog: 'greyskull',
  warmupRestSec: 0,
  workRestSec: 90,
  ex: [{
    id: LIFT,
    sets: 2,
    mode: 'reps',
    kind: 'amrap',
    reps: 5,
    weight: 40,
    warmup: [{
      phase: 'warmup',
      mode: 'reps',
      reps: 8,
      weightPrescription: { kind: 'fixed', weight: 20 },
      restSec: 0
    }]
  }]
}

function freshState() {
  const state = JSON.parse(JSON.stringify(DEF))
  state.sound = false
  state.routines = [JSON.parse(JSON.stringify(routine))]
  state.week = { 1: routine.id }
  return state
}

function installBrowserBoundary() {
  const listeners = new Map()
  const storage = new Map()
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name)
    }
  })
  vi.stubGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear()
  })
  useStore.setState({ S: freshState(), user: null, ready: true })
  useUI.getState().stopTimers()
  useUI.setState({ sheets: [], timer: null, prep: null, work: null })
}

function startFromWeightSheet(weight = 70) {
  startFlow(routine.id)
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toMatchObject({ locked: false })
  const view = sheet.render(() => {})
  useUI.getState().closeSheet(sheet.id)
  view.props.onDone(weight)
  return useStore.getState().S.active
}

function startActiveWorkout() {
  beginWorkout(routine.id, 70)
  return useStore.getState().S.active
}

function markSets(active, predicate = () => true) {
  const entries = active.entries.map(entry => ({
    ...entry,
    sets: entry.sets.map((set, index) => ({
      ...set,
      done: predicate(set, index),
      ...(set.mode === 'reps' && predicate(set, index) ? { r: set.kind === 'amrap' ? 8 : set.r } : {})
    }))
  }))
  useStore.setState(({ S }) => ({ S: { ...S, active: { ...S.active, entries } } }))
}

function setProgrammeWorkShape(total, completed) {
  useStore.setState(({ S }) => {
    const active = S.active
    const source = active.entries[0]
    const template = source.sets.find(set => set.phase === 'work') || source.sets[0]
    const warmups = source.sets.filter(set => set.phase !== 'work')
    const work = Array.from({ length: total }, (_, index) => ({
      ...template,
      phase: 'work',
      mode: 'reps',
      done: index < completed
    }))
    return {
      S: {
        ...S,
        active: {
          ...active,
          entries: [{ ...source, sets: [...warmups, ...work] }, ...active.entries.slice(1)]
        }
      }
    }
  })
}

function markProgramme(active) {
  useStore.setState(({ S }) => ({
    S: {
      ...S,
      active: {
        ...S.active,
        sessionType: 'programme',
        programmeId: 'programme-1',
        cycleId: 'cycle-1',
        instanceId: 'instance-1'
      }
    }
  }))
  return useStore.getState().S.active
}

describe('workout lifecycle browser-flow model', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installBrowserBoundary()
    setNav(() => {})
  })

  afterEach(() => {
    useUI.getState().closeAll()
    useStore.setState({ S: freshState(), user: null, ready: true })
    setNav(() => {})
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('cancels the required classic start flow without creating an active workout or weigh-in', () => {
    const before = JSON.stringify(useStore.getState().S)
    startFlow(routine.id)
    const sheet = useUI.getState().sheets.at(-1)

    expect(sheet).toMatchObject({ locked: false })
    expect(useStore.getState().S.active).toBeNull()

    useUI.getState().closeSheet(sheet.id)

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(0)
    expect(useStore.getState().S.bodyweight).toEqual([])
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
  })

  it('opens dismissible required check-ins for programme and freestyle starts', () => {
    const programmeItem = {
      routineId: routine.id,
      routineSnapshot: JSON.parse(JSON.stringify(routine)),
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'programme-instance-1'
    }

    startFlow(routine.id, programmeItem)
    expect(useUI.getState().sheets.at(-1)).toMatchObject({ locked: false })
    useUI.getState().closeAll()

    startFreestyleFlow()
    expect(useUI.getState().sheets.at(-1)).toMatchObject({ locked: false })
    expect(useStore.getState().S.active).toBeNull()
  })

  it('starts a phase-aware active workout only after the weight flow completes', () => {
    const routes = []
    setNav(path => routes.push(path))

    const active = startFromWeightSheet()

    expect(active).toMatchObject({ routineId: routine.id, bw: 70, unit: 'kg', sourceUnit: 'kg' })
    expect(active.entries).toHaveLength(1)
    expect(active.entries[0].target).toMatchObject({ mode: 'reps', kind: 'amrap', amrapMinReps: 5, unit: 'kg' })
    expect(active.entries[0].sets.map(set => set.phase)).toEqual(['warmup', 'work', 'work'])
    expect(active.entries[0].sets[0]).toMatchObject({ phase: 'warmup', mode: 'reps', w: 20, r: 8, restSec: 0, done: false })
    expect(active.entries[0].sets.slice(1).every(set => set.mode === 'reps' && set.w === 40 && set.r === 5 && !set.done)).toBe(true)
    expect(routes).toEqual(['/workout'])
    expect(useStore.getState().S.workouts).toHaveLength(0)
  })

  it.each([
    ['saved', 71.2],
    ['skipped', null]
  ])('keeps a future classic date through a %s Quick check-in', (_choice, weight) => {
    const selectedDate = '2026-07-30'
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'))
    useStore.setState(({ S }) => ({ S: {
      ...S,
      dayPlan: { ...S.dayPlan, [selectedDate]: [routine.id] }
    } }))

    expect(startFlow(routine.id, null, { calendarDate: selectedDate })).toBe(true)
    const sheet = useUI.getState().sheets.at(-1)
    const view = sheet.render(() => {})
    useUI.getState().closeSheet(sheet.id)
    view.props.onDone(weight)

    expect(useStore.getState().S.active).toMatchObject({
      d: selectedDate,
      routineId: routine.id,
      bw: weight
    })
    const persisted = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(persisted.active).toMatchObject({ d: selectedDate, routineId: routine.id, bw: weight })
    useStore.setState({ S: persisted })
    expect(useStore.getState().S.active).toMatchObject({ d: selectedDate, routineId: routine.id })
  })

  it('keeps the selected classic date when Quick check-in returns to the chooser', () => {
    const selectedDate = '2026-07-30'
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'))

    expect(startFlow(routine.id, null, { calendarDate: selectedDate })).toBe(true)
    const checkIn = useUI.getState().sheets.at(-1)
    const checkInView = checkIn.render(() => {})
    useUI.getState().closeSheet(checkIn.id)
    checkInView.props.onChooseDifferent()

    const chooser = useUI.getState().sheets.at(-1)
    expect(chooser.render(() => {}).props.iso).toBe(selectedDate)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('blocks a settled classic identity unless the caller explicitly chooses Repeat', () => {
    const iso = '2026-07-27'
    useStore.setState(({ S }) => ({ S: {
      ...S,
      workouts: [{ d: iso, routineId: routine.id, plannedComplete: false, entries: [] }]
    } }))

    expect(startFlow(routine.id, null, { calendarDate: iso })).toBe(false)
    expect(useUI.getState().sheets).toEqual([])
    expect(startFlow(routine.id, null, { calendarDate: iso, allowSettled: true })).toBe(true)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('writes a future classic completion back to the selected date identity', () => {
    const selectedDate = '2026-07-30'
    beginWorkout(routine.id, 70, null, null, { calendarDate: selectedDate })
    markSets(useStore.getState().S.active)

    finishWorkout()

    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts.at(-1)).toMatchObject({
      d: selectedDate,
      routineId: routine.id,
      plannedComplete: true
    })
  })

  it('preserves a completed classic slot through an active and early-finished Repeat in the real store', () => {
    const iso = '2026-07-27'
    const session = { source: 'classic', routineId: routine.id, calendarDate: iso }
    beginWorkout(routine.id, 70, null, null, { calendarDate: iso })
    markSets(useStore.getState().S.active)
    finishWorkout()
    useUI.getState().closeAll()

    expect(weeklySessionStatus(useStore.getState().S, session)).toBe('done')
    expect(startFlow(routine.id, null, { calendarDate: iso })).toBe(false)
    expect(startFlow(routine.id, null, { calendarDate: iso, allowSettled: true })).toBe(true)
    const checkIn = useUI.getState().sheets.at(-1)
    const checkInView = checkIn.render(() => {})
    useUI.getState().closeSheet(checkIn.id)
    checkInView.props.onDone(70)

    expect(weeklySessionStatus(useStore.getState().S, session)).toBe('resume')
    markSets(useStore.getState().S.active, (_set, index) => index === 0)
    finishWorkout()
    const finishEarly = useUI.getState().sheets.at(-1)
    const finishEarlyView = finishEarly.render(() => {})
    useUI.getState().closeSheet(finishEarly.id)
    finishEarlyView.props.onConfirm()

    const state = useStore.getState().S
    expect(state.workouts.map(workout => workout.plannedComplete)).toEqual([true, false])
    expect(weeklySessionStatus(state, session)).toBe('done')
    expect(completedRoutineIdsForDate(state, iso)).toEqual(new Set([routine.id]))
    expect(startFlow(routine.id, null, { calendarDate: iso })).toBe(false)
  })

  it('preserves a converted-classic completion through an active and early-finished Repeat', () => {
    const iso = '2026-07-27'
    const converted = {
      id: 'converted-completion', d: iso, routineId: routine.id, plannedComplete: true,
      programmeId: 'converted-programme', classicConversion: true, entries: [], vol: 0
    }
    const session = { source: 'classic', routineId: routine.id, calendarDate: iso }
    useStore.setState(({ S }) => ({ S: { ...S, workouts: [converted] } }))
    const historicalBefore = JSON.parse(JSON.stringify(useStore.getState().S.workouts[0]))

    expect(weeklySessionStatus(useStore.getState().S, session)).toBe('done')
    expect(startFlow(routine.id, null, { calendarDate: iso })).toBe(false)
    expect(useUI.getState().sheets).toEqual([])

    expect(startFlow(routine.id, null, { calendarDate: iso, allowSettled: true })).toBe(true)
    const checkIn = useUI.getState().sheets.at(-1)
    const checkInView = checkIn.render(() => {})
    useUI.getState().closeSheet(checkIn.id)
    checkInView.props.onDone(70)
    expect(weeklySessionStatus(useStore.getState().S, session)).toBe('resume')

    markSets(useStore.getState().S.active, (_set, index) => index === 0)
    finishWorkout()
    const finishEarly = useUI.getState().sheets.at(-1)
    const finishEarlyView = finishEarly.render(() => {})
    useUI.getState().closeSheet(finishEarly.id)
    finishEarlyView.props.onConfirm()

    const state = useStore.getState().S
    expect(state.workouts[0]).toEqual(historicalBefore)
    expect(state.workouts.at(-1).plannedComplete).toBe(false)
    expect(weeklySessionStatus(state, session)).toBe('done')
    expect(completedRoutineIdsForDate(state, iso)).toEqual(new Set([routine.id]))
    expect(startFlow(routine.id, null, { calendarDate: iso })).toBe(false)
  })

  it('persists a programme definition through the real store update boundary', () => {
    const definition = createProgrammeDefinition({
      id: 'persisted-programme', name: 'Persisted programme', progression: 'linear',
      weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{
        id: 'r1:w1:d1:s1', sessionTemplateId: 'r1:w1:d1:s1', routineId: routine.id,
        routineSnapshot: JSON.parse(JSON.stringify(routine))
      }] }] }]
    })

    useStore.getState().update(state => { addProgrammeDefinitionInState(state, definition) }, false)

    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.programmes).toMatchObject({ version: 1 })
    expect(saved.programmes.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'persisted-programme', name: 'Persisted programme' })
    ]))
    expect(useStore.getState().S.programmes.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'persisted-programme' })
    ]))
  })

  it('applies a programme snapshot progression policy to the next workout', () => {
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'))
    const double = JSON.parse(JSON.stringify(routine))
    double.prog = 'off'
    double.ex = [{ id: LIFT, mode: 'reps', sets: 3, reps: 12, repsMin: 8, weight: 80, prog: 'double' }]
    const snapshot = {
      id: 'programme-1', name: 'Double block', prog: 'off', ex: JSON.parse(JSON.stringify(double.ex))
    }
    useStore.setState(({ S }) => ({ S: {
      ...S,
      routines: [double],
      workouts: [{ d: '2026-01-11', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 3, reps: 12, repsMin: 8, weight: 80, prog: 'double', unit: 'kg' },
        sets: [{ unit: 'kg', w: 80, r: 12, done: true }, { unit: 'kg', w: 80, r: 12, done: true }, { unit: 'kg', w: 80, r: 12, done: true }]
      }] }],
      programmes: { version: 1, cycles: [{
        id: 'cycle-1', programmeId: 'programme-1', status: 'active', timeZone: 'UTC', week1StartDate: '2026-01-05',
        snapshot: { weeks: [
          { weekIndex: 1, mode: 'normal', days: [] },
          { weekIndex: 2, mode: 'normal', days: [{ weekday: 1, sessions: [{
            id: 'session-2', sessionTemplateId: 'session-2', routineId: double.id, routineSnapshot: snapshot
          }] }] }
        ] }
      }] }
    } }))

    const active = startFromWeightSheet(70)
    expect(active.entries[0].plan).toMatchObject({ policy: 'double', kind: 'up', weight: 82.5, reps: 8 })
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 82.5 && set.r === 8)).toBe(true)
  })

  it('holds and lightens the prior target during a runtime programme deload', () => {
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'))
    const deload = JSON.parse(JSON.stringify(routine))
    deload.prog = 'off'
    deload.ex = [{ id: LIFT, mode: 'reps', sets: 4, reps: 5, weight: 80, prog: 'linear' }]
    const snapshot = { id: 'programme-deload', name: 'Deload block', prog: 'off', ex: [{
      ...deload.ex[0], programmeInitial: false, programmeWeekMode: 'deload', programmeDeloadPercent: 10
    }] }
    useStore.setState(({ S }) => ({ S: {
      ...S,
      routines: [deload],
      workouts: [{ d: '2026-01-11', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 4, reps: 5, weight: 80, unit: 'kg' },
        sets: [1, 2, 3, 4].map(() => ({ unit: 'kg', w: 80, r: 5, done: true }))
      }] }],
      programmes: { version: 1, cycles: [{
        id: 'cycle-deload', programmeId: 'programme-deload', status: 'active', timeZone: 'UTC', week1StartDate: '2026-01-05',
        snapshot: { weeks: [
          { weekIndex: 1, mode: 'normal', days: [] },
          { weekIndex: 2, mode: 'deload', days: [{ weekday: 1, sessions: [{
            id: 'session-deload', sessionTemplateId: 'session-deload', routineId: deload.id, routineSnapshot: snapshot
          }] }] }
        ] }
      }] }
    } }))

    const active = startFromWeightSheet(70)
    expect(active.entries[0].plan).toMatchObject({ policy: 'linear', kind: 'hold', weight: 72.5, reps: 5 })
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 72.5 && set.r === 5)).toBe(true)
  })

  it('keeps configured bodyweight and timed deload targets unchanged at workout start', () => {
    const prior = {
      d: '2026-01-11', unit: 'kg', complete: true,
      entries: [{ id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg', target: { mode: 'reps', sets: 1, reps: 10, weight: 0, unit: 'kg' }, sets: [{ phase: 'work', mode: 'reps', w: 0, r: 10, done: true }] }]
    }
    useStore.setState(({ S }) => ({ S: { ...S, workouts: [prior] } }))
    const bodyItem = {
      programmeId: 'programme-bodyweight', cycleId: 'cycle-bodyweight', instanceId: 'pi:cycle-bodyweight:w7',
      sessionTemplateId: 'body:w7:d1:s1', weekIndex: 7, weekday: 1,
      routineSnapshot: { ...routine, ex: [{ id: LIFT, mode: 'reps', sets: 1, reps: 10, weight: 0, bodyweight: true, programmeWeekMode: 'deload', programmeDeloadPercent: 10 }] }
    }
    beginWorkout(null, null, bodyItem)
    expect(useStore.getState().S.active.entries[0].target).toMatchObject({ reps: 9, weight: 0 })
    expect(useStore.getState().S.active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.r === 9)).toBe(true)
    discardWorkout()

    const timedPrior = {
      d: '2026-01-11', unit: 'kg', complete: true,
      entries: [{ id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg', target: { mode: 'time', sets: 1, sec: 60, unit: 'kg' }, sets: [{ phase: 'work', mode: 'time', sec: 60, w: 0, done: true }] }]
    }
    useStore.setState(({ S }) => ({ S: { ...S, workouts: [timedPrior] } }))
    const timedItem = {
      programmeId: 'programme-timed', cycleId: 'cycle-timed', instanceId: 'pi:cycle-timed:w7',
      sessionTemplateId: 'timed:w7:d1:s1', weekIndex: 7, weekday: 1,
      routineSnapshot: { ...routine, ex: [{ id: LIFT, mode: 'time', sets: 1, sec: 54, weight: 0, programmeWeekMode: 'deload', programmeDeloadPercent: 10 }] }
    }
    beginWorkout(null, null, timedItem)
    expect(useStore.getState().S.active.entries[0].target).toMatchObject({ sec: 54 })
    expect(useStore.getState().S.active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.sec === 54)).toBe(true)
  })

  it('freezes programme rest and preparation context onto the active workout', () => {
    const snapshot = {
      ...routine,
      workRestSec: 120,
      prepSec: 11,
      ex: [{ ...routine.ex[0], id: LIFT, mode: 'time', sec: 45, prepSec: 7 }]
    }
    useStore.setState(({ S }) => ({ S: {
      ...S,
      routines: [{ ...routine, workRestSec: 45, prepSec: 2, ex: [{ ...routine.ex[0], id: LIFT, mode: 'time', sec: 45, prepSec: 3 }] }]
    } }))
    beginWorkout(null, null, {
      programmeId: 'programme-freeze', cycleId: 'cycle-freeze', instanceId: 'pi:freeze',
      sessionTemplateId: 'session-freeze', routineId: routine.id, routineSnapshot: snapshot
    })
    const active = useStore.getState().S.active
    expect(active.routineContext).toMatchObject({ workRestSec: 120, prepSec: 11 })
    expect(active.entries[0].target).toMatchObject({ prepSec: 7 })
    discardWorkout()
  })

  it('repeats the selected historical session shape instead of borrowing newer history', () => {
    const selected = {
      d: '2026-01-01', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 2, reps: 5, weight: 60, prog: 'off', unit: 'kg' },
        sets: [
          { phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true },
          { phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 4, done: true }
        ]
      }]
    }
    const newer = {
      d: '2026-01-02', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 2, reps: 8, weight: 80, prog: 'off', unit: 'kg' },
        sets: [
          { phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 8, done: true },
          { phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 8, done: true }
        ]
      }]
    }
    useStore.setState(({ S }) => ({ S: { ...S, workouts: [selected, newer] } }))
    beginWorkout(null, null, null, {
      name: 'Selected freestyle',
      unit: 'kg',
      selectedWorkout: selected,
      ex: [{ ...selected.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selected.entries[0] }]
    })
    const active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ reps: 5, weight: 60 })
    expect(active.entries[0].sets.filter(set => set.phase === 'work')).toEqual([
      expect.objectContaining({ w: 60, r: 5 }),
      expect.objectContaining({ w: 60, r: 4 })
    ])
    discardWorkout()
  })

  it('repeats the selected source with progression enabled, never the newer global source', () => {
    const selected = {
      d: '2026-01-01', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 2, reps: 5, weight: 60, prog: 'linear', unit: 'kg' },
        sets: [1, 2].map(() => ({ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }))
      }]
    }
    const newer = {
      d: '2026-01-02', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 2, reps: 5, weight: 125, prog: 'linear', unit: 'kg' },
        sets: [1, 2].map(() => ({ phase: 'work', mode: 'reps', unit: 'kg', w: 125, r: 5, done: true }))
      }]
    }
    useStore.setState(({ S }) => ({ S: {
      ...S,
      workouts: [selected, newer],
      exWeights: { [LIFT]: { w: 125, unit: 'kg', d: '2026-01-02' } }
    } }))
    beginWorkout(null, null, null, {
      name: 'Selected freestyle', unit: 'kg', selectedWorkout: selected,
      ex: [{ ...selected.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selected.entries[0] }]
    })

    const active = useStore.getState().S.active
    expect(active.entries[0].plan).toMatchObject({ policy: 'linear', kind: 'up', weight: 62.5 })
    expect(active.entries[0].target.weight).toBe(62.5)
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 62.5)).toBe(true)
    expect(active.entries[0].target.weight).not.toBe(127.5)
    discardWorkout()
  })

  it('uses global history for planned and Programme starts, while freestyle policy stays explicit', () => {
    const global = {
      d: '2026-01-02', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 1, reps: 5, weight: 80, prog: 'off', unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 5, done: true }]
      }]
    }
    const planned = { ...JSON.parse(JSON.stringify(routine)), id: 'planned-global', ex: [{ ...routine.ex[0], weight: 0, prog: 'off' }] }
    const state = { ...freshState(), routines: [planned], workouts: [global], exWeights: { [LIFT]: { w: 90, unit: 'kg', d: '2026-01-02' } } }
    useStore.setState({ S: state })

    beginWorkout(planned.id, 70)
    let active = useStore.getState().S.active
    expect(active.historyPolicy).toBeUndefined()
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 90)).toBe(true)
    discardWorkout()

    beginWorkout(null, null, {
      programmeId: 'programme-global', cycleId: 'cycle-global', instanceId: 'instance-global',
      sessionTemplateId: 'session-global', routineSnapshot: planned
    })
    active = useStore.getState().S.active
    expect(active).toMatchObject({ sessionType: 'programme', programmeId: 'programme-global', cycleId: 'cycle-global' })
    expect(active.historyPolicy).toBeUndefined()
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 90)).toBe(true)
    discardWorkout()
  })

  it('writes completed workouts without historyPolicy but keeps one undo snapshot until the next begin', () => {
    beginWorkout(null, null)
    const started = useStore.getState().S.active
    expect(started).toMatchObject({ historyPolicy: { kind: 'fresh-freestyle' } })

    finishWorkout()
    const confirmation = useUI.getState().sheets.at(-1)
    confirmation.render(() => {}).props.onConfirm()

    const state = useStore.getState().S
    expect(state.workouts.at(-1)).not.toHaveProperty('historyPolicy')
    expect(state.lastFinishedSession).toMatchObject({ historyPolicy: { kind: 'fresh-freestyle' } })

    beginWorkout(null, null)
    expect(useStore.getState().S.lastFinishedSession).toBeNull()
    discardWorkout()
  })

  it('rejects a repeat when a legacy entry no longer resolves to an exercise', () => {
    const started = []
    repeatFreestyleSheet(freshState(), {
      d: '2026-01-01', unit: 'kg',
      entries: [{ id: 'deleted-exercise', sets: [{ w: 40, r: 5, done: true }] }]
    }, (...args) => started.push(args))
    expect(started).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('blocks an explicitly foreign-unit repeat before opening the start sheet', () => {
    const started = []
    repeatFreestyleSheet({ ...freshState(), unit: 'kg' }, {
      d: '2026-01-01', unit: 'lb',
      entries: [{
        id: LIFT, unit: 'lb', target: { mode: 'reps', unit: 'lb' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'lb', w: 100, r: 5, done: true }]
      }]
    }, (...args) => started.push(args))
    expect(started).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('fails closed for weighted legacy repeats with no unit provenance', () => {
    const started = []
    repeatFreestyleSheet(freshState(), {
      d: '2026-01-01',
      entries: [{
        id: LIFT,
        target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', w: 100, r: 5, done: true }]
      }]
    }, (...args) => started.push(args))
    expect(started).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('deloads freestyle weighted work from performed load, never increasing it', () => {
    const selected = {
      d: '2026-01-01', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 1, reps: 5, weight: 60, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 5, done: true }]
      }]
    }
    beginWorkout(null, null, null, {
      name: 'Deload freestyle', unit: 'kg', deload: true, selectedWorkout: selected,
      ex: [{ ...selected.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selected.entries[0] }]
    })
    const active = useStore.getState().S.active
    expect(active.entries[0].target.weight).toBe(72.5)
    expect(active.entries[0].target.weight).toBeLessThan(80)
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 72.5)).toBe(true)
    discardWorkout()
  })

  it('does not increase a tiny timed freestyle baseline when a reduction cannot be loaded', () => {
    const selected = {
      d: '2026-01-01', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'time', sets: 1, sec: 5, weight: 0, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'time', unit: 'kg', sec: 5, w: 0, done: true }]
      }]
    }
    beginWorkout(null, null, null, {
      name: 'Timed deload', unit: 'kg', deload: true, selectedWorkout: selected,
      ex: [{ ...selected.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selected.entries[0] }]
    })
    const active = useStore.getState().S.active
    expect(active.entries[0].target.sec).toBeLessThanOrEqual(5)
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.sec <= 5)).toBe(true)
    discardWorkout()
  })

  it('deloads bodyweight freestyle reps from the performed goal, not repsMax', () => {
    const selected = {
      d: '2026-01-01', unit: 'kg', entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 3, reps: 10, repsMax: 20, weight: 0, bodyweight: true, unit: 'kg' },
        sets: [1, 2, 3].map(() => ({ phase: 'work', mode: 'reps', unit: 'kg', w: 0, r: 10, done: true }))
      }]
    }
    beginWorkout(null, null, null, {
      name: 'Bodyweight deload', unit: 'kg', deload: true, selectedWorkout: selected,
      ex: [{ ...selected.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selected.entries[0] }]
    })
    const active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ reps: 9, weight: 0 })
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.r === 9)).toBe(true)
    discardWorkout()
  })

  it('preserves the pre-deload target when a deload starts without compatible history', () => {
    const deloadItem = {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:w7',
      sessionTemplateId: 'r1:w7:d1:s1', weekIndex: 7, weekday: 1, routineSnapshot: {
        ...routine, ex: [{ ...routine.ex[0], id: LIFT, sets: 2, reps: 5, weight: 72.5, prog: 'linear', programmeWeekMode: 'deload', programmeDeloadPercent: 10, programmePreDeloadWeight: 80 }]
      }
    }
    beginWorkout(null, null, deloadItem)
    const deloadActive = useStore.getState().S.active
    expect(deloadActive.entries[0].target).toMatchObject({ weight: 72.5, programmeHoldWeight: 80 })
    markSets(deloadActive, set => set.phase === 'work')
    expect(saveProgrammeExit('finish')).toBe(true)
    expect(useStore.getState().S.workouts.at(-1).entries[0].target).toMatchObject({ programmeHoldWeight: 80 })

    const nextItem = {
      ...deloadItem, instanceId: 'pi:cycle-1:w8', sessionTemplateId: 'r1:w8:d1:s1', weekIndex: 8,
      routineSnapshot: { ...deloadItem.routineSnapshot, ex: [{ ...deloadItem.routineSnapshot.ex[0], weight: 80, programmeWeekMode: 'normal' }] }
    }
    beginWorkout(null, null, nextItem)
    const resumed = useStore.getState().S.active
    expect(resumed.entries[0].plan).toMatchObject({ kind: 'hold', weight: 80 })
    expect(resumed.entries[0].target).toMatchObject({ weight: 80 })
    expect(resumed.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 80)).toBe(true)
  })

  it('records the pre-deload target when the cycle itself starts on a deload week', () => {
    const item = {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:w1',
      sessionTemplateId: 'r1:w1:d1:s1', weekIndex: 1, weekday: 1, routineSnapshot: {
        ...routine, ex: [{ ...routine.ex[0], id: LIFT, sets: 2, reps: 5, weight: 72.5, prog: 'linear', programmeInitial: true, programmeWeekMode: 'deload', programmePreDeloadWeight: 80 }]
      }
    }
    beginWorkout(null, null, item)
    const active = useStore.getState().S.active
    expect(active.entries[0].plan).toMatchObject({ kind: 'hold', weight: 72.5 })
    expect(active.entries[0].target).toMatchObject({ weight: 72.5, programmeHoldWeight: 80 })
  })

  it('resumes the pre-deload target after the completed deload crosses the runtime history boundary', () => {
    const target = {
      id: LIFT, mode: 'reps', sets: 2, reps: 5, weight: 80, prog: 'linear', unit: 'kg',
      occurrenceId: `${LIFT}#1`, programmeWeekMode: 'normal'
    }
    useStore.setState(({ S }) => ({ S: {
      ...S,
      workouts: [{
        cycleId: 'cycle-1', instanceId: 'pi:cycle-1:w6', unit: 'kg', complete: true, d: '2026-02-16',
        programmeStep: { cycleId: 'cycle-1', weekIndex: 6 },
        entries: [{ id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg', target, sets: [1, 2].map(() => ({ unit: 'kg', w: 80, r: 5, done: true })) }]
      }]
    } }))

    const deloadItem = {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:w7',
      sessionTemplateId: 'r1:w7:d1:s1', weekIndex: 7, weekday: 1, routineSnapshot: {
        ...routine, ex: [{ ...routine.ex[0], id: LIFT, sets: 2, reps: 5, weight: 72.5, prog: 'linear', programmeWeekMode: 'deload' }]
      }
    }
    beginWorkout(null, null, deloadItem)
    const deloadActive = useStore.getState().S.active
    expect(deloadActive.entries[0].target).toMatchObject({ weight: 72.5, programmeHoldDisposition: 'deload', programmeHoldWeight: 80 })
    markSets(deloadActive, set => set.phase === 'work')
    expect(saveProgrammeExit('finish')).toBe(true)
    expect(useStore.getState().S.workouts.at(-1).entries[0].target).toMatchObject({ programmeHoldDisposition: 'deload', programmeHoldWeight: 80 })

    const nextItem = {
      ...deloadItem, instanceId: 'pi:cycle-1:w8', sessionTemplateId: 'r1:w8:d1:s1', weekIndex: 8,
      routineSnapshot: { ...deloadItem.routineSnapshot, ex: [{ ...deloadItem.routineSnapshot.ex[0], weight: 80, programmeWeekMode: 'normal' }] }
    }
    beginWorkout(null, null, nextItem)
    const resumed = useStore.getState().S.active
    expect(resumed.entries[0].plan).toMatchObject({ kind: 'hold', weight: 80 })
    expect(resumed.entries[0].target).toMatchObject({ weight: 80 })
    expect(resumed.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 80)).toBe(true)
  })

  it('does not treat a future Programme head as due when travelling across its persisted timezone', () => {
    vi.setSystemTime(new Date('2026-01-05T00:30:00Z'))
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        programmes: {
          version: 1,
          timeZone: 'America/Los_Angeles',
          cycles: [{
            id: 'cycle-travel', programmeId: 'programme-travel', status: 'active', createdAt: '2026-01-01T00:00:00Z',
            week1StartDate: '2026-01-05',
            snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
              id: 'programme-session', routineId: routine.id, routineSnapshot: routine
            }] }] }] }
          }]
        }
      }
    }))

    const active = startFromWeightSheet()
    expect(active.sessionType).toBeUndefined()
    expect(active.cycleId).toBeUndefined()
  })

  it('does not bypass a recovery-blocked classic queue head through the generic start flow', () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        classicSessions: [{
          id: 'classic-session', routineId: routine.id, projectedDate: '2026-01-05',
          primaryMuscles: ['chest'], routineSnapshot: routine
        }],
        workouts: [{
          id: 'recent', routineId: routine.id, d: '2026-01-04', end: Date.parse('2026-01-04T12:00:00Z'),
          muscleGroups: ['chest'], entries: [{ id: LIFT, sets: [{ phase: 'work', done: true }] }]
        }]
      }
    }))

    expect(startFlow(routine.id)).toBe(false)
    expect(useUI.getState().sheets).toEqual([])
  })

  it('starts an eligible Programme queue head instead of bypassing it with a classic routine', () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        programmes: {
          version: 1,
          cycles: [{
            id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-01-01T00:00:00Z',
            timeZone: 'UTC', week1StartDate: '2026-01-05',
            snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
              id: 'programme-session', routineId: routine.id, routineSnapshot: routine
            }] }] }] }
          }]
        }
      }
    }))

    const active = startFromWeightSheet(routine.id)
    expect(active).toMatchObject({
      sessionType: 'programme',
      programmeSession: true,
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      instanceId: 'pi:cycle-1:programme-session',
      routineId: routine.id
    })
    expect(active.partialExitBaseline).toMatchObject({ version: 2, prescribedWorkSets: 2 })
  })

  it('cancels an early-finish confirmation without discarding the active session', () => {
    const active = startFromWeightSheet()
    markSets(active, (_set, index) => index === 0)

    finishWorkout()

    const confirmation = useUI.getState().sheets.at(-1)
    const dialog = confirmation.render(() => {})
    expect(dialog.props.onConfirm).toEqual(expect.any(Function))
    useUI.getState().closeSheet(confirmation.id)

    expect(useStore.getState().S.active).not.toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(0)
  })

  it('accepts early completion, persists only completed rows, and includes warm-up volume', () => {
    const active = startFromWeightSheet()
    markSets(active, (_set, index) => index === 0)
    useUI.getState().startRest(30)

    finishWorkout()

    const confirmation = useUI.getState().sheets.at(-1)
    const dialog = confirmation.render(() => {})
    dialog.props.onConfirm()

    const state = useStore.getState().S
    expect(state.active).toBeNull()
    expect(state.workouts).toHaveLength(1)
    expect(state.workouts[0].plannedComplete).toBe(false)
    expect(state.workouts[0]).not.toHaveProperty('complete')
    expect(state.workouts[0].entries[0].sets).toHaveLength(3)
    expect(state.workouts[0].entries[0].sets[0]).toMatchObject({ phase: 'warmup', done: true, w: 20, r: 8, unit: 'kg' })
    expect(state.workouts[0].entries[0].sets.slice(1).every(set => set.done === false)).toBe(true)
    expect(state.workouts[0].vol).toBe(160)
    expect(useUI.getState().timer).toBeNull()
  })

  it('renders three Programme exit choices after work starts', () => {
    const active = markProgramme(startFromWeightSheet())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)

    const handle = programmeExitSheet()
    const sheet = useUI.getState().sheets.at(-1)
    const html = renderToStaticMarkup(sheet.render(handle.close))
    expect(html).toContain('Continue next time')
    expect(html).toContain('Finish and skip')
    expect(html).toContain('Discard')
  })

  it('omits Continue next time when a Programme session has zero work sets', () => {
    markProgramme(startFromWeightSheet())

    const handle = programmeExitSheet()
    const sheet = useUI.getState().sheets.at(-1)
    const html = renderToStaticMarkup(sheet.render(handle.close))
    expect(html).not.toContain('Continue next time')
    expect(html).toContain('Finish and skip')
    expect(html).toContain('Discard')
  })

  it('keeps a fully completed programme session on the normal complete path with its instance provenance', () => {
    const active = markProgramme(startFromWeightSheet())
    markSets(active, set => set.phase === 'work')

    finishWorkout()

    const completed = useStore.getState().S.workouts[0]
    expect(completed).not.toHaveProperty('partial')
    expect(completed.complete).toBe(true)
    expect(completed).toMatchObject({
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      instanceId: 'instance-1'
    })
  })

  it('finishes a Programme instance after removing one planned work row from each duplicate cooldown occurrence', () => {
    const cooldownRoutine = {
      ...routine,
      id: 'cooldown-routine',
      ex: [
        { ...routine.ex[0], warmup: [], weight: 20 },
        { ...routine.ex[0], warmup: [], weight: 10 }
      ]
    }
    beginWorkout(cooldownRoutine.id, 70, {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'cooldown-instance',
      sessionTemplateId: 'cooldown-session', routineId: cooldownRoutine.id, routineSnapshot: cooldownRoutine
    })
    const active = useStore.getState().S.active

    active.entries.forEach((entry, entryIdx) => {
      const lastSet = entry.sets.length - 1
      expect(recordProgrammeSetRemoval(active, entryIdx, lastSet)).toBe(true)
      entry.sets.splice(lastSet, 1)
    })
    markSets(active, set => set.phase === 'work')

    finishWorkout()

    const completed = useStore.getState().S.workouts.at(-1)
    expect(completed).toMatchObject({ instanceId: 'cooldown-instance', complete: true })
    expect(completed).not.toHaveProperty('partial')
    expect(completed.entries.map(entry => entry.sets.filter(set => set.phase === 'work')))
      .toEqual([[expect.objectContaining({ done: true })], [expect.objectContaining({ done: true })]])
  })

  it('preserves Work-settings row tombstones through reload and Resume before final completion', () => {
    const cooldownRoutine = {
      ...routine,
      id: 'resumable-cooldown-routine',
      ex: [
        { ...routine.ex[0], warmup: [], weight: 20 },
        { ...routine.ex[0], warmup: [], weight: 10 }
      ]
    }
    const session = {
      source: 'programme', routineId: cooldownRoutine.id,
      instanceId: 'resumable-cooldown-instance'
    }
    beginWorkout(cooldownRoutine.id, 70, {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'resumable-cooldown-instance',
      sessionTemplateId: 'resumable-cooldown-session', routineId: cooldownRoutine.id, routineSnapshot: cooldownRoutine
    })
    const active = useStore.getState().S.active
    active.entries.forEach((entry, entryIdx) => {
      const updated = applyWorkConfigToEntry(entry, { mode: 'reps', sets: 3, reps: 6, weight: entry.target.weight })
      entry.target = updated.target
      entry.sets = updated.sets
      expect(entry.sets.filter(set => set.phase === 'work').map(set => set.programmeRowId)).toEqual([
        `${entry.occurrenceId}:work:1`, `${entry.occurrenceId}:work:2`, undefined
      ])
      const removedRowIndex = entry.sets.findIndex(set => set.programmeRowId === `${entry.occurrenceId}:work:2`)
      expect(recordProgrammeSetRemoval(active, entryIdx, removedRowIndex)).toBe(true)
      entry.sets.splice(removedRowIndex, 1)
    })
    useStore.setState(({ S }) => ({ S: {
      ...S,
      active: {
        ...S.active,
        entries: S.active.entries.map((entry, entryIdx) => ({
          ...entry,
          sets: entry.sets.map(set => ({ ...set, done: entryIdx === 0 && set.phase === 'work' }))
        }))
      }
    } }))

    expect(saveProgrammeExit('continue')).toBe(true)
    const partial = useStore.getState().S.workouts.at(-1)
    expect(partial).toMatchObject({ partial: true, owed: true, completion: { prescribedWorkSets: 2, completedWorkSets: 1 } })
    expect(partial.partialExitBaseline.removedWorkRowIds).toEqual([
      `${active.entries[0].occurrenceId}:work:2`, `${active.entries[1].occurrenceId}:work:2`
    ])
    expect(partial.entries.every(entry => entry.sets.filter(set => set.phase === 'work').length === 2)).toBe(true)

    useStore.setState({ S: JSON.parse(JSON.stringify(useStore.getState().S)) })
    expect(resumeWeeklySession({ ...session, calendarDate: partial.d })).toBe(true)
    expect(useStore.getState().S.active.entries.every(entry => entry.sets.filter(set => set.phase === 'work').length === 2)).toBe(true)
    markSets(useStore.getState().S.active, set => set.phase === 'work')

    finishWorkout()

    const completed = useStore.getState().S.workouts.at(-1)
    expect(completed).toMatchObject({ instanceId: 'resumable-cooldown-instance', complete: true })
    expect(completed).not.toHaveProperty('partial')
  })

  it('saves an explicit programme continue choice as one owed partial instance', () => {
    const active = markProgramme(startFromWeightSheet())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)

    saveProgrammeExit('continue')

    const state = useStore.getState().S
    expect(state.active).toBeNull()
    expect(state.workouts).toHaveLength(1)
    expect(state.workouts[0]).toMatchObject({
      partial: true,
      complete: false,
      owed: true,
      schedule: 'repeat',
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      instanceId: 'instance-1',
      partialVersion: 1,
      completion: expect.objectContaining({ completedWorkSets: 1, prescribedWorkSets: 2 })
    })
    expect(state.workouts[0].entries[0].sets.map(set => set.done)).toEqual([false, true, false])
    expect(state.workouts[0].entries[0].sets).toHaveLength(3)
    expect(state.workouts[0].vol).toBe(200)

    // A late/repeated callback must not create a second record for the same instance.
    saveProgrammeExit('continue')
    expect(useStore.getState().S.workouts).toHaveLength(1)
  })

  it('keeps duplicate exercise occurrences and counts each exactly once at final completion', () => {
    const duplicateRoutine = JSON.parse(JSON.stringify(routine))
    duplicateRoutine.ex = [
      { ...duplicateRoutine.ex[0], weight: 40 },
      { ...duplicateRoutine.ex[0], weight: 60 }
    ]
    useStore.setState(({ S }) => ({ S: { ...S, routines: [duplicateRoutine], week: { 1: duplicateRoutine.id } } }))
    const active = startFromWeightSheet()
    expect(active.entries.map(entry => entry.occurrenceId)).toEqual([`${LIFT}#1`, `${LIFT}#2`])
    markSets(active)

    finishWorkout()

    const workout = useStore.getState().S.workouts.at(-1)
    expect(workout.entries).toHaveLength(2)
    expect(workout.entries.map(entry => entry.occurrenceId)).toEqual([`${LIFT}#1`, `${LIFT}#2`])
    expect(new Set(workout.entries.map(entry => entry.occurrenceId)).size).toBe(2)
    expect(workout.vol).toBe(workoutVolumeFromEntries(workout, 'kg'))
    expect(workout.vol).toBe(1620)
  })

  it('saves an explicit programme finish-and-skip as visible partial without owing it', () => {
    const active = markProgramme(startFromWeightSheet())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)

    saveProgrammeExit('skip')

    expect(useStore.getState().S.workouts[0]).toMatchObject({
      partial: true,
      complete: false,
      owed: false,
      schedule: 'advance',
      instanceId: 'instance-1'
    })
  })

  it('keeps a legacy finished record when a Programme partial reuses its session id', () => {
    const active = markProgramme(startFromWeightSheet())
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        workouts: [...S.workouts, { id: active.id, d: '2026-01-01', name: 'legacy-finished', entries: [], vol: 10 }]
      }
    }))
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && set.w === 40 && workSeen++ === 0)

    saveProgrammeExit('skip')

    expect(useStore.getState().S.workouts).toHaveLength(2)
    expect(useStore.getState().S.workouts.find(workout => workout.name === 'legacy-finished')).not.toHaveProperty('partial')
    expect(useStore.getState().S.workouts.find(workout => workout.partial === true)).toMatchObject({ instanceId: 'instance-1' })
  })

  it('durably marks a zero-work programme skip without writing a workout record', () => {
    markProgramme(startFromWeightSheet())

    saveProgrammeExit('skip')

    expect(useStore.getState().S).toMatchObject({ active: null, workouts: [] })
    expect(useStore.getState().S.programmes).toEqual([])
    expect(useStore.getState().S.programmeDispositions).toMatchObject({
      version: 1,
      entries: { 'instance-1': expect.objectContaining({
        version: 1, disposition: 'skip', instanceId: 'instance-1',
        timeZone: expect.any(String), offsetMinutes: expect.any(Number),
        calendarDate: expect.any(String), recordedAt: expect.any(String)
      }) }
    })
    expect(useStore.getState().S.workouts).not.toContainEqual(expect.objectContaining({ instanceId: 'instance-1' }))
  })

  it('does not reconstruct a continued Programme partial through generic start after reload', () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        programmes: {
          version: 1,
          cycles: [{
            id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-01-01T00:00:00Z',
            timeZone: 'UTC', week1StartDate: '2026-01-05',
            snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
              id: 'programme-session', routineId: routine.id, routineSnapshot: routine
            }] }] }] }
          }]
        }
      }
    }))
    const active = startFromWeightSheet()
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)
    saveProgrammeExit('continue')

    useStore.setState({ S: JSON.parse(JSON.stringify(useStore.getState().S)) })
    const partial = useStore.getState().S.workouts[0]
    const resumed = startFromWeightSheet()
    expect(resumed).toMatchObject({
      sessionType: 'programme', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:programme-session'
    })
    expect(resumed.sourceWorkoutId).toBeUndefined()
    expect(resumed.id).not.toBe(partial.id)
    expect(resumed.entries[0].sets.slice(1).every(set => set.done === false)).toBe(true)
  })

  it('reconstructs the continued Programme instance with its persisted sets and loads after reload', () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        programmes: {
          version: 1,
          cycles: [{
            id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-01-01T00:00:00Z',
            timeZone: 'UTC', week1StartDate: '2026-01-05',
            snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
              id: 'programme-session', routineId: routine.id, routineSnapshot: routine
            }] }] }] }
          }]
        }
      }
    }))
    startFromWeightSheet()
    let changed = false
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        active: {
          ...S.active,
          entries: S.active.entries.map(entry => ({
            ...entry,
            sets: entry.sets.map(set => {
              if (set.phase === 'work' && !changed) {
                changed = true
                return { ...set, done: true, w: 57 }
              }
              return { ...set, done: false }
            })
          }))
        }
      }
    }))
    saveProgrammeExit('continue')

    expect(useStore.getState().S.workouts[0].entries[0].sets[1]).toMatchObject({ done: true, w: 57 })
    useStore.setState({ S: JSON.parse(JSON.stringify(useStore.getState().S)) })
    const partial = useStore.getState().S.workouts[0]
    expect(resumeWeeklySession({
      source: 'programme', routineId: routine.id,
      instanceId: 'pi:cycle-1:programme-session', calendarDate: '2026-01-05'
    })).toBe(true)
    const resumed = useStore.getState().S.active

    expect(resumed).toMatchObject({
      id: partial.id, sourceWorkoutId: partial.id,
      sessionType: 'programme', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:programme-session'
    })
    expect(resumed.entries[0].sets.slice(1).map(set => set.done)).toEqual([true, false])
    expect(resumed.entries[0].sets[1]).toMatchObject({ done: true, w: 57 })
  })

  it('persists and resumes an unstarted Programme exercise swap without restoring the original occurrence', () => {
    const swappedRoutine = {
      ...JSON.parse(JSON.stringify(routine)),
      id: 'programme-swap-routine',
      ex: [
        { ...routine.ex[0], id: LIFT, sets: 1, warmup: [], weight: 40 },
        { ...routine.ex[0], id: ROW_LIFT, sets: 1, warmup: [], weight: 45 }
      ]
    }
    const programmeItem = {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'programme-swap-instance',
      sessionTemplateId: 'programme-swap-session', routineId: swappedRoutine.id, routineSnapshot: swappedRoutine
    }
    beginWorkout(swappedRoutine.id, 70, programmeItem)
    const beforeSwap = useStore.getState().S.active
    const [original, logged] = beforeSwap.entries
    const replacement = {
      id: REPLACEMENT_LIFT,
      target: { id: REPLACEMENT_LIFT, mode: 'reps', sets: 1, reps: 6, weight: 50 },
      plan: { policy: 'off', kind: 'off' },
      sets: [{ phase: 'work', mode: 'reps', w: 50, r: 6, done: false }]
    }

    useStore.setState(({ S }) => ({ S: {
      ...S,
      active: {
        ...S.active,
        entries: S.active.entries.map((entry, index) => index === 1
          ? { ...entry, sets: entry.sets.map(set => ({ ...set, done: set.phase === 'work' })) }
          : entry)
      }
    } }))
    const active = useStore.getState().S.active
    expect(replaceOrInsertActiveExercise(active, 0, replacement)).toEqual({ inserted: false, index: 0 })
    expect(active.entries.map(entry => entry.id)).toEqual([REPLACEMENT_LIFT, logged.id])
    expect(active.entries.map(entry => entry.id)).not.toContain(original.id)
    expect(active.entries.map(entry => entry.occurrenceId)).toEqual([original.occurrenceId, logged.occurrenceId])
    expect(active.entries[0].target).toMatchObject(replacement.target)
    expect(active.entries.map(entry => entry.sets.find(set => set.phase === 'work').programmeRowId))
      .toEqual([`${original.occurrenceId}:work:1`, `${logged.occurrenceId}:work:1`])

    expect(saveProgrammeExit('continue')).toBe(true)
    const persisted = JSON.parse(localStorage.getItem('gym_state_v1'))
    const partial = persisted.workouts.at(-1)
    expect(partial.entries.map(entry => entry.id)).toEqual([REPLACEMENT_LIFT, logged.id])
    expect(partial.entries.map(entry => entry.id)).not.toContain(original.id)
    expect(partial.entries.map(entry => entry.occurrenceId)).toEqual([original.occurrenceId, logged.occurrenceId])
    useStore.setState({ S: persisted })

    expect(resumeWeeklySession({
      source: 'programme', routineId: swappedRoutine.id, instanceId: 'programme-swap-instance', calendarDate: partial.d
    })).toBe(true)
    const resumed = useStore.getState().S.active
    expect(resumed.entries.map(entry => entry.id)).toEqual([REPLACEMENT_LIFT, logged.id])
    expect(resumed.entries.map(entry => entry.id)).not.toContain(original.id)
    expect(resumed.entries.map(entry => entry.occurrenceId)).toEqual([original.occurrenceId, logged.occurrenceId])
    expect(resumed.entries.map(entry => entry.sets.find(set => set.phase === 'work').programmeRowId))
      .toEqual([`${original.occurrenceId}:work:1`, `${logged.occurrenceId}:work:1`])

    markSets(resumed, set => set.phase === 'work')
    finishWorkout()
    const completed = useStore.getState().S.workouts.at(-1)
    expect(completed).toMatchObject({ instanceId: 'programme-swap-instance', complete: true })
    expect(completed.entries.map(entry => entry.id)).toEqual([REPLACEMENT_LIFT, logged.id])
    expect(completed.entries.map(entry => entry.id)).not.toContain(original.id)
    expect(completed.entries.map(entry => entry.occurrenceId)).toEqual([original.occurrenceId, logged.occurrenceId])
  })

  it('keeps programme group metadata through persisted Resume and final completion', () => {
    const groupMeta = { pair: { kind: 'complex', label: 'Clean + press', cues: 'Do not rack between movements.' } }
    const groupedRoutine = {
      ...JSON.parse(JSON.stringify(routine)),
      ex: [
        { ...routine.ex[0], sg: 'pair' },
        { ...routine.ex[0], sg: 'pair', weight: 45 }
      ],
      groupMeta
    }
    const programmeItem = {
      programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'grouped-instance',
      sessionTemplateId: 'grouped-session', routineId: groupedRoutine.id, routineSnapshot: groupedRoutine
    }

    beginWorkout(groupedRoutine.id, 70, programmeItem)
    expect(useStore.getState().S.active.groupMeta).toEqual(groupMeta)
    let workSeen = 0
    markSets(useStore.getState().S.active, set => set.phase === 'work' && workSeen++ === 0)
    expect(saveProgrammeExit('continue')).toBe(true)

    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.workouts[0].groupMeta).toEqual(groupMeta)
    useStore.setState({ S: saved })

    expect(resumeWeeklySession({
      source: 'programme', routineId: groupedRoutine.id, instanceId: 'grouped-instance', calendarDate: saved.workouts[0].d
    })).toBe(true)
    expect(useStore.getState().S.active.groupMeta).toEqual(groupMeta)
    markSets(useStore.getState().S.active)
    finishWorkout()

    const completed = useStore.getState().S.workouts[0]
    expect(completed).toMatchObject({ instanceId: 'grouped-instance', complete: true })
    expect(completed.groupMeta).toEqual(groupMeta)
  })

  it('replaces the owed partial when the same Programme instance is completed on retry', () => {
    const active = markProgramme(startFromWeightSheet())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)
    saveProgrammeExit('continue')

    const partial = useStore.getState().S.workouts[0]
    const retry = {
      ...JSON.parse(JSON.stringify(partial)),
      id: 'retry-session',
      start: partial.end,
      entries: partial.entries.map(entry => ({
        ...entry,
        progression: undefined,
        sets: entry.sets.map(set => ({ ...set, done: true }))
      }))
    }
    retry.entries.forEach(entry => { delete entry.progression })
    useStore.setState(({ S }) => ({ S: { ...S, active: retry } }))

    finishWorkout()

    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0]).toMatchObject({
      instanceId: 'instance-1',
      id: 'retry-session'
    })
    expect(useStore.getState().S.workouts[0]).not.toHaveProperty('partial')
  })


  it('replaces an existing partial with a durable zero-work skip disposition', () => {
    const active = markProgramme(startFromWeightSheet())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)
    saveProgrammeExit('continue')

    const partial = useStore.getState().S.workouts[0]
    const retry = {
      ...JSON.parse(JSON.stringify(partial)),
      id: 'retry-zero-work',
      entries: partial.entries.map(entry => ({
        ...entry,
        sets: entry.sets.map(set => ({ ...set, done: false }))
      }))
    }
    useStore.setState(({ S }) => ({ S: { ...S, active: retry } }))

    expect(saveProgrammeExit('skip')).toBe(true)
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().S.programmes).toEqual([])
    expect(useStore.getState().S.programmeDispositions.entries['instance-1']).toMatchObject({ disposition: 'skip' })
  })

  it('discards saved work without leaving a partial record when Discard is explicit', () => {
    const active = markProgramme(startFromWeightSheet())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)

    expect(saveProgrammeExit('discard')).toBe(true)

    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(0)
  })

  it('persists the implicit below-thirty-percent default once and survives a state reload', () => {
    markProgramme(startFromWeightSheet())
    setProgrammeWorkShape(4, 1)

    expect(saveProgrammeExit('default')).toBe(true)

    const persisted = useStore.getState().S.workouts[0]
    expect(persisted).toMatchObject({
      partial: true,
      complete: false,
      owed: true,
      schedule: 'repeat',
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      instanceId: 'instance-1'
    })
    expect(persisted.entries.every(entry => entry.progression === 'miss')).toBe(true)
    const volume = persisted.vol
    useStore.setState({ S: JSON.parse(JSON.stringify(useStore.getState().S)) })
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0]).toMatchObject({ instanceId: 'instance-1', owed: true, partial: true, vol: volume })

    // The cleared active session makes a repeated default callback a no-op, so volume is not doubled.
    expect(saveProgrammeExit('default')).toBe(false)
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0].vol).toBe(volume)
  })

  it('keeps classic early finish on the legacy path without partial fields', () => {
    const active = startFromWeightSheet()
    markSets(active, (_set, index) => index === 0)

    finishWorkout()

    const confirmation = useUI.getState().sheets.at(-1)
    confirmation.render(() => {}).props.onConfirm()
    expect(useStore.getState().S.workouts[0]).not.toHaveProperty('partial')
    expect(useStore.getState().S.workouts[0]).not.toHaveProperty('owed')
  })

  it('reconstructs the exact classic incomplete record and replaces it on full Finish', () => {
    const incomplete = {
      id: 'classic-incomplete', d: '2026-07-27', start: 100, end: 200,
      routineId: routine.id, name: routine.name, bw: 71, unit: 'kg', plannedComplete: false,
      entries: [{
        id: LIFT, occurrenceId: `${LIFT}:1`, target: { mode: 'reps', prog: 'greyskull', reps: 5 },
        plan: { policy: 'greyskull', kind: 'progress', progressionSetIndex: 1 },
        sets: [
          { phase: 'warmup', w: 20, r: 8, done: true },
          { phase: 'work', w: 42.5, r: 7, done: true, amrapRole: 'progression' },
          { phase: 'work', w: 42.5, r: 5, done: false }
        ]
      }]
    }
    useStore.setState(({ S }) => ({ S: { ...S, workouts: [incomplete], active: null } }))

    expect(resumeWeeklySession({ source: 'classic', routineId: routine.id, calendarDate: '2026-07-27' })).toBe(true)
    const active = useStore.getState().S.active
    expect(active.sourceWorkoutId).toBe(incomplete.id)
    expect(active.entries[0].sets).toMatchObject(incomplete.entries[0].sets)
    expect(active.entries[0].sets[1].amrapRole).toBe('progression')
    expect(active.entries[0].plan).toEqual(incomplete.entries[0].plan)
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0]).toMatchObject({ id: incomplete.id, plannedComplete: false })

    markSets(active)
    finishWorkout()
    const workouts = useStore.getState().S.workouts
    expect(workouts).toHaveLength(1)
    expect(workouts[0].id).toBe(incomplete.id)
    expect(workouts[0].plannedComplete).toBe(true)
  })

  it('updates a resumed classic early finish in place and leaves it resumable', () => {
    const active = startActiveWorkout()
    markSets(active, (_set, index) => index === 0)
    finishWorkout()
    useUI.getState().sheets.at(-1).render(() => {}).props.onConfirm()
    const source = JSON.parse(JSON.stringify(useStore.getState().S.workouts[0]))

    expect(resumeWeeklySession({ source: 'classic', routineId: routine.id, calendarDate: source.d })).toBe(true)
    finishWorkout()
    useUI.getState().sheets.at(-1).render(() => {}).props.onConfirm()

    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0].id).toBe(source.id)
    expect(weeklySessionStatus(useStore.getState().S, { source: 'classic', routineId: routine.id, calendarDate: source.d })).toBe('resume')
  })

  it('discarding a recovered classic record clears both active and its source history', () => {
    const active = startActiveWorkout()
    markSets(active, (_set, index) => index === 0)
    finishWorkout()
    useUI.getState().sheets.at(-1).render(() => {}).props.onConfirm()
    const source = useStore.getState().S.workouts[0]
    expect(resumeWeeklySession({ source: 'classic', routineId: routine.id, calendarDate: source.d })).toBe(true)

    expect(discardWorkout()).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
  })

  it('stops a Programme timer when Discard is selected', () => {
    const callback = vi.fn()
    markProgramme(startFromWeightSheet())
    useUI.getState().startWork(10, 'Timed work', callback)

    expect(saveProgrammeExit('discard')).toBe(true)
    vi.advanceTimersByTime(12000)

    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(0)
    expect(useUI.getState().work).toBeNull()
    expect(callback).not.toHaveBeenCalled()
  })

  it('discards an active workout before a timed callback can mutate it', () => {
    const routes = []
    setNav(path => routes.push(path))
    startFromWeightSheet()
    const callback = vi.fn()
    useUI.getState().startWork(10, 'Timed work', callback)

    discardWorkout()
    vi.advanceTimersByTime(12000)

    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(0)
    expect(useUI.getState().work).toBeNull()
    expect(callback).not.toHaveBeenCalled()
    expect(routes).toEqual(['/workout', '/home'])
  })

  it('round-trips the exact finished active session, including unchecked sets, through undo', () => {
    const routes = []
    setNav(path => routes.push(path))
    const active = startActiveWorkout()
    markSets(active, (_set, index) => index === 0)
    useStore.setState(({ S }) => ({ S: { ...S, active: { ...S.active, cur: 0 } } }))
    const expected = JSON.parse(JSON.stringify(useStore.getState().S.active))

    finishWorkout()
    const confirmation = useUI.getState().sheets.at(-1)
    confirmation.render(() => {}).props.onConfirm()

    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.lastFinishedSession).toEqual(expected)
    expect(useStore.getState().S.lastFinishedSession.entries[0].sets.map(set => set.done)).toEqual([true, false, false])
    const summary = useUI.getState().sheets.at(-1)
    expect(renderToStaticMarkup(summary.render(() => {}))).toContain('Undo finish')

    expect(undoFinish()).toBe(true)
    expect(useStore.getState().S.active).toEqual(expected)
    expect(useStore.getState().S.lastFinishedSession).toBeNull()
    expect(routes).toEqual(['/workout', '/workout'])
  })

  it('clears the undo snapshot when a new workout starts', () => {
    const active = startActiveWorkout()
    markSets(active)
    finishWorkout()

    expect(useStore.getState().S.lastFinishedSession).not.toBeNull()
    useUI.getState().closeAll()
    startActiveWorkout()

    expect(useStore.getState().S.lastFinishedSession).toBeNull()
    expect(undoFinish()).toBe(false)
    expect(useStore.getState().S.active).not.toBeNull()
  })

  it('keeps only the immediately finished session available for undo', () => {
    const first = startActiveWorkout()
    markSets(first)
    finishWorkout()
    const firstSnapshot = useStore.getState().S.lastFinishedSession

    useUI.getState().closeAll()
    const second = startActiveWorkout()
    markSets(second)
    finishWorkout()
    const secondSnapshot = useStore.getState().S.lastFinishedSession

    expect(secondSnapshot.id).not.toBe(firstSnapshot.id)
    expect(undoFinish()).toBe(true)
    expect(useStore.getState().S.active.id).toBe(secondSnapshot.id)
  })

  it('rolls back the completion record and weight cache before restoring the session', () => {
    const active = startActiveWorkout()
    markSets(active)
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        exWeights: { ...S.exWeights, [LIFT]: { w: 1, d: '2025-01-01', unit: 'kg' } }
      }
    }))
    const workoutsBefore = JSON.parse(JSON.stringify(useStore.getState().S.workouts))
    const exWeightsBefore = JSON.parse(JSON.stringify(useStore.getState().S.exWeights))

    finishWorkout()
    expect(useStore.getState().S.workouts).toHaveLength(workoutsBefore.length + 1)
    expect(undoFinish()).toBe(true)
    expect(useStore.getState().S.workouts).toEqual(workoutsBefore)
    expect(useStore.getState().S.exWeights).toEqual(exWeightsBefore)

    expect(discardWorkout()).toBe(true)
    expect(useStore.getState().S.workouts).toEqual(workoutsBefore)
    startActiveWorkout()
    markSets(useStore.getState().S.active)
    finishWorkout()
    expect(useStore.getState().S.workouts).toHaveLength(workoutsBefore.length + 1)
  })

  it('restores a replaced Programme partial when undoing final completion', () => {
    const active = markProgramme(startActiveWorkout())
    let workSeen = 0
    markSets(active, set => set.phase === 'work' && workSeen++ === 0)
    saveProgrammeExit('continue')
    const partialBefore = JSON.parse(JSON.stringify(useStore.getState().S.workouts[0]))

    expect(resumeWeeklySession({
      source: 'programme', routineId: partialBefore.routineId,
      instanceId: partialBefore.instanceId, calendarDate: partialBefore.d
    })).toBe(true)
    markSets(useStore.getState().S.active)
    const resumed = JSON.parse(JSON.stringify(useStore.getState().S.active))
    finishWorkout()

    expect(useStore.getState().S.workouts[0]).not.toHaveProperty('partial')
    expect(undoFinish()).toBe(true)
    expect(useStore.getState().S.workouts).toEqual([partialBefore])
    expect(useStore.getState().S.active).toEqual(resumed)
  })

  it('stops rest and work timers before restoring an undone workout', () => {
    const active = startActiveWorkout()
    markSets(active)
    finishWorkout()

    useUI.getState().startRest(30)
    expect(useUI.getState().timer).not.toBeNull()
    expect(undoFinish()).toBe(true)
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().prep).toBeNull()
    expect(useUI.getState().work).toBeNull()

    finishWorkout()
    const callback = vi.fn()
    useUI.getState().startWork(30, 'Timed work', callback)
    expect(useUI.getState().work).not.toBeNull()
    expect(undoFinish()).toBe(true)
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().prep).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(callback).not.toHaveBeenCalled()
  })
})
