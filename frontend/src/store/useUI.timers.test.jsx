// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beep } from '../lib/sound.js'
import RestTimer from '../components/RestTimer.jsx'
import Workout from '../views/Workout.jsx'
import { DEF, useStore } from './useStore.js'
import { useUI } from './useUI.js'
import { finishWorkout } from '../sheets.jsx'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

const NOW = new Date('2026-08-11T20:00:00Z')
const clone = value => JSON.parse(JSON.stringify(value))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
})

afterEach(() => {
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('persistent timer safety', () => {
  it('adds a full 15 seconds from Ready and alerts exactly once for the new deadline', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, done: true })

    useUI.getState().addRest(15)
    const resumed = useUI.getState().timer
    expect(resumed).toMatchObject({ left: 15, done: false })
    expect(resumed.endsAt - Date.now()).toBe(15_000)

    vi.advanceTimersByTime(14_000)
    expect(useUI.getState().timer.done).not.toBe(true)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, done: true })

    const completionBeeps = () => beep.mock.calls.filter(([, frequency]) => frequency === 1320).length
    expect(completionBeeps()).toBe(2) // original expiry, then the one resumed expiry
    vi.advanceTimersByTime(60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(completionBeeps()).toBe(2)
  })

  it('lets a finished work timer be cancelled without logging and caps overtime', () => {
    const logged = vi.fn()
    useUI.getState().startWork(1, 'Plank', logged)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().work.done).toBe(true)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<RestTimer />))
    const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === 'Cancel')
    expect(cancel).toBeTruthy()
    act(() => cancel.click())
    expect(useUI.getState().work).toBeNull()
    expect(logged).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()

    useUI.getState().startWork(1, 'Plank', logged)
    vi.advanceTimersByTime((1 + 15 * 60) * 1000)
    expect(useUI.getState().work).toMatchObject({ done: true, left: -(15 * 60) })
    const capped = useUI.getState().work
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(useUI.getState().work).toEqual(capped)
    expect(logged).not.toHaveBeenCalled()
  })

  it("announces Time's up once without making the ticking overtime region live", () => {
    useUI.getState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<RestTimer />))

    const timer = container.querySelector('#timer')
    const status = timer.querySelector('[role="status"]')
    expect(timer.hasAttribute('role')).toBe(false)
    expect(timer.hasAttribute('aria-live')).toBe(false)
    expect(timer.hasAttribute('aria-atomic')).toBe(false)
    expect(status.classList.contains('sr-only')).toBe(true)
    expect(status.textContent).toBe("Time's up!")
    act(() => vi.advanceTimersByTime(3000))
    expect(status.textContent).toBe("Time's up!")

    act(() => root.unmount())
    container.remove()
  })

  it('clears pending work before finishing a workout', () => {
    const S = clone(DEF)
    S.active = {
      id: 'session-1', d: '2026-08-11', start: Date.now() - 60_000,
      routineId: null, name: 'Timer test', bw: null, cur: 0,
      entries: [{ id: '1001', target: { reps: 1, sets: 1 }, sets: [{ w: 0, r: 1, done: true }] }]
    }
    useStore.setState({ S })
    const logged = vi.fn()
    useUI.getState().startWork(30, 'Hold', logged)

    finishWorkout()

    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })

  it('logs a displaced finished hold at its planned time before starting rest', () => {
    const logged = vi.fn()
    useUI.getState().startWork(1, 'Hold', logged)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().work.done).toBe(true)

    useUI.getState().startRest(15)

    expect(useUI.getState().work).toBeNull()
    expect(useUI.getState().timer).toMatchObject({ left: 15, total: 15 })
    expect(logged).toHaveBeenCalledOnce()
    expect(logged).toHaveBeenCalledWith(1)
  })

  it('silently abandons a still-running hold when another timer displaces it', () => {
    const logged = vi.fn()
    useUI.getState().startWork(30, 'Hold', logged)

    useUI.getState().startRest(15)

    expect(useUI.getState().work).toBeNull()
    expect(useUI.getState().timer).toMatchObject({ left: 15, total: 15 })
    expect(logged).not.toHaveBeenCalled()
  })

  it('logs a displaced finished hold at its planned time before starting another hold', () => {
    const firstLogged = vi.fn()
    const secondLogged = vi.fn()
    useUI.getState().startWork(1, 'First hold', firstLogged)
    vi.advanceTimersByTime(1000)

    useUI.getState().startWork(30, 'Second hold', secondLogged)

    expect(firstLogged).toHaveBeenCalledOnce()
    expect(firstLogged).toHaveBeenCalledWith(1)
    expect(secondLogged).not.toHaveBeenCalled()
    expect(useUI.getState().work).toMatchObject({ left: 30, total: 30, label: 'Second hold' })
  })

  it('keeps the planned hold when checking a normal set starts rest', () => {
    const S = clone(DEF)
    S.prepSec = 0
    S.active = {
      id: 'mixed-session', d: '2026-08-11', start: Date.now(), routineId: null,
      name: 'Mixed timer test', bw: null, cur: 0,
      entries: [
        { id: '3544', sg: 'pair-1', target: { mode: 'time', sec: 1, sets: 1 }, sets: [{ sec: 1, w: 0, done: false }] },
        { id: '1001', sg: 'pair-1', target: { mode: 'reps', reps: 1, sets: 1 }, sets: [{ w: 0, r: 1, done: false }] },
        { id: '1001', target: { mode: 'reps', reps: 1, sets: 1 }, sets: [{ w: 0, r: 1, done: false }] }
      ]
    }
    useStore.setState({ S })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<MemoryRouter initialEntries={['/workout']}><Workout /></MemoryRouter>))
    act(() => container.querySelector('.setgo').click())
    act(() => vi.advanceTimersByTime(1000))
    expect(useUI.getState().work.done).toBe(true)

    const checks = container.querySelectorAll('[role="checkbox"]')
    // A completed timer logs through toggle(); clicking that same row must not re-enter and
    // immediately uncheck it.
    act(() => checks[0].click())
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ sec: 1, done: true })
    expect(useUI.getState().work).toBeNull()

    act(() => checks[1].click())

    const active = useStore.getState().S.active
    expect(active.entries[0].sets[0]).toMatchObject({ sec: 1, done: true })
    expect(active.entries[1].sets[0].done).toBe(true)
    expect(useUI.getState().work).toBeNull()
    expect(useUI.getState().timer).toMatchObject({ left: DEF.restSec, total: DEF.restSec })

    act(() => root.unmount())
    container.remove()
  })

  it('stops work when replacing the active session or replacing all state', () => {
    const S = clone(DEF)
    S.active = { id: 'old-session', entries: [] }
    useStore.setState({ S })
    const oldLogged = vi.fn()
    useUI.getState().startWork(1, 'Old hold', oldLogged)
    vi.advanceTimersByTime(1000)

    const replacement = clone(DEF)
    replacement.active = { id: 'replacement-session', entries: [] }
    useStore.getState().replaceState(replacement)

    expect(useStore.getState().S.active.id).toBe('replacement-session')
    expect(useUI.getState().work).toBeNull()
    expect(oldLogged).not.toHaveBeenCalled()

    const importedLogged = vi.fn()
    useUI.getState().startWork(1, 'Imported hold', importedLogged)
    vi.advanceTimersByTime(1000)
    useStore.getState().replaceState(clone(DEF))
    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(importedLogged).not.toHaveBeenCalled()
  })

  it('stops work when sign-out clears the local session', async () => {
    const logged = vi.fn()
    useUI.getState().startWork(1, 'Signed-in hold', logged)
    vi.advanceTimersByTime(1000)

    await useStore.getState().signOut()

    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })

  it('stops work when the active workout is discarded', () => {
    const S = clone(DEF)
    S.active = {
      id: 'discarded-session', d: '2026-08-11', start: Date.now(), routineId: null,
      name: 'Discard timer test', bw: null, cur: 0,
      entries: [{ id: '3544', target: { mode: 'time', sec: 30, sets: 1 }, sets: [{ sec: 30, w: 0, done: false }] }]
    }
    useStore.setState({ S })
    const logged = vi.fn()
    useUI.getState().startWork(1, 'Discarded hold', logged)
    vi.advanceTimersByTime(1000)

    const workoutContainer = document.createElement('div')
    document.body.appendChild(workoutContainer)
    const workoutRoot = createRoot(workoutContainer)
    act(() => workoutRoot.render(<MemoryRouter initialEntries={['/workout']}><Workout /></MemoryRouter>))
    act(() => workoutContainer.querySelector('button[aria-label="Discard"]').click())

    const sheet = useUI.getState().sheets.at(-1)
    const dialogContainer = document.createElement('div')
    document.body.appendChild(dialogContainer)
    const dialogRoot = createRoot(dialogContainer)
    const close = () => useUI.getState().closeSheet(sheet.id)
    act(() => dialogRoot.render(sheet.render(close)))
    const confirm = [...dialogContainer.querySelectorAll('button')].find(button => button.textContent === 'Discard')
    act(() => confirm.click())

    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(logged).not.toHaveBeenCalled()

    act(() => dialogRoot.unmount())
    act(() => workoutRoot.unmount())
    dialogContainer.remove()
    workoutContainer.remove()
  })

  it('refuses a timed-set callback after the active session changes', () => {
    const S = clone(DEF)
    S.active = {
      id: 'first-session', d: '2026-08-11', start: Date.now(), routineId: null,
      name: 'First session', bw: null, cur: 0,
      entries: [{ id: '3544', target: { mode: 'time', sec: 1, sets: 1 }, sets: [{ sec: 1, w: 0, done: false }] }]
    }
    useStore.setState({ S })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<MemoryRouter initialEntries={['/workout']}><Workout /></MemoryRouter>))
    act(() => container.querySelector('.setgo').click())

    const replacement = clone(useStore.getState().S)
    replacement.active = {
      id: 'second-session', d: '2026-08-11', start: Date.now(), routineId: null,
      name: 'Second session', bw: null, cur: 0,
      entries: [{ id: '3544', target: { mode: 'time', sec: 99, sets: 1 }, sets: [{ sec: 99, w: 0, done: false }] }]
    }
    act(() => useStore.setState({ S: replacement }))
    act(() => vi.advanceTimersByTime(1000))
    act(() => useUI.getState().logWorkPlanned())

    expect(useStore.getState().S.active.id).toBe('second-session')
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ sec: 99, done: false })

    act(() => root.unmount())
    container.remove()
  })
})
