// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  activeProgrammeCycles,
  completedProgrammeCycles,
  createProgrammeDefinition,
  createProgrammeCycle,
  programmeDefinitionOf,
  programmeColourForItem,
  programmeLabelForItem,
  programmeScheduleForDate,
  readyProgrammeDefinitions,
  repeatProgrammeCycleInState,
  startProgrammeCycleInState,
  completeProgrammeCycleInState,
  programmeBuilderSources,
  programmeWeeksFromSource,
  copyProgrammeWeekToTargets,
  cycleWeekMode,
  pickupExerciseRows,
  programmeProjection,
  programmeProgressSummary,
  prepareProgrammeWeeks,
  reconcileProgrammeCyclesInState,
  programmePRSummary,
  programmeTimelineForCycle,
  sanitizeProgrammeWeeks,
  syncProgrammeRoutineSnapshots,
  programmeEditorDefinitionForCycle,
  updateActiveProgrammeCycleInState
} from './programmes-ui.js'
import { pickupStartOptions, suggestionForRow } from '../views/ProgrammePickup.jsx'

const definition = {
  id: 'ppl',
  name: 'PPL Strength',
  emoji: 'dumbbell',
  progression: 'double',
  weeks: [{
    weekIndex: 1,
    mode: 'normal',
    days: [{ weekday: 1, sessions: [{
      id: 'push', sessionTemplateId: 'push', routineId: 'push',
      routineSnapshot: { id: 'push', name: 'Push', ex: [{ id: 'bench', weight: 60, reps: 5 }] }
    }] }]
  }]
}

const stateWith = (cycles = []) => ({
  routines: [], workouts: [],
  programmes: { version: 1, definitions: [definition], cycles }
})

const activeCycle = overrides => ({
  id: 'cycle-1', programmeId: 'ppl', status: 'active', createdAt: '2026-01-01T00:00:00.000Z',
  week1StartDate: '2026-02-23', timeZone: 'UTC', snapshot: { weeks: definition.weeks }, ...overrides
})

describe('programme UI lifecycle projections', () => {
  it('keeps completed definitions in Ready as a done definition while retaining completed cycles for Stats', () => {
    const state = stateWith([activeCycle({ id: 'old', status: 'completed' })])
    expect(activeProgrammeCycles(state)).toEqual([])
    expect(completedProgrammeCycles(state).map(cycle => cycle.id)).toEqual(['old'])
    expect(readyProgrammeDefinitions(state)).toEqual([definition])
    expect(programmeDefinitionOf(state, 'ppl')).toEqual(definition)
  })

  it('does not treat the legacy programme array as ready cycle templates', () => {
    expect(readyProgrammeDefinitions({ programmes: [{ id: 'legacy-doc', name: 'Imported document', weeks: definition.weeks }] })).toEqual([])
  })

  it('creates a cycle from week templates with a stable Monday anchor', () => {
    const cycle = createProgrammeCycle(definition, {
      cycleId: 'cycle-new', now: '2026-02-24T12:00:00.000Z', timeZone: 'UTC'
    })
    expect(cycle).toMatchObject({
      id: 'cycle-new', programmeId: 'ppl', status: 'active', week1StartDate: '2026-03-02', timeZone: 'UTC'
    })
    expect(cycle.snapshot.weeks).toEqual(definition.weeks)
    expect(cycle.snapshot.weeks).not.toBe(definition.weeks)
  })

  it('enforces one active cycle and keeps the old cycle when completing and repeating', () => {
    const state = stateWith()
    const started = startProgrammeCycleInState(state, definition, {
      cycleId: 'cycle-1', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC'
    })
    expect(started.id).toBe('cycle-1')
    expect(startProgrammeCycleInState(state, definition, {
      cycleId: 'cycle-duplicate', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC'
    })).toBe(started)
    completeProgrammeCycleInState(state, 'cycle-1', { now: '2026-03-01T12:00:00.000Z', reason: 'early' })
    const repeated = repeatProgrammeCycleInState(state, 'ppl', {
      cycleId: 'cycle-2', now: '2026-03-02T12:00:00.000Z', timeZone: 'UTC'
    })
    expect(repeated.id).toBe('cycle-2')
    expect(activeProgrammeCycles(state).map(cycle => cycle.id)).toEqual(['cycle-2'])
    expect(completedProgrammeCycles(state).map(cycle => cycle.id)).toEqual(['cycle-1'])
  })

  it('does not repeat a definition while an active cycle already exists', () => {
    const state = stateWith([activeCycle()])
    expect(repeatProgrammeCycleInState(state, 'cycle-1', { cycleId: 'cycle-2', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' })).toBeNull()
    expect(activeProgrammeCycles(state).map(cycle => cycle.id)).toEqual(['cycle-1'])
  })

  it('projects programme-owned dates through the engine and labels the week chip', () => {
    const state = stateWith([activeCycle()])
    const before = JSON.parse(JSON.stringify(state))
    const items = programmeScheduleForDate(state, '2026-02-23', {
      now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC'
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'programme', programmeId: 'ppl', weekIndex: 1 })
    expect(programmeLabelForItem(state, items[0])).toBe('PPL Strength · Push')
    expect(state).toEqual(before)
  })

  it('persists an optional colour through definitions, active snapshots, and active-cycle edits', () => {
    const coloured = createProgrammeDefinition({ ...definition, colour: 'sky' })
    expect(coloured.colour).toBe('sky')

    const cycle = createProgrammeCycle(coloured, {
      cycleId: 'coloured-cycle', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC'
    })
    expect(cycle.programmeSnapshot.colour).toBe('sky')
    expect(cycle.snapshot.colour).toBe('sky')

    const state = stateWith([cycle])
    const item = programmeScheduleForDate(state, '2026-02-23', {
      now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC'
    })[0]
    expect(programmeColourForItem(state, item)).toBe('var(--blue)')

    updateActiveProgrammeCycleInState(state, 'coloured-cycle', { ...coloured, colour: null })
    expect(state.programmes.cycles[0].programmeSnapshot.colour).toBeNull()
    expect(state.programmes.cycles[0].snapshot.colour).toBeNull()
    expect(programmeColourForItem(state, item)).toBeNull()
  })

  it('reads legacy colour fields and resolves a routine name when a snapshot omits it', () => {
    const legacyRoutine = { id: 'legacy-routine', name: 'Legacy push', ex: [{ id: 'bench' }] }
    const legacyState = {
      routines: [legacyRoutine],
      programmes: { version: 1, definitions: [{ id: 'legacy', name: 'Legacy block', color: 'sky' }], cycles: [] }
    }
    expect(programmeColourForItem(legacyState, { programmeId: 'legacy', routineId: legacyRoutine.id })).toBe('var(--blue)')
    expect(programmeLabelForItem(legacyState, {
      programmeId: 'legacy', routineId: legacyRoutine.id, routineSnapshot: { id: legacyRoutine.id, ex: legacyRoutine.ex }
    })).toBe('Legacy block · Legacy push')
  })

  it('builds current, blank, and cloned programme sources with editable week modes', () => {
    const source = {
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'bench', weight: 60, reps: 5 }] }],
      week: { 1: 'push' },
      programmes: { version: 1, definitions: [{ ...definition, id: 'saved', name: 'Saved', weeks: definition.weeks }] }
    }
    expect(programmeBuilderSources(source).map(item => item.value)).toEqual(['current', 'blank', 'programme:saved'])
    const current = programmeWeeksFromSource(source, 'current', 3)
    expect(current).toHaveLength(3)
    expect(current[0].days[0].sessions[0].routineSnapshot.name).toBe('Push')
    expect(current.every(week => week.mode === 'normal')).toBe(true)
    const cloned = programmeWeeksFromSource(source, 'programme:saved', 2)
    expect(cloned[0]).toEqual(definition.weeks[0])
    expect(cloned[0]).not.toBe(definition.weeks[0])
    expect(cycleWeekMode(cloned[0], 'deload').mode).toBe('deload')
    expect(cycleWeekMode(cloned[0], 'rest').mode).toBe('rest')
  })

  it('copies one week to arbitrary destinations without sharing session objects', () => {
    const weeks = programmeWeeksFromSource({ routines: [], week: {} }, 'blank', 4)
    weeks[0].days[0].sessions.push({ id: 's1', sessionTemplateId: 's1', routineId: 'r1' })
    const copied = copyProgrammeWeekToTargets(weeks, 0, [2, 3])
    expect(copied[2].days[0].sessions).toHaveLength(1)
    expect(copied[2].weekIndex).toBe(3)
    expect(copied[2].days[0].sessions[0]).not.toBe(copied[0].days[0].sessions[0])
    expect(copied[3].days[0].sessions[0].sessionTemplateId).not.toBe(copied[2].days[0].sessions[0].sessionTemplateId)
  })

  it('derives pickup rows from history and consumes progression/deload choices in cycle snapshots', () => {
    const state = {
      unit: 'kg', workouts: [{ d: '2026-02-20', complete: true, unit: 'kg', end: '2026-02-20T12:00:00.000Z', entries: [{ id: 'bench', unit: 'kg', mode: 'reps', sets: [{ unit: 'kg', w: 80, r: 5, done: true }] }] }],
      routines: [], programmes: { version: 1, definitions: [definition], cycles: [] }
    }
    const rows = pickupExerciseRows(state, definition, { progression: 'linear', now: Date.parse('2026-02-23T12:00:00.000Z') })
    expect(rows[0]).toMatchObject({ id: 'bench', mode: 'reps', baseline: 80, unit: 'kg' })
    const bodyDefinition = { ...definition, weeks: [{ ...definition.weeks[0], days: [{ weekday: 1, sessions: [{
      id: 'pull', sessionTemplateId: 'pull', routineId: 'pull',
      routineSnapshot: { id: 'pull', name: 'Pull', ex: [{ id: 'pull-up', bodyweight: true, weight: 0, reps: 5 }] }
    }] }] }] }
    expect(pickupExerciseRows({ unit: 'kg', workouts: [] }, bodyDefinition)[0]).toMatchObject({ mode: 'reps', unit: 'reps', baseline: 5 })
    const cycle = createProgrammeCycle(definition, {
      cycleId: 'configured', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startMode: 'deload', deloadPercent: 20,
      startingValues: { 'push:bench:0': 80 }
    })
    const ex = cycle.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
    expect(ex).toMatchObject({ weight: 65, resolvedWeight: 65, programmeProgression: 'linear', prog: 'linear' })
    const highest = createProgrammeCycle(definition, {
      cycleId: 'highest', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startMode: 'highest', startingValues: { 'push:bench:0': 80 }
    })
    expect(highest.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(80)
  })

  it('does not let a history row in pounds become kilograms, or turn bodyweight into a belt load', () => {
    const weighted = {
      ...definition,
      weeks: [{ ...definition.weeks[0], days: [{ weekday: 1, sessions: [{
        id: 'push', sessionTemplateId: 'push', routineId: 'push',
        routineSnapshot: { id: 'push', name: 'Push', ex: [{ id: 'bench', weight: 80, reps: 5 }] }
      }] }] }]
    }
    const state = {
      unit: 'kg',
      workouts: [{ unit: 'lb', complete: true, entries: [{ id: 'bench', unit: 'lb', mode: 'reps', sets: [{ w: 225, r: 5, done: true }] }] }]
    }
    expect(pickupExerciseRows(state, weighted)[0].baseline).toBe(80)
    const bodyDefinition = {
      ...weighted,
      weeks: [{ ...weighted.weeks[0], days: [{ weekday: 1, sessions: [{
        id: 'pull', sessionTemplateId: 'pull', routineId: 'pull',
        routineSnapshot: { id: 'pull', name: 'Pull', ex: [{ id: 'pull-up', bodyweight: true, weight: 0, reps: 5 }] }
      }] }] }]
    }
    const bodyState = { unit: 'kg', workouts: [{ unit: 'kg', entries: [{
      id: 'pull-up', unit: 'kg', mode: 'reps', sets: [{ unit: 'kg', w: 10, r: 5, done: true }]
    }] }] }
    const body = pickupExerciseRows(bodyState, bodyDefinition, { now: Date.parse('2026-02-23T12:00:00.000Z') })
    expect(body[0]).toMatchObject({ baseline: 10, unit: 'kg' })
    const cycle = createProgrammeCycle(bodyDefinition, {
      cycleId: 'bodyweight-cycle', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startingValues: { 'pull:pull-up:0': 10 }, startingValueModes: { 'pull:pull-up:0': 'weight' }
    })
    expect(cycle.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]).toMatchObject({ weight: 10, reps: 5 })
  })

  it('does not treat a positive unitless history load as the current profile unit', () => {
    const weighted = {
      ...definition,
      weeks: [{ ...definition.weeks[0], days: [{ weekday: 1, sessions: [{
        id: 'push', sessionTemplateId: 'push', routineId: 'push',
        routineSnapshot: { id: 'push', name: 'Push', ex: [{ id: 'bench', weight: 80, reps: 5 }] }
      }] }] }]
    }
    const state = {
      unit: 'kg',
      workouts: [{ complete: true, entries: [{ id: 'bench', mode: 'reps', sets: [{ w: 225, r: 5, done: true }] }] }]
    }

    expect(pickupExerciseRows(state, weighted)[0]).toMatchObject({ baseline: 80, unit: 'kg' })
  })

  it('uses the canonical 1RM cap for pickup history instead of clamping high-rep sets', () => {
    const cappedDefinition = {
      ...definition,
      weeks: [{ ...definition.weeks[0], days: [{ weekday: 1, sessions: [{
        id: 'push', sessionTemplateId: 'push', routineId: 'push',
        routineSnapshot: { id: 'push', name: 'Push', ex: [{ id: 'bench', mode: 'reps', weight: 0, reps: 10 }] }
      }] }] }]
    }
    const stateFor = reps => ({
      unit: 'kg',
      workouts: [{ d: '2026-02-20', complete: true, unit: 'kg', entries: [{
        id: 'bench', unit: 'kg', mode: 'reps',
        sets: [{ unit: 'kg', w: 100, r: reps, done: true }]
      }] }]
    })

    expect(pickupExerciseRows(stateFor(12), cappedDefinition, { now: Date.parse('2026-02-23T12:00:00.000Z') })[0]).toMatchObject({ e1rm: 140, baseline: 105 })
    expect(pickupExerciseRows(stateFor(13), cappedDefinition, { now: Date.parse('2026-02-23T12:00:00.000Z') })[0]).toMatchObject({ e1rm: 0, baseline: 100 })
    expect(pickupExerciseRows(stateFor(20), cappedDefinition, { now: Date.parse('2026-02-23T12:00:00.000Z') })[0]).toMatchObject({ e1rm: 0, baseline: 100 })
  })

  it('uses a lighter target for deload suggestions instead of the next progression load', () => {
    const row = { key: 'push:bench:0', mode: 'reps', unit: 'kg', baseline: 80, suggestion: 82.5, cfg: { inc: 2.5 } }

    expect(suggestionForRow(row, 'deload', 10)).toBe(72.5)
    expect(pickupStartOptions({ rows: [row], loadMode: 'deload', deloadPercent: 10 })).toMatchObject({
      startingValues: { 'push:bench:0': 72.5 }, startingValuesAreFinal: true
    })
  })

  it('applies deload suggestions to bodyweight reps and timed holds', () => {
    expect(suggestionForRow({ key: 'pull-up', mode: 'reps', unit: 'reps', baseline: 10, cfg: { reps: 10 } }, 'deload', 10)).toBe(9)
    expect(suggestionForRow({ key: 'plank', mode: 'time', unit: 's', baseline: 60, cfg: { sec: 60 } }, 'deload', 10)).toBe(54)

    const prepared = prepareProgrammeWeeks([{
      weekIndex: 1, mode: 'deload', days: [{ weekday: 1, sessions: [{ routineId: 'r1', routineSnapshot: {
        id: 'r1', ex: [
          { id: 'pull-up', mode: 'reps', bodyweight: true, sets: 2, reps: 10 },
          { id: 'plank', mode: 'time', sets: 2, sec: 60 }
        ]
      } }] }]
    }], { progression: 'off', deloadPercent: 10, lengthWeeks: 1 })
    const preparedExercises = prepared[0].days[0].sessions[0].routineSnapshot.ex
    expect(preparedExercises[0]).toMatchObject({ reps: 9, programmePreDeloadReps: 10 })
    expect(preparedExercises[1]).toMatchObject({ sec: 54, programmePreDeloadSec: 60 })
  })

  it('persists the pickup display value exactly once and snaps automatic deloads to load increments', () => {
    const manual = createProgrammeCycle(definition, {
      cycleId: 'manual-deload', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startMode: 'deload', deloadPercent: 10,
      startingValues: { 'push:bench:0': 74.5 }, startingValuesAreFinal: true
    })
    const manualEx = manual.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
    expect(manualEx.weight).toBe(74.5)
    const automatic = createProgrammeCycle(definition, {
      cycleId: 'automatic-deload', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startMode: 'deload', deloadPercent: 10,
      startingValues: { 'push:bench:0': 80 }
    })
    expect(automatic.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(72.5)
  })

  it('keeps cardio targets unchanged through a lighter restart', () => {
    const cardio = {
      ...definition,
      weeks: [{ ...definition.weeks[0], days: [{ weekday: 1, sessions: [{
        id: 'run', sessionTemplateId: 'run', routineId: 'run',
        routineSnapshot: { id: 'run', name: 'Run', ex: [{ id: 'running', mode: 'cardio', min: 20, speed: 8 }] }
      }] }] }]
    }
    const cycle = createProgrammeCycle(cardio, {
      cycleId: 'cardio-deload', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startMode: 'deload', deloadPercent: 20,
      startingValues: { 'run:running:0': 20 }
    })
    expect(cycle.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]).toMatchObject({ min: 20 })
  })

  it('leaves progression in the runtime snapshot and pauses it across a configured deload week', () => {
    const weeks = Array.from({ length: 8 }, (_, index) => ({
      ...definition.weeks[0],
      weekIndex: index + 1,
      mode: index === 6 ? 'deload' : 'normal',
      days: definition.weeks[0].days.map(day => ({
        ...day,
        sessions: day.sessions.map(session => ({
          ...session,
          routineSnapshot: { ...session.routineSnapshot, ex: session.routineSnapshot.ex.map(cfg => ({ ...cfg, sets: 4 })) }
        }))
      }))
    }))
    const cycle = createProgrammeCycle({ ...definition, weeks }, {
      cycleId: 'runtime-progress', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC', unit: 'kg',
      progression: 'linear', startingValues: { 'push:bench:0': 80 }, lengthWeeks: 8
    })
    const week2 = cycle.snapshot.weeks[1].days[0].sessions[0].routineSnapshot.ex[0]
    const week7 = cycle.snapshot.weeks[6].days[0].sessions[0].routineSnapshot.ex[0]
    const week8 = cycle.snapshot.weeks[7].days[0].sessions[0].routineSnapshot.ex[0]
    expect(week2).toMatchObject({ weight: 80, prog: 'linear', programmeWeek: 2 })
    expect(week7).toMatchObject({ weight: 72.5, prog: 'linear', programmeWeekMode: 'deload' })
    expect(week7.sets).toBe(2)
    expect(week8.weight).toBe(80)
  })

  it('deduplicates repeated programme weeks by routine/exercise occurrence', () => {
    const repeated = {
      ...definition,
      weeks: Array.from({ length: 8 }, (_, index) => ({
        weekIndex: index + 1, mode: 'normal', days: definition.weeks[0].days
      }))
    }
    const rows = pickupExerciseRows({ unit: 'kg', workouts: [] }, repeated)
    expect(rows).toHaveLength(1)
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length)
  })

  it('does not start a zero-session programme and exposes progression checkpoints', () => {
    const empty = { ...definition, id: 'empty', weeks: [{ weekIndex: 1, mode: 'rest', days: [] }] }
    const state = stateWith()
    expect(startProgrammeCycleInState(state, empty, { cycleId: 'empty-cycle', now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' })).toBeNull()
    const timeline = programmeTimelineForCycle({ unit: 'kg', workouts: [] }, activeCycle(), { now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' })
    expect(timeline.currentWeek).toBe(1)
    expect(timeline.weeks[0].items[0].exercises[0].name).toBe('bench')
    expect(timeline.weeks[0].items[0].exercises[0].next).toContain('60')
  })

  it('automatically completes a cycle only after every projected item is complete and captures progress', () => {
    const state = stateWith([activeCycle()])
    const projected = programmeProjection(state, { now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' })
    state.workouts = [{ cycleId: 'cycle-1', instanceId: projected.items[0].instanceId, complete: true, end: '2026-02-23T12:30:00.000Z', d: '2026-02-23', entries: [{ id: 'bench', name: 'Bench press', target: { mode: 'reps' }, sets: [{ phase: 'work', done: true, w: 60, r: 5 }] }] }]
    expect(reconcileProgrammeCyclesInState(state, { now: '2026-02-23T13:00:00.000Z', timeZone: 'UTC' })).toHaveLength(1)
    expect(state.programmes.cycles[0]).toMatchObject({
      status: 'completed', completionReason: 'automatic', completedSessions: 1,
      progressSummary: [{ name: 'Bench press', weeks: 1, weight: { first: 60, last: 60 } }]
    })
  })

  it('buckets progress by programme calendar weeks across DST instead of elapsed milliseconds', () => {
    const weeks = [1, 2].map(weekIndex => ({
      weekIndex,
      mode: 'normal',
      days: [{ weekday: 1, sessions: [{ id: `push:w${weekIndex}`, routineId: 'push', routineSnapshot: {
        id: 'push', name: 'Push', ex: [{ id: 'bench', mode: 'reps', reps: 5, weight: 60 }
        ]
      } }] }]
    }))
    const cycle = activeCycle({
      lengthWeeks: 2,
      week1StartDate: '2026-03-23',
      timeZone: 'Europe/Berlin',
      snapshot: { weeks }
    })
    const state = {
      unit: 'kg',
      customEx: [],
      workouts: [
        { cycleId: cycle.id, d: '2026-03-23', unit: 'kg', entries: [{ id: 'bench', name: 'Bench press', target: { mode: 'reps' }, sets: [{ phase: 'work', done: true, w: 60, r: 5 }] }] },
        { cycleId: cycle.id, d: '2026-03-30', unit: 'kg', entries: [{ id: 'bench', name: 'Bench press', target: { mode: 'reps' }, sets: [{ phase: 'work', done: true, w: 80, r: 5 }] }] }
      ]
    }

    expect(programmeProgressSummary(state, cycle)).toMatchObject([{
      name: 'Bench press',
      weeks: 2,
      weight: { first: 60, last: 80 }
    }])
  })

  it('prefers persisted programme week provenance over calendar fallback', () => {
    const cycle = activeCycle({ lengthWeeks: 2, week1StartDate: '2026-03-23' })
    const state = {
      unit: 'kg', customEx: [],
      workouts: [
        { cycleId: cycle.id, d: '2026-03-23', programmeStep: { weekIndex: 2 }, entries: [{ id: 'bench', name: 'Bench press', target: { mode: 'reps' }, sets: [{ phase: 'work', done: true, w: 80, r: 5 }] }] }
      ]
    }

    expect(programmeProgressSummary(state, cycle)[0]).toMatchObject({ weeks: 1, weight: { first: 80, last: 80 } })
  })

  it('summarises completed programme PRs from cycle-owned workouts', () => {
    const cycle = activeCycle({ id: 'done', status: 'completed' })
    const summary = programmePRSummary({ unit: 'kg', workouts: [{ cycleId: 'done', complete: true, entries: [{ id: 'bench', name: 'Bench press', mode: 'reps', sets: [{ w: 82.5, r: 5, done: true }] }] }] }, cycle)
    expect(summary).toEqual([{ name: 'Bench press', value: 82.5, unit: 'kg', mode: 'reps' }])
  })

  it('refreshes every cloned routine snapshot and removes empty stale sessions before save', () => {
    const routine = { id: 'push', name: 'Push edited', ex: [{ id: 'bench', weight: 82.5, reps: 5 }] }
    const weeks = [{ weekIndex: 1, days: [{ weekday: 1, sessions: [
      { routineId: 'push', routineSnapshot: { id: 'push', name: 'Push old', ex: [{ id: 'bench', weight: 60 }] } },
      { routineId: 'empty', routineSnapshot: { id: 'empty', ex: [] } }
    ] }] }, { weekIndex: 2, days: [{ weekday: 1, sessions: [
      { routineId: 'push', routineSnapshot: { id: 'push', name: 'Push old', ex: [{ id: 'bench', weight: 60 }] } }
    ] }] }]
    const refreshed = syncProgrammeRoutineSnapshots(weeks, routine)
    expect(refreshed[1].days[0].sessions[0].routineSnapshot.name).toBe('Push edited')
    const clean = sanitizeProgrammeWeeks(refreshed)
    expect(clean[0].days[0].sessions.map(session => session.routineId)).toEqual(['push'])
  })

  it('passes pickup values as final displayed targets instead of applying deload twice', () => {
    const rows = [{ key: 'push:bench:0', mode: 'reps', unit: 'kg', baseline: 80 }]
    const options = pickupStartOptions({ rows, loadMode: 'deload', deloadPercent: 10, values: {} })
    expect(options).toEqual({ startingValues: { 'push:bench:0': 72.5 }, startingValueModes: { 'push:bench:0': 'weight' }, startingValuesAreFinal: true })
    const manual = pickupStartOptions({ rows, loadMode: 'deload', deloadPercent: 10, values: { 'push:bench:0': 74.5 } })
    expect(manual.startingValues['push:bench:0']).toBe(74.5)
  })

  it('builds a named current-week timeline with last and next targets', () => {
    const cycle = activeCycle({ week1StartDate: '2026-02-23', progression: 'linear' })
    const state = {
      unit: 'kg',
      workouts: [{ cycleId: 'cycle-1', programmeStep: { cycleId: 'cycle-1', weekIndex: 1, nominalDate: '2026-02-23' }, d: '2026-02-22', unit: 'kg', entries: [{ id: 'bench', occurrenceId: 'bench#1', unit: 'kg', target: { mode: 'reps', sets: 3, reps: 5, weight: 80, prog: 'linear', unit: 'kg' }, sets: [{ unit: 'kg', w: 80, r: 5, done: true }, { unit: 'kg', w: 80, r: 5, done: true }, { unit: 'kg', w: 80, r: 5, done: true }] }] }]
    }
    const timeline = programmeTimelineForCycle(state, cycle, { now: Date.parse('2026-02-25T12:00:00Z'), timeZone: 'UTC' })
    const exercise = timeline.weeks[0].items[0].exercises[0]
    expect(timeline.weeks[0].guidance).toBe('current')
    expect(exercise).toMatchObject({ name: 'bench', last: '80 kg × 5', next: '82.5 kg × 5' })
  })

  it('shows the configured deload target instead of advancing the roadmap through a hold week', () => {
    const deloadCfg = { id: 'bench', mode: 'reps', weight: 72.5, reps: 5, prog: 'linear', programmeInitial: false, programmeWeekMode: 'deload' }
    const cycle = activeCycle({
      projectionPrepared: true,
      progression: 'linear',
      snapshot: { weeks: [{ weekIndex: 1, mode: 'deload', days: [{ weekday: 1, sessions: [{
        id: 'push', routineId: 'push', routineSnapshot: { id: 'push', name: 'Push', ex: [deloadCfg] }
      }] }]}] }
    })
    const state = {
      unit: 'kg',
      workouts: [{ cycleId: 'cycle-1', programmeStep: { cycleId: 'cycle-1', weekIndex: 1, nominalDate: '2026-02-23' }, d: '2026-02-22', unit: 'kg', entries: [{ id: 'bench', occurrenceId: 'bench#1', mode: 'reps', unit: 'kg', target: { mode: 'reps', weight: 80, reps: 5, unit: 'kg' }, sets: [{ unit: 'kg', w: 80, r: 5, done: true }] }] }]
    }
    const exercise = programmeTimelineForCycle(state, cycle, { now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' }).weeks[0].items[0].exercises[0]
    expect(exercise).toMatchObject({ kind: 'hold', next: '72.5 kg × 5' })
  })

  it('does not let a later cycle week rewrite an earlier roadmap week', () => {
    const weeks = [1, 2].map(weekIndex => ({ weekIndex, mode: 'normal', days: definition.weeks[0].days }))
    const cycle = activeCycle({ lengthWeeks: 2, progression: 'linear', snapshot: { weeks } })
    const entry = weight => ({ id: 'bench', occurrenceId: 'bench#1', unit: 'kg', target: { mode: 'reps', sets: 3, reps: 5, weight, prog: 'linear', unit: 'kg' }, sets: [1, 2, 3].map(() => ({ unit: 'kg', w: weight, r: 5, done: true })) })
    const state = {
      unit: 'kg',
      workouts: [
        { cycleId: 'cycle-1', programmeStep: { cycleId: 'cycle-1', weekIndex: 1, nominalDate: '2026-02-23' }, d: '2026-02-24', unit: 'kg', entries: [entry(80)] },
        { cycleId: 'cycle-1', programmeStep: { cycleId: 'cycle-1', weekIndex: 2, nominalDate: '2026-03-02' }, d: '2026-03-03', unit: 'kg', entries: [entry(100)] }
      ]
    }

    const timeline = programmeTimelineForCycle(state, cycle, { now: '2026-03-04T12:00:00.000Z', timeZone: 'UTC' })
    expect(timeline.weeks[0].items[0].exercises[0]).toMatchObject({ last: '80 kg × 5', next: '82.5 kg × 5' })
    expect(timeline.weeks[1].items[0].exercises[0]).toMatchObject({ last: '100 kg × 5', next: '102.5 kg × 5' })
  })

  it('bounds same-week roadmap history by the individual workout item', () => {
    const twoSessions = {
      ...definition,
      weeks: [{ weekIndex: 1, mode: 'normal', days: [
        { weekday: 1, sessions: [{ id: 'push-mon', sessionTemplateId: 'push-mon', routineId: 'push', routineSnapshot: definition.weeks[0].days[0].sessions[0].routineSnapshot }] },
        { weekday: 5, sessions: [{ id: 'push-fri', sessionTemplateId: 'push-fri', routineId: 'push', routineSnapshot: definition.weeks[0].days[0].sessions[0].routineSnapshot }] }
      ] }]
    }
    const cycle = activeCycle({ projectionPrepared: true, lengthWeeks: 1, progression: 'linear', snapshot: { weeks: twoSessions.weeks } })
    const entry = weight => ({ id: 'bench', occurrenceId: 'bench#1', unit: 'kg', target: { mode: 'reps', sets: 3, reps: 5, weight, prog: 'linear', unit: 'kg' }, sets: [1, 2, 3].map(() => ({ unit: 'kg', w: weight, r: 5, done: true })) })
    const state = {
      unit: 'kg',
      workouts: [
        { cycleId: 'cycle-1', programmeStep: { cycleId: 'cycle-1', weekIndex: 1, weekday: 1, ordinal: 1, nominalDate: '2026-02-23' }, d: '2026-02-23', unit: 'kg', entries: [entry(80)] },
        { cycleId: 'cycle-1', programmeStep: { cycleId: 'cycle-1', weekIndex: 1, weekday: 5, ordinal: 1, nominalDate: '2026-02-27' }, d: '2026-02-27', unit: 'kg', entries: [entry(100)] }
      ]
    }

    const timeline = programmeTimelineForCycle(state, cycle, { now: '2026-02-28T12:00:00.000Z', timeZone: 'UTC' })
    expect(timeline.weeks[0].items[0].exercises[0]).toMatchObject({ last: '80 kg × 5', next: '82.5 kg × 5' })
    expect(timeline.weeks[0].items[1].exercises[0]).toMatchObject({ last: '100 kg × 5', next: '102.5 kg × 5' })
  })

  it('edits the active cycle snapshot without rewriting the reusable definition', () => {
    const cycle = activeCycle({ projectionPrepared: true, snapshot: { weeks: JSON.parse(JSON.stringify(definition.weeks)) } })
    const state = stateWith([cycle])
    const editor = programmeEditorDefinitionForCycle(cycle)
    const editedWeeks = editor.weeks.map(week => ({ ...week, days: week.days.map(day => ({
      ...day, sessions: day.sessions.map(session => ({
        ...session, routineSnapshot: { ...session.routineSnapshot, ex: [{ ...session.routineSnapshot.ex[0], weight: 100 }] }
      }))
    })) }))

    expect(updateActiveProgrammeCycleInState(state, cycle.id, { ...editor, name: 'Active edit', weeks: editedWeeks })).toMatchObject({ id: cycle.id, status: 'active' })
    expect(state.programmes.cycles[0].programmeSnapshot).toMatchObject({ name: 'Active edit', weeks: editedWeeks })
    expect(state.programmes.cycles[0].snapshot.weeks).toEqual(editedWeeks)
    expect(state.programmes.definitions[0].name).toBe(definition.name)
    expect(state.programmes.definitions[0].weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(60)
    expect(programmeLabelForItem(state, { programmeId: 'ppl', cycleId: cycle.id, weekIndex: 1 })).toBe('Active edit · Routine')
  })
})
