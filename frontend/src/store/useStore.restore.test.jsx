// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

import { api } from '../lib/api.js'
import { DEF, loadState, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('state restore draft cleanup', () => {
  it('rehydrates the canonical device-local active workout after process reconstruction', () => {
    const active = {
      id: 'active-1', d: '2026-08-19', start: 1787150000000, cur: 1,
      routineId: 'push', name: 'Lifecycle workout', unit: 'kg', sourceUnit: 'kg',
      sessionType: 'programme', programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'instance-1',
      entries: [
        { id: 'lift', target: { mode: 'reps', weight: 62.5, reps: 5 }, sets: [
          { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
          { phase: 'work', mode: 'reps', w: 62.5, r: 5, done: true, effort: 8, effortScale: 'rpe', amrapRole: 'none' },
          { phase: 'work', mode: 'reps', w: 62.5, r: 9, done: false, amrap: true, amrapRole: 'progression' },
        ] },
        { id: 'run', target: { mode: 'cardio' }, sets: [
          { phase: 'work', mode: 'cardio', min: 18, speed: 9.4, done: false },
        ] },
      ],
    }
    useStore.getState().replaceState({ ...clone(DEF), active })
    const persistedActive = JSON.parse(localStorage.getItem('gym_state_v1')).active
    const restored = loadState()

    expect(restored.active).toEqual(persistedActive)
    expect(restored.active).toMatchObject(active)
  })

  it('does not resurrect a completed historical workout whose user ended it with incomplete sets', () => {
    const state = {
      ...clone(DEF), active: null,
      workouts: [{
        id: 'finished-early', end: 1787140000000,
        entries: [{ id: 'lift', sets: [
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 0, done: false },
        ] }],
      }],
    }
    localStorage.setItem('gym_state_v1', JSON.stringify(state))

    const restored = loadState()

    expect(restored.active).toBeNull()
    expect(restored.workouts).toHaveLength(1)
    expect(restored.workouts[0].id).toBe('finished-early')
  })

  it('keeps a signed-in device active workout while accepting newer account data', async () => {
    const localActive = {
      id: 'local-active', start: 1787150000000, cur: 0, name: 'Local workout',
      entries: [{ id: 'lift', sets: [{ w: 70, r: 7, done: false, amrapRole: 'progression' }] }],
    }
    const local = { ...clone(DEF), _ts: 20, active: localActive }
    const remote = {
      ...clone(DEF), _ts: 21,
      active: { id: 'stale-other-device', entries: [] },
      routines: [{ id: 'remote-routine', name: 'Remote routine', ex: [] }],
      workouts: [{ id: 'remote-history', entries: [] }],
    }
    useStore.setState({ user: { id: 'user-1' } })
    useStore.getState().replaceState(local)
    const persistedLocalActive = JSON.parse(localStorage.getItem('gym_state_v1')).active
    api.mockResolvedValueOnce({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.active).toEqual(persistedLocalActive)
    expect(useStore.getState().S.routines).toEqual(remote.routines)
    expect(useStore.getState().S.workouts).toMatchObject(remote.workouts)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active).toEqual(persistedLocalActive)
  })

  it('keeps the source history record for a recovered active workout across a newer signed-in pull', async () => {
    const source = { id: 'incomplete-source', d: '2026-08-19', routineId: 'push', plannedComplete: false, entries: [] }
    const localActive = { id: source.id, sourceWorkoutId: source.id, d: source.d, routineId: source.routineId, entries: [] }
    const local = { ...clone(DEF), _ts: 20, workouts: [source], active: localActive }
    const remote = { ...clone(DEF), _ts: Date.now() + 10000, workouts: [{ id: 'remote-history', entries: [] }] }
    useStore.setState({ user: { id: 'user-1' } })
    useStore.getState().replaceState(local)
    api.mockResolvedValueOnce({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.active.sourceWorkoutId).toBe(source.id)
    expect(useStore.getState().S.workouts.map(workout => workout.id)).toEqual(['remote-history', source.id])
  })

  it('does not resurrect a stale remote active workout after this device cleared it', async () => {
    const local = { ...clone(DEF), _ts: 20, active: null }
    const remote = {
      ...clone(DEF), _ts: 21,
      active: { id: 'stale-active', name: 'Other device', entries: [] },
      routines: [{ id: 'remote-routine', name: 'Remote routine', ex: [] }],
    }
    useStore.setState({ S: local, user: { id: 'user-1' } })
    api.mockResolvedValueOnce({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.active).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active).toBeNull()
    expect(useStore.getState().S.routines).toEqual(remote.routines)
  })

  it('pulls a newer migrated server state without pushing stale local exercise identities', async () => {
    const local = {
      ...clone(DEF),
      _ts: 20,
      routines: [{ id: 'standing-press', ex: [{ id: '0091' }] }],
      workouts: [{ id: 'stale-workout', entries: [{ id: '0091', sets: [] }] }]
    }
    const remote = {
      ...clone(DEF),
      _ts: 21,
      routines: [{ id: 'standing-press', ex: [{ id: '1457' }] }],
      workouts: [{ id: 'migrated-workout', entries: [{ id: '1457', sets: [] }] }]
    }
    useStore.setState({ S: local, user: { id: 'user-1' } })
    api.mockResolvedValueOnce({ state: remote })

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/data')
    expect(useStore.getState().S.routines[0].ex[0].id).toBe('1457')
    expect(useStore.getState().S.workouts[0].entries[0].id).toBe('1457')
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).workouts[0].entries[0].id).toBe('1457')
  })

  it('adopts a newer server sync generation over dirty newer local state once without pushing it back', async () => {
    const localActive = { id: 'local-active', entries: [{ id: 'lift', sets: [] }] }
    const local = {
      ...clone(DEF), _ts: 300, syncGeneration: 0, active: localActive,
      routines: [{ id: 'local-routine', name: 'Local', ex: [] }],
      workouts: [{ id: 'local-only-history', entries: [] }],
    }
    const remote = {
      ...clone(DEF), _ts: 200, syncGeneration: 1,
      routines: [{ id: 'server-routine', name: 'Server', ex: [] }],
      workouts: [{ id: 'server-history', entries: [] }],
    }
    useStore.setState({ S: local, user: { id: 'user-1' } })
    localStorage.setItem('gym_dirty', '1')
    api.mockResolvedValue({ state: remote })

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/data')
    expect(useStore.getState().S.routines).toEqual(remote.routines)
    expect(useStore.getState().S.workouts).toMatchObject(remote.workouts)
    expect(useStore.getState().S.active).toMatchObject(localActive)
    expect(useStore.getState().S.syncGeneration).toBe(1)
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).syncGeneration).toBe(1)
    const firstBackup = JSON.parse(localStorage.getItem('gym_sync_conflict_backup_v1'))
    expect(firstBackup.serverGeneration).toBe(1)
    expect(firstBackup.state.workouts).toEqual(local.workouts)

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    expect(api.mock.calls).toEqual([['/api/data'], ['/api/data']])
    expect(JSON.parse(localStorage.getItem('gym_sync_conflict_backup_v1'))).toEqual(firstBackup)

    localStorage.setItem('gym_dirty', '1')
    api.mockResolvedValue({ state: { ...remote, _ts: 400, syncGeneration: 2 } })
    await useStore.getState().pullState()

    const secondBackup = JSON.parse(localStorage.getItem('gym_sync_conflict_backup_v1'))
    expect(secondBackup.serverGeneration).toBe(2)
    expect(secondBackup.state.syncGeneration).toBe(1)
    expect(useStore.getState().S.syncGeneration).toBe(2)
  })

  it('purges ephemeral routine drafts from a pulled state before exposing it', async () => {
    const pulled = {
      ...clone(DEF),
      _ts: Date.now() + 1,
      routines: [
        { id: 'draft-routine', name: 'Freestyle draft', draft: true, ex: [] },
        { id: 'saved-routine', name: 'Saved routine', ex: [] }
      ]
    }
    api.mockResolvedValue({ state: pulled })

    await useStore.getState().pullState()

    const routines = useStore.getState().S.routines
    expect(routines.map(routine => routine.id)).toEqual(['saved-routine'])
    expect(routines.some(routine => routine.draft)).toBe(false)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).routines).toEqual(routines)
  })

  it('does not push a local draft when the pulled state loses the timestamp conflict', async () => {
    const local = {
      ...clone(DEF),
      _ts: 20,
      routines: [{ id: 'draft-routine', name: 'Freestyle draft', draft: true, ex: [] }]
    }
    const remote = { ...clone(DEF), _ts: 10, routines: [{ id: 'remote-routine', name: 'Remote', ex: [] }] }
    useStore.setState({ S: local, user: { id: 'user-1' } })
    api.mockResolvedValueOnce({ state: remote }).mockResolvedValueOnce({})

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    const pushed = JSON.parse(api.mock.calls[1][1].body).state
    expect(pushed.routines.some(routine => routine.draft)).toBe(false)
    expect(useStore.getState().S.routines.some(routine => routine.draft)).toBe(false)
  })
})
