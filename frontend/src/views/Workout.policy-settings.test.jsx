// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import Modals from '../components/Modals.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { normalizeState } from '../lib/state.js'
import { isAmrapProgressionAllowed } from '../lib/workout-runtime.js'
import { bindUI } from '../components/ui.jsx'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
bindUI(useUI)
const clone = value => JSON.parse(JSON.stringify(value))

let root
let container

function greyskullState() {
  const state = clone(DEF)
  state.active = {
    id: 'policy-settings', d: '2026-08-20', start: Date.now(), routineId: 'routine-1',
    name: 'Policy settings', bw: null, cur: 0,
    entries: [{
      id: '1457',
      target: {
        mode: 'reps', kind: 'amrap', sets: 1, reps: 5, amrapMinReps: 5,
        weight: 40, progressionPolicy: 'greyskull'
      },
      plan: { policy: 'greyskull', reason: 'session prescription' },
      sets: [{ phase: 'work', mode: 'reps', kind: 'amrap', w: 40, r: 5, done: false, amrapRole: 'progression' }]
    }]
  }
  return state
}

function buttonWithText(text) {
  return [...container.querySelectorAll('button')].find(button => button.textContent.trim() === text)
}

function rowWithTitle(title) {
  return [...container.querySelectorAll('.lrow')].find(row => row.querySelector('.lrow-t')?.textContent.trim() === title)
}

function stepperWithLabel(label) {
  return [...container.querySelectorAll('.stp-w')].find(stepper => stepper.querySelector('.stp-l')?.textContent.trim() === label)
}

async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => { element.click() })
}

function reloadPersistedEntry() {
  const persisted = JSON.parse(localStorage.getItem('gym_state_v1'))
  act(() => useStore.setState({ S: normalizeState(persisted, DEF) }))
  return useStore.getState().S.active.entries[0]
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, prep: null, work: null })
  useStore.setState({ S: greyskullState(), user: null, ready: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /><Modals /></MemoryRouter>))
})

afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  useUI.getState().closeAll()
})

describe('Work-settings target persistence', () => {
  it('persists AMRAP to fixed through the real sheet, store, and reload without stale AMRAP bounds', async () => {
    const target = useStore.getState().S.active.entries[0].target
    Object.assign(target, {
      targetKind: 'amrap', targetType: 'amrap', type: 'amrap', amrap: true, isAmrap: true,
      amrapMaxSec: 90, maxDurationSec: 90, maxSec: 90, minReps: 4, cap: 120
    })

    await click(container.querySelector('[aria-label="Work settings"]'))
    await click(rowWithTitle('Target'))
    await click(buttonWithText('Fixed target'))
    await click(buttonWithText('Save'))

    const storedTarget = useStore.getState().S.active.entries[0].target
    expect(storedTarget.kind).toBe('fixed')
    for (const alias of [
      'targetKind', 'targetType', 'type', 'amrap', 'isAmrap',
      'amrapMinReps', 'amrapMaxSec', 'maxDurationSec', 'maxSec', 'minReps', 'cap'
    ]) expect(storedTarget).not.toHaveProperty(alias)

    await click(container.querySelector('[aria-label="Work settings"]'))
    expect(rowWithTitle('Target').querySelector('.lrow-v')?.textContent).toContain('Fixed target')
    act(() => useUI.getState().closeAll())

    const reloadedTarget = reloadPersistedEntry().target
    expect(reloadedTarget).toMatchObject({ kind: 'fixed', mode: 'reps' })
    for (const alias of [
      'targetKind', 'targetType', 'type', 'amrap', 'isAmrap',
      'amrapMinReps', 'amrapMaxSec', 'maxDurationSec', 'maxSec', 'minReps', 'cap'
    ]) expect(reloadedTarget).not.toHaveProperty(alias)
  })

  it('persists fixed to reps AMRAP through the real sheet, store, and reload', async () => {
    const state = greyskullState()
    state.active.entries[0].target = {
      ...state.active.entries[0].target,
      kind: 'fixed', targetKind: 'fixed', amrap: false, amrapMaxSec: 90, cap: 120
    }
    delete state.active.entries[0].target.amrapMinReps
    act(() => useStore.setState({ S: state }))

    await click(container.querySelector('[aria-label="Work settings"]'))
    await click(rowWithTitle('Target'))
    await click(buttonWithText('AMRAP'))
    await click(buttonWithText('Save'))

    const storedTarget = useStore.getState().S.active.entries[0].target
    expect(storedTarget).toMatchObject({ kind: 'amrap', mode: 'reps', amrapMinReps: 5 })
    expect(storedTarget).not.toHaveProperty('targetKind')
    expect(storedTarget).not.toHaveProperty('amrap')
    expect(storedTarget).not.toHaveProperty('amrapMaxSec')
    expect(storedTarget).not.toHaveProperty('cap')

    await click(container.querySelector('[aria-label="Work settings"]'))
    expect(rowWithTitle('Target').querySelector('.lrow-v')?.textContent).toContain('AMRAP')
    expect(stepperWithLabel('Minimum reps').querySelector('input').value).toBe('5')
    act(() => useUI.getState().closeAll())

    const reloadedTarget = reloadPersistedEntry().target
    expect(reloadedTarget).toMatchObject({ kind: 'amrap', mode: 'reps', amrapMinReps: 5 })
    expect(reloadedTarget).not.toHaveProperty('amrapMaxSec')
    expect(reloadedTarget).not.toHaveProperty('cap')
  })

  it('persists an edited reps AMRAP minimum through the real sheet, store, and reload', async () => {
    await click(container.querySelector('[aria-label="Work settings"]'))
    await click(stepperWithLabel('Minimum reps').querySelector('[aria-label="Increase"]'))
    await click(buttonWithText('Save'))

    const storedTarget = useStore.getState().S.active.entries[0].target
    expect(storedTarget).toMatchObject({ kind: 'amrap', mode: 'reps', amrapMinReps: 6 })

    await click(container.querySelector('[aria-label="Work settings"]'))
    expect(stepperWithLabel('Minimum reps').querySelector('input').value).toBe('6')
    act(() => useUI.getState().closeAll())

    const reloadedTarget = reloadPersistedEntry().target
    expect(reloadedTarget).toMatchObject({ kind: 'amrap', mode: 'reps', amrapMinReps: 6 })
  })

  it('persists an edited timed AMRAP maximum through the real sheet, store, and reload', async () => {
    const state = greyskullState()
    state.active.entries[0].target = {
      ...state.active.entries[0].target,
      mode: 'time', kind: 'amrap', sec: 45, amrapMaxSec: 60, minReps: 4
    }
    delete state.active.entries[0].target.reps
    state.active.entries[0].sets = [{
      phase: 'work', mode: 'time', kind: 'amrap', w: 40, sec: 45, done: false, amrapRole: 'progression'
    }]
    act(() => useStore.setState({ S: state }))

    await click(container.querySelector('[aria-label="Work settings"]'))
    await click(stepperWithLabel('Maximum duration (optional)').querySelector('[aria-label="Increase"]'))
    await click(buttonWithText('Save'))

    const storedTarget = useStore.getState().S.active.entries[0].target
    expect(storedTarget).toMatchObject({ kind: 'amrap', mode: 'time', amrapMaxSec: 65 })
    expect(storedTarget).not.toHaveProperty('amrapMinReps')
    expect(storedTarget).not.toHaveProperty('minReps')

    await click(container.querySelector('[aria-label="Work settings"]'))
    expect(stepperWithLabel('Maximum duration (optional)').querySelector('input').value).toBe('65')
    act(() => useUI.getState().closeAll())

    const reloadedTarget = reloadPersistedEntry().target
    expect(reloadedTarget).toMatchObject({ kind: 'amrap', mode: 'time', amrapMaxSec: 65 })
    expect(reloadedTarget).not.toHaveProperty('amrapMinReps')
    expect(reloadedTarget).not.toHaveProperty('minReps')
  })
  it('clears an optional timed AMRAP maximum through the real sheet, store, and reload', async () => {
    const state = greyskullState()
    state.active.entries[0].target = {
      ...state.active.entries[0].target,
      mode: 'time', kind: 'amrap', sec: 45,
      amrapMaxSec: 60, maxDurationSec: 60, maxSec: 60, cap: 60
    }
    delete state.active.entries[0].target.reps
    state.active.entries[0].sets = [{
      phase: 'work', mode: 'time', kind: 'amrap', w: 40, sec: 45, done: false, amrapRole: 'progression'
    }]
    act(() => useStore.setState({ S: state }))

    await click(container.querySelector('[aria-label="Work settings"]'))
    const decrease = stepperWithLabel('Maximum duration (optional)').querySelector('[aria-label="Decrease"]')
    for (let i = 0; i < 12; i++) await click(decrease)
    await click(buttonWithText('Save'))

    const storedTarget = useStore.getState().S.active.entries[0].target
    for (const alias of ['amrapMaxSec', 'maxDurationSec', 'maxSec', 'cap']) {
      expect(storedTarget).not.toHaveProperty(alias)
    }

    const reloadedTarget = reloadPersistedEntry().target
    for (const alias of ['amrapMaxSec', 'maxDurationSec', 'maxSec', 'cap']) {
      expect(reloadedTarget).not.toHaveProperty(alias)
    }
  })
})

describe('Work-settings effective progression policy persistence', () => {
  it.each([
    ['Follow routine', null, 'greyskull', 'progression'],
    ['Linear progression', 'Linear progression', 'linear', 'amrap'],
    ['Double progression', 'Double progression', 'double', 'amrap'],
    ['No automatic progression', 'No automatic progression', 'off', 'amrap']
  ])('carries %s through the sheet, store, persistence, and reload', async (_case, choice, expectedPolicy, expectedRole) => {
    await click(container.querySelector('[aria-label="Work settings"]'))

    const rule = rowWithTitle('Rule')
    expect(rule).toBeTruthy()
    if (choice == null) {
      expect(rule.querySelector('.lrow-v')?.textContent).toContain('Follow the routine (Greyskull LP)')
    } else {
      await click(rule)
      await click(buttonWithText(choice))
    }
    await click(buttonWithText('Save'))

    const storedEntry = useStore.getState().S.active.entries[0]
    expect(storedEntry.target.prog).toBe(expectedPolicy)
    expect(storedEntry.target.progressionPolicy).toBe(expectedPolicy)
    expect(storedEntry.plan).toMatchObject({ policy: expectedPolicy, reason: 'session prescription' })
    expect(storedEntry.sets[0].amrapRole).toBe(expectedRole)
    expect(isAmrapProgressionAllowed(storedEntry)).toBe(expectedPolicy === 'greyskull')

    const reloadedEntry = reloadPersistedEntry()
    expect(reloadedEntry.target.prog).toBe(expectedPolicy)
    expect(reloadedEntry.target.progressionPolicy).toBe(expectedPolicy)
    expect(reloadedEntry.plan.policy).toBe(expectedPolicy)
    expect(reloadedEntry.sets[0].amrapRole).toBe(expectedRole)
    expect(isAmrapProgressionAllowed(reloadedEntry)).toBe(expectedPolicy === 'greyskull')
  })
})
