// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { setNav } from './lib/nav.js'
import { beginWorkout, finishWorkout } from './sheets.jsx'

const clone = value => JSON.parse(JSON.stringify(value))

function baseState() {
  return {
    ...clone(DEF),
    sound: false,
    unit: 'kg',
    routines: [],
    workouts: [],
    programmes: {
      version: 1,
      definitions: [{ id: 'p1', name: 'P1', weeks: [] }],
      cycles: [{
        id: 'cycle-1',
        programmeId: 'p1',
        status: 'active',
        timeZone: 'UTC',
        snapshot: { weeks: [] }
      }]
    }
  }
}

const item = {
  source: 'programme',
  programmeId: 'p1',
  cycleId: 'cycle-1',
  instanceId: 'instance-1',
  sessionTemplateId: 'template-1',
  routineId: 'routine-1',
  weekIndex: 1,
  weekday: 1,
  ordinal: 1,
  nominalDate: '2026-08-24',
  projectedDate: '2026-08-24',
  routineSnapshot: {
    id: 'routine-1',
    name: 'Programme push',
    ex: [{ id: 'bench', mode: 'reps', sets: 1, reps: 5, weight: 20 }]
  }
}

describe('programme shared workout lifecycle adapter', () => {
  beforeEach(() => {
    useUI.getState().closeAll()
    useUI.getState().stopRest()
    useStore.setState({ S: baseState(), user: null })
    setNav(() => {})
  })

  afterEach(() => {
    useUI.getState().closeAll()
    useUI.getState().stopRest()
  })

  it('starts from the immutable programme routine snapshot and records its identity', () => {
    beginWorkout(item.routineId, null, item)

    const active = useStore.getState().S.active
    expect(active).toMatchObject({
      sessionType: 'programme',
      programmeSession: true,
      programmeId: 'p1',
      cycleId: 'cycle-1',
      instanceId: 'instance-1',
      sessionId: 'template-1',
      routineId: 'routine-1'
    })
    expect(active.programmeStep).toMatchObject({ weekIndex: 1, weekday: 1, ordinal: 1 })
    expect(active.entries).toHaveLength(1)
    expect(active.entries[0].target).toMatchObject({ id: 'bench', weight: 20, reps: 5 })
    expect(active.partialExitBaseline).toMatchObject({ version: 2, prescribedWorkSets: 1 })
  })

  it('finishes a completed programme session into history and completes its cycle', () => {
    useStore.setState({ S: baseState(), user: null })
    beginWorkout(item.routineId, null, item)
    useStore.getState().update(state => {
      state.active.entries.forEach(entry => entry.sets.forEach(set => { set.done = true }))
    })

    finishWorkout()

    const state = useStore.getState().S
    expect(state.active).toBeNull()
    expect(state.workouts).toHaveLength(1)
    expect(state.workouts[0]).toMatchObject({
      programmeSession: true,
      programmeId: 'p1',
      cycleId: 'cycle-1',
      instanceId: 'instance-1',
      complete: true,
      partial: false,
      disposition: 'finish'
    })
    expect(state.workouts[0].completion).toMatchObject({
      completedWorkSets: 1,
      prescribedWorkSets: 1,
      disposition: 'finish'
    })
    expect(state.programmes.cycles[0]).toMatchObject({ status: 'completed', completionReason: 'finish' })
  })
})
