// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { removeActiveExercise } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { partialExitBaseline } from '../lib/partial.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, sg) => ({
  id,
  ...(sg ? { sg } : {}),
  target: { sets: 1, reps: 1 },
  sets: [{ w: 0, r: 1, done: false }]
})

let root
let container

function setActive(entries, cur = 0, activeFields = {}) {
  const S = clone(DEF)
  S.active = {
    id: 'remove-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Remove test', bw: null, cur, entries, ...activeFields
  }
  useStore.setState({ S, user: null })
}

function renderWorkout(entries, activeFields = {}) {
  setActive(entries, 0, activeFields)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

function removeButton() {
  // The set-row "Remove exercise" label (single-set exercises) must not be picked up:
  // the guarded control is the footer button, which is the last match in the DOM.
  const all = [...container.querySelectorAll('button')].filter(button => button.textContent.includes('Remove exercise'))
  return all[all.length - 1]
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('active-session exercise removal', () => {
  it('records a Programme work-row tombstone when the set remove control is used', () => {
    const entries = [
      { ...entry('1001'), sets: [
        { phase: 'work', w: 0, r: 1, done: false },
        { phase: 'work', w: 0, r: 1, done: false }
      ] },
      { ...entry('1002'), sets: [
        { phase: 'work', w: 0, r: 1, done: false },
        { phase: 'work', w: 0, r: 1, done: false }
      ] }
    ]
    const baseline = partialExitBaseline(entries)
    renderWorkout(entries, { sessionType: 'programme', partialExitBaseline: baseline })

    const removeSet = [...container.querySelectorAll('button')]
      .find(button => button.textContent.trim() === 'Remove set')
    expect(removeSet).toBeTruthy()
    act(() => removeSet.dispatchEvent(new Event('click', { bubbles: true })))

    const active = useStore.getState().S.active
    expect(active.entries[0].sets).toHaveLength(1)
    expect(active.partialExitBaseline).toMatchObject({ prescribedWorkSets: 3 })
    expect(active.partialExitBaseline.removedWorkRowIds).toHaveLength(1)
  })

  it('disables removal for the whole duration of a timed hold', async () => {
    renderWorkout([entry('1001')])
    expect(removeButton()).toBeTruthy()
    expect(removeButton().disabled).toBe(false)

    window.__wkDebug = true
    act(() => useUI.getState().startWork(30, 'Hold', vi.fn()))
    expect(removeButton().disabled).toBe(true)
  })

  it('cancels a pending timed callback before indexes shift and cleans a one-member group', () => {
    setActive([entry('1001', 'sg-1'), entry('1002', 'sg-1'), entry('1003')], 1)
    expect(useStore.getState().S.active.cur).toBe(1)
    const wrongWrite = vi.fn(elapsed => {
      useStore.getState().update(s => { s.active.entries[0].sets[0].sec = elapsed })
    })
    useUI.getState().startWork(5, 'Hold', wrongWrite)

    removeActiveExercise(0)
    vi.advanceTimersByTime(10_000)

    const active = useStore.getState().S.active
    expect(useUI.getState().work).toBeNull()
    expect(wrongWrite).not.toHaveBeenCalled()
    expect(active.entries.map(e => e.id)).toEqual(['1002', '1003'])
    expect(active.cur).toBe(0)
    expect(active.entries[0].sg).toBeFalsy()
    expect(active.entries[0].sets[0].sec).toBeFalsy()
  })

  it('hides the remove control for an empty freestyle session', () => {
    renderWorkout([])
    expect(removeButton()).toBeUndefined()
  })
})

describe('remove-exercise locale coverage', () => {
  const required = [
    'Remove {0}?',
    'The sets you logged for this exercise in this session will be lost.',
    'This removes the exercise from your current session.',
    'Remove',
    'Which exercise in this superset do you want to remove?'
  ]
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })

  it('defines every new prompt in all eleven locale packs', () => {
    expect(Object.keys(packs)).toHaveLength(11)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty(key))
    })
  })
})
