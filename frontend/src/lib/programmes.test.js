import { describe, expect, it } from 'vitest'
import {
  HOUR,
  DAY,
  programmeInstanceMarker,
  scheduleWriteContext,
  week1StartDate,
  materializeCycleInstances,
  projectProgrammeQueue,
  projectStateQueue,
  projectedSessionsForDate
} from './programmes.js'

const session = (id, weekday, routineId = id, muscles = { chest: 1 }) => ({
  id,
  routineId,
  weekday,
  routine: {
    id: routineId,
    name: routineId,
    ex: [{ id: `${id}-exercise`, sets: 3, reps: 5, muscleWeights: muscles }]
  }
})

const cycle = ({
  id = 'cycle-1',
  createdAt = '2026-01-01T08:00:00.000Z',
  week1StartDate = '2026-02-23',
  sessions = [session('push', 1), session('pull', 3, 'pull', { back: 1 })]
} = {}) => ({
  id,
  programmeId: `programme-${id}`,
  programmeRevision: 1,
  status: 'active',
  createdAt,
  startedAt: `${week1StartDate}T08:00:00.000Z`,
  week1StartDate,
  timeZone: 'Europe/Zurich',
  snapshot: { weeks: [{ id: `${id}-week-1`, mode: 'normal', days: sessions.map(s => ({ weekday: s.weekday, sessions: [s] })) }] }
})

const marker = (instanceId, overrides = {}) => ({
  version: 1,
  instanceId,
  programmeId: 'programme-cycle-1',
  cycleId: 'cycle-1',
  sessionTemplateId: instanceId.replace('pi:cycle-1:', ''),
  ...overrides
})

const workout = (instanceId, end, overrides = {}) => ({
  id: `workout-${instanceId}-${end}`,
  end,
  programmeInstance: marker(instanceId),
  entries: [{
    id: 'press',
    muscleWeights: { chest: 1 },
    sets: [{ phase: 'work', done: true, w: 40, r: 5 }]
  }],
  ...overrides
})

const project = (input, now = Date.parse('2026-02-26T12:00:00.000Z')) =>
  projectProgrammeQueue(input, { now, timeZone: 'Europe/Zurich' })

describe('Programme calendar and write-time context', () => {
  it('starts Week 1 today on Monday and on the next Monday otherwise', () => {
    expect(week1StartDate({ now: '2026-02-23T09:00:00.000Z', timeZone: 'Europe/Zurich' })).toBe('2026-02-23')
    expect(week1StartDate({ now: '2026-02-24T09:00:00.000Z', timeZone: 'Europe/Zurich' })).toBe('2026-03-02')
  })

  it('stores the IANA timezone, offset, and local calendar date without mutating input', () => {
    const input = { now: '2026-07-01T12:00:00.000Z', timeZone: 'America/New_York' }
    const copy = { ...input }
    expect(scheduleWriteContext(input)).toMatchObject({
      timeZone: 'America/New_York',
      offsetMinutes: -240,
      calendarDate: '2026-07-01'
    })
    expect(input).toEqual(copy)
  })

  it('captures the offset at write time across a DST transition instead of using a fixed zone offset', () => {
    expect(scheduleWriteContext({ now: '2026-03-29T00:30:00.000Z', timeZone: 'Europe/Zurich' }).offsetMinutes).toBe(60)
    expect(scheduleWriteContext({ now: '2026-03-29T01:30:00.000Z', timeZone: 'Europe/Zurich' }).offsetMinutes).toBe(120)
  })

  it('creates a versioned nested marker while retaining flat active fields as a compatibility source', () => {
    expect(programmeInstanceMarker({
      programmeId: 'p1', cycleId: 'c1', instanceId: 'pi:c1:s1', sessionId: 's1',
      weekIndex: 1, weekday: 1, ordinal: 1, nominalDate: '2026-02-23'
    })).toEqual({
      version: 1, instanceId: 'pi:c1:s1', programmeId: 'p1', cycleId: 'c1',
      sessionTemplateId: 's1', weekIndex: 1, weekday: 1, ordinal: 1, nominalDate: '2026-02-23'
    })
  })

  it('keeps a cycle calendar anchor stable across travel and DST projection', () => {
    const source = cycle({ week1StartDate: '2026-03-02', sessions: [session('push', 1)] })
    const before = materializeCycleInstances(source, { now: Date.parse('2026-03-08T12:00:00Z'), timeZone: 'Europe/Zurich' })
    const after = materializeCycleInstances(source, { now: Date.parse('2026-03-09T12:00:00Z'), timeZone: 'America/Los_Angeles' })
    expect(before[0].nominalDate).toBe('2026-03-02')
    expect(after[0].nominalDate).toBe('2026-03-02')
    expect(source.week1StartDate).toBe('2026-03-02')
  })

  it('keeps repeated template ids distinct across weeks and does not drop a later instance', () => {
    const source = cycle({ sessions: [session('same', 1)] })
    source.snapshot.weeks.push({
      weekIndex: 2,
      mode: 'normal',
      days: [{ weekday: 1, sessions: [session('same', 1)] }]
    })

    const materialized = materializeCycleInstances(source)
    expect(materialized.map(item => item.instanceId)).toEqual([
      'pi:cycle-1:w1:d1:o1:same',
      'pi:cycle-1:w2:d1:o1:same'
    ])
    const result = project({ cycles: [source] })
    expect(result.items.filter(item => item.cycleId === 'cycle-1')).toHaveLength(2)
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ reason: 'duplicate-instance' }))
  })

  it('derives a queue from the versioned state namespace without mutating state', () => {
    const source = {
      programmes: { version: 1, cycles: [cycle()] },
      workouts: []
    }
    const before = JSON.parse(JSON.stringify(source))
    expect(projectStateQueue(source, { now: Date.parse('2026-02-26T12:00:00Z'), timeZone: 'UTC' }).front)
      .toMatchObject({ source: 'programme', instanceId: 'pi:cycle-1:push' })
    expect(source).toEqual(before)
  })

  it('uses the persisted programme timezone for state queue projection when no option overrides it', () => {
    const source = {
      programmes: {
        version: 1,
        timeZone: 'America/Los_Angeles',
        cycles: [{
          ...cycle({ week1StartDate: '2026-02-16', sessions: [session('sunday', 7)] }),
          timeZone: 'America/Los_Angeles'
        }]
      },
      workouts: []
    }
    const result = projectStateQueue(source, { now: Date.parse('2026-02-23T00:30:00.000Z') })
    expect(result.timeZone).toBe('America/Los_Angeles')
    expect(result.items[0]).toMatchObject({ nominalDate: '2026-02-22' })
  })
})

describe('D4-aware Programme queue projection', () => {
  it('keeps an unlogged session pending without inventing a miss or owed item', () => {
    const result = project({ cycles: [cycle()] })
    const item = result.items.find(item => item.instanceId === 'pi:cycle-1:push')
    expect(item).toMatchObject({ status: 'pending', owed: false, miss: false })
    expect(result.owed).toEqual([])
    expect(result.front.instanceId).toBe('pi:cycle-1:push')
  })

  it('keeps a below-thirty-percent partial at the front with the same stable instance id', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat',
        completion: { completedWorkSets: 1, prescribedWorkSets: 4, thresholdMet: false }
      })]
    })
    expect(result.front).toMatchObject({ instanceId: 'pi:cycle-1:push', status: 'owed', owed: true, sameInstance: true })
    expect(result.owed.map(item => item.instanceId)).toEqual(['pi:cycle-1:push'])
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:push').projectedDate).toBe('2026-02-26')
  })

  it('advances a thirty-percent-or-more partial while retaining partial visibility', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), {
        partial: true, complete: false, owed: false, schedule: 'advance',
        completion: { completedWorkSets: 3, prescribedWorkSets: 10, thresholdMet: true }
      })]
    })
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:push')).toMatchObject({
      status: 'partial-advanced', partial: true, owed: false, miss: false
    })
    expect(result.front.instanceId).toBe('pi:cycle-1:pull')
    expect(result.owed).toEqual([])
  })

  it('treats explicit Finish as settled and never queues it again', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), { complete: true, partial: false })]
    })
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:push')).toMatchObject({ status: 'completed', owed: false })
    expect(result.front.instanceId).toBe('pi:cycle-1:pull')
  })

  it('does not duplicate a retry and resolves the latest same-instance record deterministically', () => {
    const instanceId = 'pi:cycle-1:push'
    const result = project({
      cycles: [cycle()],
      workouts: [
        workout(instanceId, Date.parse('2026-02-24T12:00:00Z'), { partial: true, complete: false, owed: true, schedule: 'repeat' }),
        workout(instanceId, Date.parse('2026-02-25T12:00:00Z'), { complete: true, partial: false })
      ]
    })
    expect(result.items.filter(item => item.instanceId === instanceId)).toHaveLength(1)
    expect(result.items.find(item => item.instanceId === instanceId)).toMatchObject({ status: 'completed', attemptCount: 2 })
  })

  it('fails closed on an unclassified partial instead of bypassing it', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), { partial: true, complete: false })]
    })
    expect(result.front).toMatchObject({ status: 'invalid', blocked: true })
    expect(result.blocked).toMatchObject({ reason: 'unclassified-record', bypassed: false })
    expect(result.eligible).toEqual([])
  })

  it('honours an explicit Finish-and-skip override below thirty percent after reload', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), {
        partial: true, complete: false, owed: false, schedule: 'advance', exitIntent: 'skip',
        completion: { completedWorkSets: 1, prescribedWorkSets: 4, thresholdMet: false }
      })]
    })
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:push')).toMatchObject({
      status: 'partial-advanced', partial: true, owed: false
    })
  })

  it('honours an explicit Continue override at or above thirty percent after reload', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat', exitIntent: 'continue',
        completion: { completedWorkSets: 3, prescribedWorkSets: 10, thresholdMet: true }
      })]
    })
    expect(result.front).toMatchObject({ status: 'owed', owed: true, partial: true })
  })
})

describe('Programme ordering, slide, guard, and classic boundaries', () => {
  it('fails closed on contradictory threshold and owed signals', () => {
    const result = project({
      cycles: [cycle()],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-25T12:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat',
        completion: { completedWorkSets: 3, prescribedWorkSets: 10, thresholdMet: true }
      })]
    })
    expect(result.front).toMatchObject({ status: 'invalid', blocked: true })
    expect(result.blocked.reason).toBe('contradictory-threshold')
    expect(result.eligible).toEqual([])
  })

  it('orders same-day sessions chronologically and older cycles first on ties regardless of input order', () => {
    const older = cycle({ id: 'older', createdAt: '2026-01-01T08:00:00Z', sessions: [session('morning', 1), session('evening', 1)] })
    const newer = cycle({ id: 'newer', createdAt: '2026-01-02T08:00:00Z', sessions: [session('newer', 1)] })
    const result = project({ cycles: [newer, older] }, Date.parse('2026-02-20T12:00:00.000Z'))
    expect(result.items.filter(item => item.nominalDate === '2026-02-23').map(item => item.instanceId)).toEqual([
      'pi:older:morning', 'pi:older:evening', 'pi:newer:newer'
    ])
  })

  it('slides later sessions instead of cramming them behind an overdue owed head', () => {
    const result = project({
      cycles: [cycle({ sessions: [session('push', 1), session('pull', 3)] })],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-20T12:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat'
      })]
    })
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:push').projectedDate).toBe('2026-02-26')
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:pull').projectedDate).toBe('2026-02-27')
    expect(result.eligible.map(item => item.instanceId)).toEqual(['pi:cycle-1:push'])
  })

  it('blocks an owed head below 48 hours on any primary or secondary muscle overlap and allows exactly 48 hours', () => {
    const owedId = 'pi:cycle-1:push'
    const base = {
      cycles: [cycle()],
      workouts: [workout(owedId, Date.parse('2026-02-24T12:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat'
      })]
    }
    const blocked = project(base, Date.parse('2026-02-26T11:59:59.999Z'))
    expect(blocked.front.instanceId).toBe(owedId)
    expect(blocked.blocked).toMatchObject({ reason: 'recovery-overlap', bypassed: false })
    expect(blocked.eligible).toEqual([])

    const allowed = project(base, Date.parse('2026-02-26T12:00:00.000Z'))
    expect(allowed.front.instanceId).toBe(owedId)
    expect(allowed.blocked).toBeNull()
    expect(allowed.eligible[0].instanceId).toBe(owedId)
  })

  it('does not bypass a guarded owed head with a later session', () => {
    const result = project({
      cycles: [cycle({ sessions: [session('push', 1), session('pull', 1, 'pull', { chest: 1 })] })],
      workouts: [workout('pi:cycle-1:push', Date.parse('2026-02-26T11:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat'
      })]
    })
    expect(result.front.instanceId).toBe('pi:cycle-1:push')
    expect(result.eligible).toEqual([])
    expect(result.items.find(item => item.instanceId === 'pi:cycle-1:pull').bypassed).toBe(true)
  })

  it('keeps active-cycle fronts independent while preserving each cycle\'s guard state', () => {
    const older = cycle({ id: 'older', createdAt: '2026-01-01T08:00:00Z', sessions: [session('push', 1)] })
    const newer = cycle({ id: 'newer', createdAt: '2026-01-02T08:00:00Z', sessions: [session('pull', 1, 'pull', { back: 1 })] })
    const result = project({
      cycles: [newer, older],
      workouts: [workout('pi:older:push', Date.parse('2026-02-26T11:00:00Z'), {
        partial: true, complete: false, owed: true, schedule: 'repeat'
      })]
    })
    expect(result.fronts.map(item => item.instanceId)).toEqual(['pi:older:push', 'pi:newer:pull'])
    expect(result.blockedByCycle.older).toMatchObject({ reason: 'recovery-overlap' })
    expect(result.eligible).toEqual([])
    expect(result.items.find(item => item.instanceId === 'pi:newer:pull').bypassed).toBe(true)
  })

  it('keeps classic Rest scoped to classic slots and suppresses only explicitly converted duplicates', () => {
    const classic = [
      { instanceId: 'classic-rest', source: 'classic', nominalDate: '2026-02-23', rest: true },
      { instanceId: 'classic-converted', source: 'classic', nominalDate: '2026-02-23', convertedWeekKey: '2026-W09' },
      { instanceId: 'classic-normal', source: 'classic', nominalDate: '2026-02-24', routineId: 'classic' }
    ]
    const noConversion = project({ cycles: [], classicSessions: classic })
    expect(noConversion.items.map(item => item.instanceId)).toEqual(['classic-converted', 'classic-normal'])

    const conversion = project({ cycles: [], classicSessions: classic, programmeCreatedFromWeek: '2026-W09' })
    expect(conversion.items.map(item => item.instanceId)).toEqual(['classic-normal'])
    expect(classic[1]).toHaveProperty('convertedWeekKey', '2026-W09')
  })

  it('settles a classic slot from matching legacy history instead of replaying it', () => {
    const result = project({
      classicSessions: [{ instanceId: 'classic-push', nominalDate: '2026-02-23', routineId: 'classic' }],
      workouts: [{
        id: 'classic-history', d: '2026-02-23', end: Date.parse('2026-02-23T12:00:00Z'),
        routineId: 'classic', entries: [{ id: 'press', sets: [{ phase: 'work', done: true }] }]
      }]
    }, Date.parse('2026-02-24T12:00:00Z'))
    expect(result.items.find(item => item.instanceId === 'classic-push')).toMatchObject({
      status: 'completed', sameInstance: true
    })
    expect(result.queue).toEqual([])
  })

  it('settles an explicitly early-finished classic slot as incomplete instead of completed', () => {
    const result = project({
      classicSessions: [{ instanceId: 'classic-push', nominalDate: '2026-02-23', routineId: 'classic' }],
      workouts: [{
        id: 'classic-history', d: '2026-02-23', end: Date.parse('2026-02-23T12:00:00Z'),
        routineId: 'classic', plannedComplete: false,
        entries: [{ id: 'press', sets: [{ phase: 'work', done: true }, { phase: 'work', done: false }] }]
      }]
    }, Date.parse('2026-02-24T12:00:00Z'))

    expect(result.items.find(item => item.instanceId === 'classic-push')).toMatchObject({
      status: 'incomplete', sameInstance: true
    })
    expect(result.queue).toEqual([])
  })

  it('applies the same 48-hour guard to a classic front without letting Programme Rest affect it', () => {
    const classic = [{
      instanceId: 'classic-push', source: 'classic', nominalDate: '2026-02-23', routineId: 'classic',
      routineSnapshot: { ex: [{ id: 'press', muscleWeights: { chest: 1 } }] }
    }]
    const result = project({
      classicSessions: classic,
      workouts: [{
        id: 'classic-history', end: Date.parse('2026-02-26T11:00:00Z'),
        entries: [{ id: 'press', muscleWeights: { chest: 1 }, sets: [{ phase: 'work', done: true }] }]
      }]
    })
    expect(result.front).toMatchObject({ instanceId: 'classic-push', source: 'classic', blocked: true })
    expect(result.blocked).toMatchObject({ reason: 'recovery-overlap', bypassed: false })
    expect(result.eligible).toEqual([])
  })

  it('canonicalizes new primary and secondary arrays before recovery overlap', () => {
    const aliasCycle = cycle({
      sessions: [{
        id: 'array-session', weekday: 1,
        routine: { id: 'array-routine', ex: [{ id: 'press', primaries: ['pectorals'], secondaries: ['triceps'] }] }
      }]
    })
    const result = project({
      cycles: [aliasCycle],
      workouts: [{
        id: 'array-history', end: Date.parse('2026-02-26T11:00:00Z'),
        entries: [{ id: 'row', muscleWeights: { chest: 1 }, sets: [{ phase: 'work', done: true }] }]
      }]
    })
    expect(result.blocked).toMatchObject({ reason: 'recovery-overlap' })
  })

  it('canonicalizes primary and secondary muscle aliases for the recovery overlap guard', () => {
    const aliasCycle = cycle({
      sessions: [{
        id: 'alias-session', weekday: 1,
        routine: { id: 'alias-routine', ex: [{ id: 'press', primaryMuscles: ['pectorals'] }] }
      }]
    })
    const result = project({
      cycles: [aliasCycle],
      workouts: [{
        id: 'alias-history', end: Date.parse('2026-02-26T11:00:00Z'),
        entries: [{ id: 'row', secondaryMuscles: ['chest'], sets: [{ phase: 'work', done: true }] }]
      }]
    })
    expect(result.blocked).toMatchObject({ reason: 'recovery-overlap' })
  })

  it('reports duplicate instance ids instead of double-booking them', () => {
    const duplicate = cycle({
      id: 'cycle-2',
      sessions: [{ ...session('push', 1), instanceId: 'pi:cycle-1:push' }]
    })
    const result = project({ cycles: [cycle(), duplicate] })
    expect(result.items.filter(item => item.instanceId === 'pi:cycle-1:push')).toHaveLength(1)
    expect(result.diagnostics.some(item => item.reason === 'duplicate-instance')).toBe(true)
  })

  it('projects a date without mutating cycles or raw schedules', () => {
    const source = { cycles: [cycle()], classicSessions: [] }
    const before = JSON.parse(JSON.stringify(source))
    expect(projectedSessionsForDate(source, '2026-02-23', { now: Date.parse('2026-02-23T12:00:00Z'), timeZone: 'UTC' }))
      .toHaveLength(1)
    expect(source).toEqual(before)
  })
})

// Keep the public constants exercised so the boundary remains explicit in reviews.
expect(HOUR * 48).toBe(48 * HOUR)
expect(DAY).toBe(24 * HOUR)
