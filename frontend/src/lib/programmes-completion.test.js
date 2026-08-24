import { describe, expect, it } from 'vitest'
import { completeProgrammeCycleInState } from './programmes-ui.js'

const cycle = {
  id: 'cycle-1', programmeId: 'programme-1', status: 'active', lengthWeeks: 1,
  week1StartDate: '2026-02-23', timeZone: 'UTC',
  snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
    id: 'session-1', sessionTemplateId: 'session-1', routineId: 'routine-1',
    routineSnapshot: { id: 'routine-1', name: 'Push', ex: [{ id: 'bench', mode: 'reps', reps: 5 }] }
  }] }] }] }
}

describe('programme completion summary capture', () => {
  it('captures both PR and progress summaries for manual completion', () => {
    const state = {
      unit: 'kg', customEx: [], workouts: [{ cycleId: 'cycle-1', entries: [{
        id: 'bench', name: 'Bench press', target: { mode: 'reps' },
        sets: [{ phase: 'work', done: true, w: 60, r: 5 }]
      }] }],
      programmes: { version: 1, definitions: [], cycles: [structuredClone(cycle)] }
    }

    const completed = completeProgrammeCycleInState(state, 'cycle-1', { now: '2026-03-01T12:00:00.000Z' })

    expect(completed.prSummary).toEqual([{ name: 'Bench press', value: 60, unit: 'kg', mode: 'reps' }])
    expect(completed.progressSummary).toMatchObject([{ name: 'Bench press', weeks: 1, weight: { first: 60, last: 60 } }])
  })
})
