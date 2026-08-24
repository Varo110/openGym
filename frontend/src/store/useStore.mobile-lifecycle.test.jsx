// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mobile = vi.hoisted(() => ({
  nativeLoad: vi.fn(),
  nativeSave: vi.fn(() => Promise.resolve()),
  syncReminder: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: true,
  nativeLoad: mobile.nativeLoad,
  nativeSave: mobile.nativeSave,
  syncReminder: mobile.syncReminder,
}))

import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mobile.nativeLoad.mockReset()
  mobile.nativeSave.mockClear()
  mobile.syncReminder.mockClear()
  const S = clone(DEF)
  S.active = {
    id: 'active-1', start: 1787150000000, cur: 0, name: 'Mobile workout',
    entries: [{ id: 'lift', sets: [{ w: 70, r: 7, done: false, amrapRole: 'progression' }] }],
  }
  useStore.setState({ S, user: null, ready: true })
})

describe('mobile active-workout durability', () => {
  it('starts the native write immediately for progress and explicit clearing', async () => {
    let finishFirstWrite
    mobile.nativeSave
      .mockImplementationOnce(() => new Promise(resolve => { finishFirstWrite = resolve }))
      .mockResolvedValueOnce()

    useStore.getState().update(state => {
      state.active.entries[0].sets[0].r = 9
    })
    await Promise.resolve()

    expect(mobile.nativeSave).toHaveBeenCalledTimes(1)
    expect(mobile.nativeSave.mock.calls[0][0].active.entries[0].sets[0].r).toBe(9)
    expect(mobile.syncReminder).toHaveBeenCalledWith(expect.objectContaining({ active: expect.any(Object) }))

    useStore.getState().update(state => { state.active = null })
    await Promise.resolve()

    expect(mobile.nativeSave).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    finishFirstWrite()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(mobile.nativeSave).toHaveBeenCalledTimes(2)
    expect(mobile.nativeSave.mock.calls[1][0].active).toBeNull()
    expect(mobile.syncReminder).toHaveBeenLastCalledWith(expect.objectContaining({ active: null }))
  })

  it.each([
    {
      name: 'newer local active-only workout',
      localActive: { id: 'local-active', entries: [] }, localTs: 200,
      savedActive: null, savedTs: 100,
      expected: { id: 'local-active' },
    },
    {
      name: 'newer local clear tombstone',
      localActive: null, localTs: 200,
      savedActive: { id: 'stale-saved', entries: [] }, savedTs: 100,
      expected: null,
    },
    {
      name: 'equal-timestamp local clear tombstone',
      localActive: null, localTs: 200,
      savedActive: { id: 'equal-saved', entries: [] }, savedTs: 200,
      expected: null,
    },
  ])('prefers the $name over the native mirror', async ({ localActive, localTs, savedActive, savedTs, expected }) => {
    const local = { ...clone(DEF), _ts: localTs, active: localActive }
    const saved = { ...clone(DEF), _ts: savedTs, active: savedActive }
    localStorage.setItem('gym_state_v1', JSON.stringify(local))
    useStore.setState({ S: local, ready: false })
    mobile.nativeLoad.mockResolvedValueOnce(saved)

    await useStore.getState().boot()

    if (expected) expect(useStore.getState().S.active).toMatchObject(expected)
    else expect(useStore.getState().S.active).toBeNull()
  })

  it.each([
    { name: 'newer native mirror', local: JSON.stringify({ ...clone(DEF), _ts: 100, active: null }) },
    { name: 'missing local record', local: null },
    { name: 'malformed local record', local: '{not-json' },
  ])('restores an active workout from the $name', async ({ local }) => {
    const saved = { ...clone(DEF), _ts: 200, active: { id: 'saved-active', entries: [] } }
    if (local !== null) localStorage.setItem('gym_state_v1', local)
    else localStorage.removeItem('gym_state_v1')
    useStore.setState({ S: clone(DEF), ready: false })
    mobile.nativeLoad.mockResolvedValueOnce(saved)

    await useStore.getState().boot()

    expect(useStore.getState().S.active).toMatchObject({ id: 'saved-active' })
  })
})