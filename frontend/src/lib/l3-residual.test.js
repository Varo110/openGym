import { describe, expect, it } from 'vitest'
import {
  classifyWorkoutExit,
  entriesForProgrammeExit,
  partialExitBaseline
} from './partial.js'
import {
  buildProgrammeSkipDisposition,
  projectProgrammeQueue,
  projectStateQueue,
  visibleProgrammeDispositions
} from './programmes.js'

const workSet = (weight, done = false) => ({
  phase: 'work', mode: 'reps', w: weight, r: 5, done
})

const duplicateActive = (completed = [1, 2]) => {
  const entries = completed.map((count, index) => ({
    id: 'press',
    sets: Array.from({ length: 5 }, (_, setIndex) => workSet(index ? 60 : 40, setIndex < count))
  }))
  return { entries, partialExitBaseline: partialExitBaseline(entries) }
}

const programmeSession = (id, weekday = 1, routineId = id) => ({
  id,
  routineId,
  weekday,
  routineSnapshot: {
    id: routineId,
    name: routineId,
    ex: [{ id: `${id}-exercise`, sets: 1, reps: 5, muscleWeights: { chest: 1 } }]
  }
})

const activeCycle = ({
  id,
  createdAt,
  week1StartDate = '2026-02-23',
  sessions = [programmeSession(`${id}-session`)]
}) => ({
  id,
  programmeId: `programme-${id}`,
  status: 'active',
  createdAt,
  week1StartDate,
  timeZone: 'UTC',
  snapshot: {
    weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions }] }]
  }
})

const now = Date.parse('2026-02-26T12:00:00.000Z')

const stateWithClassicWeek = (programmes, overrides = {}) => ({
  routines: [{
    id: 'classic-routine',
    name: 'Classic routine',
    ex: [{ id: 'classic-exercise', sets: 1, reps: 5, muscleWeights: { chest: 1 } }]
  }],
  week: { 1: 'classic-routine' },
  dayPlan: {},
  programmes,
  workouts: [],
  ...overrides
})

describe('L3 occurrence-stable partial accounting', () => {
  it.each([
    [2, false, 'repeat', true],
    [3, true, 'advance', false],
    [4, true, 'advance', false]
  ])('keeps duplicate raw exercise occurrences separate at %s completed sets', (completed, thresholdMet, scheduling, owed) => {
    const result = classifyWorkoutExit(duplicateActive([completed === 2 ? 1 : 2, completed === 2 ? 1 : completed - 2]), 'default')
    expect(result.completedWorkSets).toBe(completed)
    expect(result.prescribedWorkSets).toBe(10)
    expect(result.thresholdMet).toBe(thresholdMet)
    expect(result.scheduling).toBe(scheduling)
    expect(result.owed).toBe(owed)
    expect(result.entries).toHaveLength(2)
    expect(new Set(result.entries.map(entry => entry.occurrenceId)).size).toBe(2)
  })

  it('preserves differentiated duplicate occurrence loads and order in the persisted entry shape', () => {
    const active = duplicateActive([1, 2])
    const merged = entriesForProgrammeExit(active)
    expect(merged).toHaveLength(2)
    expect(merged.map(entry => entry.occurrenceId)).toEqual(active.partialExitBaseline.entries.map(entry => entry.occurrenceId))
    expect(merged.map(entry => entry.sets[0].w)).toEqual([40, 60])
    expect(merged.map(entry => entry.sets.filter(set => set.done).length)).toEqual([1, 2])
  })
})

describe('L3 aggregate Programme/classic queue semantics', () => {
  it('slides overdue items across the aggregate queue while retaining deliberate same-day sessions', () => {
    const older = activeCycle({ id: 'older', createdAt: '2026-01-01T08:00:00Z' })
    const newer = activeCycle({ id: 'newer', createdAt: '2026-01-02T08:00:00Z' })
    const result = projectProgrammeQueue({ cycles: [newer, older], workouts: [] }, { now, timeZone: 'UTC' })
    const dates = result.items
      .filter(item => item.source === 'programme')
      .sort((a, b) => a.cycleId.localeCompare(b.cycleId))
      .map(item => [item.cycleId, item.projectedDate])
    expect(dates).toEqual([['newer', '2026-02-27'], ['older', '2026-02-26']])

    const sameDay = activeCycle({
      id: 'same-day',
      createdAt: '2026-01-01T08:00:00Z',
      sessions: [programmeSession('morning'), programmeSession('evening')]
    })
    const sameDayResult = projectProgrammeQueue({ cycles: [sameDay], workouts: [] }, { now, timeZone: 'UTC' })
    expect(new Set(sameDayResult.items.map(item => item.projectedDate))).toEqual(new Set(['2026-02-26']))

    const currentOlder = activeCycle({ id: 'current-older', createdAt: '2026-01-01T08:00:00Z' })
    const currentNewer = activeCycle({ id: 'current-newer', createdAt: '2026-01-02T08:00:00Z' })
    const currentDayResult = projectProgrammeQueue(
      { cycles: [currentNewer, currentOlder], workouts: [] },
      { now: Date.parse('2026-02-23T12:00:00.000Z'), timeZone: 'UTC' }
    )
    expect(currentDayResult.items
      .filter(item => item.source === 'programme')
      .map(item => item.projectedDate))
      .toEqual(['2026-02-23', '2026-02-23'])
  })

  it('adapts the production week/dayPlan classic plan into the mixed queue', () => {
    const programme = activeCycle({ id: 'programme', createdAt: '2026-01-01T08:00:00Z' })
    const result = projectStateQueue(stateWithClassicWeek({ version: 1, cycles: [programme] }), {
      now: Date.parse('2026-02-23T12:00:00.000Z'),
      timeZone: 'UTC'
    })
    const todayItems = result.items.filter(item => item.nominalDate === '2026-02-23')
    expect(todayItems.map(item => item.source)).toEqual(['programme', 'classic'])
    expect(todayItems.map(item => item.nominalDate)).toEqual(['2026-02-23', '2026-02-23'])
    expect(todayItems.map(item => item.projectedDate)).toEqual(['2026-02-23', '2026-02-23'])
  })

  it.each([
    ['without a converted-week marker', undefined, ['programme', 'classic']],
    ['with a versioned converted-week marker', '2026-W09', ['programme']]
  ])('handles generated production classic provenance %s', (_label, programmeCreatedFromWeek, expectedSources) => {
    const programme = activeCycle({ id: 'programme', createdAt: '2026-01-01T08:00:00Z' })
    const programmes = { version: 1, cycles: [programme] }
    if (programmeCreatedFromWeek) programmes.programmeCreatedFromWeek = programmeCreatedFromWeek
    const source = stateWithClassicWeek(programmes)
    const before = JSON.parse(JSON.stringify(source))
    const result = projectStateQueue(source, {
      now: Date.parse('2026-02-23T12:00:00.000Z'),
      timeZone: 'UTC'
    })
    const todayItems = result.items.filter(item => item.nominalDate === '2026-02-23')
    expect(todayItems.map(item => item.source)).toEqual(expectedSources)
    if (!programmeCreatedFromWeek) {
      const generatedClassic = todayItems.find(item => item.source === 'classic')
      expect(generatedClassic?._session).not.toHaveProperty('convertedWeekKey')
    }
    expect(source).toEqual(before)
  })

  it('allocates one legacy record to at most one same-date classic slot', () => {
    const slots = [
      { instanceId: 'classic-1', nominalDate: '2026-02-23', routineId: 'classic-routine', ordinal: 1 },
      { instanceId: 'classic-2', nominalDate: '2026-02-23', routineId: 'classic-routine', ordinal: 2 }
    ]
    const result = projectProgrammeQueue({
      classicSessions: slots,
      workouts: [{
        id: 'only-workout', d: '2026-02-23', end: Date.parse('2026-02-23T12:00:00Z'),
        routineId: 'classic-routine', entries: [{ id: 'classic-exercise', sets: [{ phase: 'work', done: true }] }]
      }]
    }, { now, timeZone: 'UTC' })
    expect(result.items.filter(item => item.status === 'completed').map(item => item.instanceId)).toEqual(['classic-1'])
    expect(result.items.find(item => item.instanceId === 'classic-2')).toMatchObject({ status: 'pending' })
  })

  it('forwards only the explicit converted-week marker and does not let a Programme partial settle classic work', () => {
    const programme = activeCycle({ id: 'programme', createdAt: '2026-01-01T08:00:00Z' })
    const converted = { instanceId: 'converted', nominalDate: '2026-02-23', routineId: 'classic-routine', convertedWeekKey: '2026-W09' }
    const normal = { instanceId: 'normal', nominalDate: '2026-02-23', routineId: 'classic-routine' }
    const source = stateWithClassicWeek({
      version: 1,
      programmeCreatedFromWeek: '2026-W09',
      cycles: [programme]
    }, {
      classicSessions: [converted, normal],
      workouts: [{
        id: 'programme-partial', d: '2026-02-23', end: Date.parse('2026-02-23T12:00:00Z'),
        routineId: 'classic-routine', partial: true, complete: false, owed: false, schedule: 'advance',
        programmeInstance: { version: 1, instanceId: 'pi:programme:programme-session' },
        entries: [{ id: 'classic-exercise', sets: [{ phase: 'work', done: true }] }]
      }]
    })
    const before = JSON.parse(JSON.stringify(source))
    const result = projectStateQueue(source, { now, timeZone: 'UTC' })
    expect(result.items.some(item => item.instanceId === 'converted')).toBe(false)
    expect(result.items.find(item => item.instanceId === 'normal')).toMatchObject({ status: 'pending' })
    expect(source).toEqual(before)
  })
})

describe('L3 additive zero-work disposition and next-open visibility', () => {
  it('stores the required write context without changing a legacy array-shaped Programme value', () => {
    const legacy = [{ id: 'legacy-opaque-data', value: { preserved: true } }]
    const active = { instanceId: 'pi:legacy:session', programmeId: 'p', cycleId: 'c' }
    const disposition = buildProgrammeSkipDisposition(active, {
      now: '2026-02-24T01:30:00.000Z',
      timeZone: 'Europe/Zurich'
    })
    expect(disposition).toMatchObject({
      version: 1,
      disposition: 'skip',
      instanceId: 'pi:legacy:session',
      timeZone: 'Europe/Zurich',
      calendarDate: '2026-02-24',
      recordedAt: '2026-02-24T01:30:00.000Z'
    })
    expect(legacy).toEqual([{ id: 'legacy-opaque-data', value: { preserved: true } }])
  })

  it('exposes a saved disposition after nominal-date and timezone rollover', () => {
    const source = {
      programmes: { version: 1, cycles: [] },
      programmeDispositions: {
        version: 1,
        entries: {
          'pi:programme:session': buildProgrammeSkipDisposition(
            { instanceId: 'pi:programme:session', programmeId: 'p', cycleId: 'c', nominalDate: '2026-02-23' },
            { now: '2026-02-23T23:30:00.000Z', timeZone: 'America/Los_Angeles' }
          )
        }
      }
    }
    const result = projectProgrammeQueue(source, { now: '2026-02-24T12:00:00.000Z', timeZone: 'Europe/Zurich' })
    const visible = visibleProgrammeDispositions(result, { now: '2026-02-24T12:00:00.000Z' })
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({ instanceId: 'pi:programme:session', status: 'skipped' })
  })
})
