import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useUI } from './useUI.js'

const listeners = new Map()

globalThis.document = {
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) },
  body: { classList: { toggle() {}, remove() {} } }
}

describe('timer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUI.getState().stopWork()
    useUI.getState().stopRest()
  })

  afterEach(() => {
    useUI.getState().stopWork()
    useUI.getState().stopRest()
    vi.useRealTimers()
  })

  it('runs preparation before work and permits skipping preparation', () => {
    const done = vi.fn()
    useUI.getState().startWork(10, 'Plank', done, 3)

    expect(useUI.getState().prep).toMatchObject({ left: 3, total: 3 })
    expect(useUI.getState().work).toBeNull()

    useUI.getState().skipPrep()
    expect(useUI.getState().prep).toBeNull()
    expect(useUI.getState().work).toMatchObject({ left: 10, total: 10, label: 'Plank' })
    expect(done).not.toHaveBeenCalled()
  })

  it('transitions from preparation to work after the configured countdown', () => {
    useUI.getState().startWork(8, 'Hold', vi.fn(), 2)
    vi.advanceTimersByTime(1900)
    expect(useUI.getState().prep).not.toBeNull()
    expect(useUI.getState().work).toBeNull()

    vi.advanceTimersByTime(500)
    expect(useUI.getState().prep).toBeNull()
    expect(useUI.getState().work).toMatchObject({ left: 8, total: 8 })
  })

  it('cancels both preparation and work without invoking the completion callback', () => {
    const done = vi.fn()
    useUI.getState().startWork(4, 'Hold', done, 2)
    useUI.getState().stopWork()
    vi.advanceTimersByTime(6000)

    expect(useUI.getState().prep).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(done).not.toHaveBeenCalled()
  })

  it('stops preparation/work or rest immediately when an active set is removed', () => {
    const done = vi.fn()
    useUI.getState().startWork(10, 'Hold', done, 3)
    expect(useUI.getState().prep).not.toBeNull()
    useUI.getState().stopTimersForRemoval()
    expect(useUI.getState().prep).toBeNull()
    expect(useUI.getState().work).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(done).not.toHaveBeenCalled()

    useUI.getState().startRest(10)
    useUI.getState().stopTimersForRemoval()
    expect(useUI.getState().timer).toBeNull()
  })

  it('finishes work early once and clears the interval', () => {
    const done = vi.fn()
    useUI.getState().startWork(10, 'Hold', done)
    vi.advanceTimersByTime(2250)
    useUI.getState().finishWorkEarly()
    vi.advanceTimersByTime(10000)

    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0]).toBeGreaterThanOrEqual(1)
    expect(useUI.getState().work).toBeNull()
  })

  it('cancels rest independently', () => {
    useUI.getState().startRest(10)
    expect(useUI.getState().timer).toMatchObject({ left: 10, total: 10 })
    useUI.getState().stopRest()
    vi.advanceTimersByTime(12000)
    expect(useUI.getState().timer).toBeNull()
  })

  it('stops both timer phases and invalidates work callbacks synchronously', () => {
    useUI.getState().startRest(10)
    expect(useUI.getState().timer).not.toBeNull()
    useUI.getState().stopTimers()
    expect(useUI.getState().timer).toBeNull()

    const done = vi.fn()
    useUI.getState().startWork(4, 'Hold', done)
    useUI.getState().stopTimers()
    vi.advanceTimersByTime(5000)
    expect(useUI.getState().work).toBeNull()
    expect(done).not.toHaveBeenCalled()
  })

  it('does not create a timer or push notification for zero rest', () => {
    useUI.getState().startRest(0)
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().timer).toBeNull()
  })
})
