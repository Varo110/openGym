// @vitest-environment happy-dom
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { activeGroupMetaSheet, activeWorkoutEditSheet, exConfigSheet, groupMetaSheet } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const clone = value => JSON.parse(JSON.stringify(value))
const BUILTIN = EXDB.find(exercise => exercise.bp !== 'cardio')
const cssSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8')
let host
let root

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function configText(state, exercise) {
  useStore.setState({ S: state, user: null, ready: true })
  exConfigSheet(exercise, { id: exercise.id, sets: 3, reps: 5, weight: 0 }, vi.fn())
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(() => {})))
  return host.textContent
}

function changeTextInput(element, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(element.ownerDocument.defaultView.HTMLInputElement.prototype, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function changeTextArea(element, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(element.ownerDocument.defaultView.HTMLTextAreaElement.prototype, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  host = null
  root = null
  useUI.getState().closeAll()
  useStore.setState({ S: clone(DEF), user: null, ready: true })
})

describe('routine exercise configuration personal cues', () => {
  it('renders canonical annotations for built-in and edited custom exercises', () => {
    const builtInState = clone(DEF)
    builtInState.exerciseAnnotations = { [BUILTIN.id]: { cues: 'Canonical built-in cue' } }
    expect(configText(builtInState, BUILTIN)).toContain('Canonical built-in cue')

    const custom = { id: 'custom-cue', n: 'Custom cue', bp: 'back', eq: 'custom', cues: 'Legacy cue that is stale' }
    const customState = clone(DEF)
    customState.customEx = [custom]
    customState.exerciseAnnotations = { [custom.id]: { cues: 'Edited canonical custom cue' } }
    const markup = configText(customState, custom)
    expect(markup).toContain('Edited canonical custom cue')
    expect(markup).not.toContain('Legacy cue that is stale')
  })

  it('persists a group cue edit for a linked RoutineEdit group', () => {
    const state = clone(DEF)
    state.routines = [{
      id: 'grouped-routine', name: 'Grouped routine',
      ex: [{ id: BUILTIN.id, sg: 'pair' }, { id: BUILTIN.id, sg: 'pair' }],
      groupMeta: { pair: { kind: 'superset', cues: 'Old cue' } }
    }]
    useStore.setState({ S: state, user: null, ready: true })
    groupMetaSheet('grouped-routine', 'pair')
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))

    changeTextInput(host.querySelector('input[aria-label="Group label"]'), 'Clean + press')
    changeTextArea(host.querySelector('textarea[aria-label="Group cues"]'), 'Do not rack between movements.')
    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Save').click())

    expect(useStore.getState().S.routines[0].groupMeta).toEqual({
      pair: { kind: 'superset', label: 'Clean + press', cues: 'Do not rack between movements.' }
    })
  })

  it('edits active group metadata only until an explicit routine save callback succeeds', () => {
    const state = clone(DEF)
    state.active = {
      id: 'active', routineId: 'grouped-routine',
      entries: [{ id: BUILTIN.id, sg: 'pair', sets: [] }, { id: BUILTIN.id, sg: 'pair', sets: [] }],
      groupMeta: { pair: { kind: 'superset', cues: 'Old cue' } },
    }
    const saveToRoutine = vi.fn(() => true)
    useStore.setState({ S: state, user: null, ready: true })
    activeGroupMetaSheet('pair', { onSaveToRoutine: saveToRoutine })
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))

    changeTextInput(host.querySelector('input[aria-label="Group label"]'), 'Clean + press')
    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Save').click())
    expect(useStore.getState().S.active.groupMeta).toEqual({ pair: { kind: 'superset', label: 'Clean + press', cues: 'Old cue' } })
    expect(saveToRoutine).not.toHaveBeenCalled()

    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Save routine').click())
    expect(saveToRoutine).toHaveBeenCalledOnce()
  })

  it('reorders active workout units without changing the selected entry identity', () => {
    const state = clone(DEF)
    const first = { id: BUILTIN.id, occurrenceId: 'first#1', target: { mode: 'reps' }, sets: [] }
    const second = { id: BUILTIN.id, occurrenceId: 'second#1', target: { mode: 'reps' }, sets: [] }
    state.active = { id: 'active', cur: 0, entries: [first, second] }
    useStore.setState({ S: state, user: null, ready: true })
    activeWorkoutEditSheet()
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))

    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Move down').click())
    expect(useStore.getState().S.active.entries.map(entry => entry.occurrenceId)).toEqual(['second#1', 'first#1'])
    expect(useStore.getState().S.active.cur).toBe(1)
  })

  it('makes swap and every group-member reorder action visible at 320px and 375px', () => {
    const state = clone(DEF)
    state.active = {
      id: 'active', cur: 0,
      entries: [
        { id: BUILTIN.id, occurrenceId: 'first#1', sg: 'pair', target: { mode: 'reps' }, sets: [] },
        { id: BUILTIN.id, occurrenceId: 'second#1', sg: 'pair', target: { mode: 'reps' }, sets: [] }
      ]
    }
    useStore.setState({ S: state, user: null, ready: true })
    activeWorkoutEditSheet()
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))

    for (const width of [320, 375]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const swap = [...host.querySelectorAll('button')].find(button => button.textContent.trim() === 'Swap')
      const reorder = [...host.querySelectorAll('button[aria-label^="Move group member"]')]
      expect(swap, `${width}px swap control`).toBeTruthy()
      expect(reorder.map(button => button.textContent.trim()), `${width}px visible member controls`)
        .toEqual(['Move up', 'Move down', 'Move up', 'Move down'])
      expect(reorder.every(button => button.style.position !== 'absolute'), `${width}px no overlay controls`).toBe(true)
    }
    expect(cssSource).toMatch(/\.active-workout-editor-actions\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(cssSource).toMatch(/@media \(max-width:\s*375px\)\s*\{[\s\S]*\.active-workout-editor-member\s*\{/)
  })

  it('offers a last completed active-session setup without copying logged fields', async () => {
    const state = clone(DEF)
    state.active = { id: 'active', cur: 0, entries: [] }
    state.workouts = [{
      d: '2026-08-20', unit: state.unit, entries: [{
        id: BUILTIN.id, unit: state.unit,
        target: { mode: 'reps', sets: 2, reps: 6, weight: 42.5, kind: 'amrap', amrapMinReps: 7, unit: state.unit, notes: 'do not copy' },
        sets: [{ phase: 'work', mode: 'reps', unit: state.unit, w: 42.5, r: 99, done: true, effort: 10, timer: { started: 1 } }]
      }]
    }]
    const onSave = vi.fn()
    useStore.setState({ S: state, user: null, ready: true })
    exConfigSheet(BUILTIN, null, onSave, null, null, undefined, { useLastSetup: true, historyState: state })
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))

    expect(host.textContent).toContain('Using setup from 2026-08-20')
    const reset = [...host.querySelectorAll('button')].find(button => button.textContent.trim() === 'Use exercise defaults')
    expect(reset?.textContent).toBe('Use exercise defaults')
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Add to routine').dispatchEvent(new Event('click', { bubbles: true })) })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'reps', sets: 2, reps: 6, weight: 42.5, kind: 'amrap', amrapMinReps: 7
    }))
    expect(onSave.mock.calls[0][0]).toHaveProperty('notes', undefined)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('effort')
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('timer')
  })

  it('uses exact-compatible global history for a fresh Add without copying another exercise or logged fields', async () => {
    const state = clone(DEF)
    state.active = { id: 'active', cur: 0, entries: [] }
    state.workouts = [
      {
        d: '2026-08-22', unit: 'kg', entries: [{
          id: 'other-exercise', target: { mode: 'reps', sets: 2, reps: 20, weight: 200, unit: 'kg' },
          sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 200, r: 20, done: true }]
        }]
      },
      {
        d: '2026-08-20', unit: 'kg', entries: [{
          id: BUILTIN.id, unit: 'kg',
          target: { mode: 'reps', sets: 2, reps: 6, weight: 42.5, unit: 'kg', kind: 'amrap', amrapMinReps: 7, notes: 'do not copy' },
          sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 42.5, r: 9, done: true, effort: 10, timer: { started: 1 } }]
        }]
      },
      {
        d: '2026-08-21', unit: 'kg', entries: [{
          id: BUILTIN.id, unit: 'kg', target: { mode: 'time', sets: 1, sec: 90, weight: 20, unit: 'kg' },
          sets: [{ phase: 'work', mode: 'time', unit: 'kg', sec: 90, w: 20, done: true }]
        }]
      },
      {
        d: '2026-08-23', unit: 'lb', entries: [{
          id: BUILTIN.id, unit: 'lb', target: { mode: 'reps', sets: 1, reps: 1, weight: 100, unit: 'lb' },
          sets: [{ phase: 'work', mode: 'reps', unit: 'lb', w: 100, r: 1, done: true }]
        }]
      }
    ]
    const onSave = vi.fn()
    useStore.setState({ S: state, user: null, ready: true })
    exConfigSheet(BUILTIN, null, onSave, null, null, undefined, { useLastSetup: true, historyState: state, percentageState: state })
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))

    expect(host.textContent).toContain('Using setup from 2026-08-20')
    expect(host.textContent).toContain('+42.5 × 9')
    expect(host.textContent).not.toContain('2026-08-21')
    expect(host.textContent).not.toContain('2026-08-23')
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Add to routine').dispatchEvent(new Event('click', { bubbles: true })) })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reps', sets: 2, reps: 6, weight: 42.5, kind: 'amrap', amrapMinReps: 7 }))
    expect(onSave.mock.calls[0][0]).toHaveProperty('notes', undefined)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('effort')
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('timer')
  })
})
