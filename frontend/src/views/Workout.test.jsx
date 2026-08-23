import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { removeActiveExercise } from './Workout.jsx'
import { partialExitBaseline } from '../lib/partial.js'

const cssSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

const mocks = vi.hoisted(() => {
  const state = {
    S: null,
    startRest: vi.fn(),
    stopRest: vi.fn(),
    stopWork: vi.fn(),
    stopTimers: vi.fn(),
    topWeightSheet: vi.fn(),
    workoutCompleteSheet: vi.fn(),
    exercisePicker: vi.fn(),
    exConfigSheet: vi.fn(),
    workConfigSheet: vi.fn(),
    activeGroupMetaSheet: vi.fn(),
    activeWorkoutEditSheet: vi.fn(),
    swapActiveWorkoutExercise: vi.fn(),
    exerciseDetailSheet: vi.fn(),
    programmeExitSheet: vi.fn(),
    saveProgrammeExit: vi.fn(),
  }
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
    update: mut => mut(state.S),
  })
  state.uiSnapshot = () => ({
    work: null,
    startRest: state.startRest,
    stopRest: state.stopRest,
    startWork: vi.fn(),
    toast: vi.fn(),
    stopWork: state.stopWork,
    stopTimers: state.stopTimers,
    workTimer: null,
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(),
  startFreestyleFlow: vi.fn(),
  startSessionSheet: vi.fn(),
  resumeWeeklySession: vi.fn(),
  exercisePicker: mocks.exercisePicker,
  exConfigSheet: mocks.exConfigSheet,
  workConfigSheet: mocks.workConfigSheet,
  activeGroupMetaSheet: mocks.activeGroupMetaSheet,
  activeWorkoutEditSheet: mocks.activeWorkoutEditSheet,
  swapActiveWorkoutExercise: mocks.swapActiveWorkoutExercise,
  exerciseDetailSheet: mocks.exerciseDetailSheet,
  topWeightSheet: mocks.topWeightSheet,
  workoutCompleteSheet: mocks.workoutCompleteSheet,
  finishWorkout: vi.fn(),
  confirmSheet: vi.fn(),
  restSettingsSheet: vi.fn(),
  discardWorkout: vi.fn(),
  programmeExitSheet: mocks.programmeExitSheet,
  saveProgrammeExit: mocks.saveProgrammeExit,
  beginWorkout: vi.fn(),
  bwSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))

let dom
let root
let container

function exercise(id, sets, extra = {}) {
  return {
    id,
    target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
    sets: sets.map(done => ({ w: 60, r: 5, done })),
    ...extra,
  }
}

function workout(entries, cur = 0, overrides = {}) {
  const { active: activeOverrides = {}, ...stateOverrides } = overrides
  return {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full',
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur, entries, ...activeOverrides },
    ...stateOverrides,
  }
}

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(entries, cur = 0, overrides = {}) {
  mocks.S = workout(entries, cur, overrides)
  installDom()
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function rerenderWorkout() {
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function unmount() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
  dom = null
}

async function toggleSet(index) {
  const checkbox = container.querySelectorAll('[role="checkbox"]')[index]
  expect(checkbox).toBeTruthy()
  await act(async () => { checkbox.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

async function addExerciseThroughSheets(ex = { id: 'added-exercise' }, cfg = { mode: 'reps', sets: 1, reps: 5, weight: 0 }) {
  const addButton = [...container.querySelectorAll('button')]
    .find(button => button.textContent.trim() === 'Add exercise')
  expect(addButton).toBeTruthy()
  await act(async () => { addButton.dispatchEvent(new dom.Event('click', { bubbles: true })) })

  const pickerCall = mocks.exercisePicker.mock.calls.at(-1)
  expect(pickerCall?.[0]).toEqual(expect.any(Function))
  await act(async () => { pickerCall[0](ex) })

  const configCall = mocks.exConfigSheet.mock.calls.at(-1)
  expect(configCall?.[0]).toBe(ex)
  expect(configCall?.[1]).toBeNull()
  expect(configCall?.[2]).toEqual(expect.any(Function))
  await act(async () => { configCall[2](cfg) })
}

async function saveWorkSettingsThroughCog(config) {
  const settings = container.querySelector('[aria-label="Work settings"]')
  expect(settings).toBeTruthy()
  await act(async () => { settings.dispatchEvent(new dom.Event('click', { bubbles: true })) })

  const configCall = mocks.workConfigSheet.mock.calls.at(-1)
  expect(configCall?.[2]).toEqual(expect.any(Function))
  await act(async () => { configCall[2](config) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await unmount()
})

describe('Workout active session lifecycle', () => {
  it('passes scoped active history to the real Details action instead of global history', async () => {
    await mount([exercise('lift', [false])], 0, {
      workouts: [{ id: 'global-history', entries: [{ id: 'lift', sets: [{ w: 100, r: 5, done: true }] }] }],
      active: { routineId: null }
    })

    const details = container.querySelector('button[aria-label="Details"]')
    expect(details).toBeTruthy()
    await act(async () => { details.dispatchEvent(new dom.Event('click', { bubbles: true })) })

    const historyState = mocks.exerciseDetailSheet.mock.calls.at(-1)?.[1]?.historyState
    expect(historyState?.workouts).toEqual([])
    expect(historyState?.exWeights).toEqual({})
  })

  it.each(['visibilitychange', 'pagehide', 'pageshow'])(
    'preserves the exact Programme workout snapshot across %s',
    async eventName => {
      await mount([exercise('lift', [], {
        sets: [
          { phase: 'work', mode: 'reps', kind: 'fixed', w: 62.5, r: 5, done: true, effort: 8 },
          { phase: 'work', mode: 'reps', kind: 'amrap', amrap: true, amrapRole: 'progression', w: 62.5, r: 9, done: true },
        ],
      }), exercise('accessory', [], {
        sets: [{ phase: 'work', mode: 'reps', w: 20, r: 0, done: false }],
      })], 1, { active: {
        sessionType: 'programme',
        programmeId: 'programme-1',
        cycleId: 'cycle-1',
        instanceId: 'instance-1',
        date: '2026-08-19',
      },
      workouts: [{ id: 'legitimate-history', end: 1787140000000, entries: [] }],
      dayPlan: { '2026-08-19': { disposition: 'in-progress', programmeId: 'programme-1' } },
      })
      const before = JSON.parse(JSON.stringify(mocks.S))
      mocks.saveProgrammeExit.mockImplementation(() => {
        mocks.S.workouts.push({ id: 'implicit-history', entries: mocks.S.active.entries })
        mocks.S.dayPlan['2026-08-19'].disposition = 'done'
        mocks.S.active = null
      })

      if (eventName === 'visibilitychange') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new dom.Event(eventName))
      } else {
        window.dispatchEvent(new dom.Event(eventName))
      }

      expect(mocks.saveProgrammeExit).not.toHaveBeenCalled()
      expect(mocks.S).toEqual(before)
      expect(mocks.S.workouts).toHaveLength(1)
      expect(mocks.S.dayPlan['2026-08-19'].disposition).toBe('in-progress')
    }
  )

  it('preserves the active workout when the route unmounts and remounts', async () => {
    await mount([exercise('lift', [], {
      sets: [{ phase: 'work', mode: 'reps', w: 62.5, r: 9, done: false, amrapRole: 'progression' }],
    })], 0, { active: { sessionType: 'programme', instanceId: 'instance-1' } })
    const before = JSON.parse(JSON.stringify(mocks.S.active))

    await unmount()
    expect(mocks.S.active).toEqual(before)

    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(mocks.S.active).toEqual(before)
    expect(container.textContent).toContain('Test workout')
  })

  it('shows an early-finished classic plan as Resume on the Start tab', async () => {
    const iso = new Date().toISOString().slice(0, 10)
    const planned = { id: 'settled-plan', name: 'Settled plan', emoji: null, ex: [{ id: 'lift' }] }
    mocks.S = workout([], 0, {
      routines: [planned],
      dayPlan: { [iso]: [planned.id] },
      workouts: [{ d: iso, routineId: planned.id, plannedComplete: false, entries: [] }]
    })
    mocks.S.active = null
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })

    expect(container.textContent).toContain('Resume')
    expect(container.textContent).not.toContain('Start Settled plan')
  })

  it('does not downgrade a completed Start-tab plan after an early-finished Repeat', async () => {
    const iso = new Date().toISOString().slice(0, 10)
    const planned = { id: 'repeated-plan', name: 'Repeated plan', emoji: null, ex: [{ id: 'lift' }] }
    mocks.S = workout([], 0, {
      routines: [planned],
      dayPlan: { [iso]: [planned.id] },
      workouts: [
        { d: iso, routineId: planned.id, plannedComplete: true, entries: [] },
        { d: iso, routineId: planned.id, plannedComplete: false, entries: [] },
      ]
    })
    mocks.S.active = null
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })

    expect(container.textContent).not.toContain('Incomplete')
    expect(container.textContent).not.toContain('Start Repeated plan')
  })

  it('does not offer Start for a converted-classic completion in StartChooser', async () => {
    const iso = new Date().toISOString().slice(0, 10)
    const planned = { id: 'converted-plan', name: 'Converted plan', emoji: null, ex: [{ id: 'lift' }] }
    mocks.S = workout([], 0, {
      routines: [planned],
      dayPlan: { [iso]: [planned.id] },
      workouts: [{
        d: iso, routineId: planned.id, plannedComplete: true, entries: [],
        programmeId: 'converted-programme', classicConversion: true
      }]
    })
    mocks.S.active = null
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })

    expect(container.textContent).not.toContain('Start Converted plan')
    expect(container.textContent).not.toContain('Incomplete')
  })
})

describe('Workout per-set AMRAP controls', () => {
  it.each(['linear', 'double', 'off'])(
    'offers ordinary AMRAP but not progression under %s and demotes a stale driver on interaction',
    async policy => {
      await mount([exercise('press', [], {
        target: { mode: 'reps', kind: 'amrap', reps: 5, weight: 40, prog: policy },
        plan: { policy },
        sets: [{ phase: 'work', mode: 'reps', w: 40, r: 5, done: false, amrapRole: 'progression' }]
      })])

      let control = container.querySelector('.amrap-role-control')
      expect(control.textContent.trim()).toBe('AMRAP')
      expect(control.getAttribute('aria-label')).not.toContain('Progression')
      await act(async () => { control.dispatchEvent(new dom.Event('click', { bubbles: true })) })
      await rerenderWorkout()
      expect(mocks.S.active.entries[0].sets[0].amrapRole).toBe('none')
    }
  )

  it('offers progression for a single Greyskull work set', async () => {
    await mount([exercise('press', [], {
      target: { mode: 'reps', kind: 'amrap', reps: 5, weight: 40, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [{ phase: 'work', mode: 'reps', w: 40, r: 5, done: false, amrapRole: 'amrap' }]
    })])

    const control = container.querySelector('.amrap-role-control')
    expect(control.getAttribute('aria-label')).toContain('★ AMRAP · Progression')
    await act(async () => { control.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerenderWorkout()
    expect(mocks.S.active.entries[0].sets[0].amrapRole).toBe('progression')
  })

  it('shows a localized accessible notice for a single Greyskull progression driver', async () => {
    await mount([exercise('press', [], {
      target: { mode: 'reps', kind: 'amrap', reps: 5, weight: 40, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [{ phase: 'work', mode: 'reps', w: 40, r: 5, done: false, amrapRole: 'progression' }]
    })])

    expect(container.querySelector('[role="note"]')?.textContent)
      .toContain('Greyskull uses the final work set as AMRAP.')
  })

  it('keeps the timed AMRAP control for a Greyskull work set', async () => {
    await mount([exercise('press', [], {
      target: { mode: 'time', kind: 'amrap', sec: 45, weight: 40, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [{ phase: 'work', mode: 'time', w: 40, sec: 45, done: false, amrapRole: 'progression' }]
    })])

    expect(container.querySelector('.setgo')).toBeTruthy()
    expect(container.querySelector('.amrap-role-control')?.getAttribute('aria-label'))
      .toContain('★ AMRAP · Progression')
  })

  it('keeps ordinary set numbers and cycles the exact text-only labels with current and next-state names', async () => {
    await mount([exercise('squat', [], {
      target: { mode: 'reps', kind: 'amrap', reps: 5, weight: 60, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [
        { phase: 'warmup', w: 20, r: 8, done: false },
        { phase: 'work', w: 60, r: 5, done: false, amrapRole: 'none' },
        { phase: 'work', w: 60, r: 5, done: false, amrapRole: 'amrap' },
        { phase: 'work', w: 60, r: 5, done: false, amrapRole: 'progression' }
      ]
    })])

    let controls = [...container.querySelectorAll('.amrap-role-control')]
    expect([...container.querySelectorAll('.setrow.work .n')].map(label => label.textContent.trim()))
      .toEqual(['1', '2', '3'])
    expect(controls.map(control => control.textContent.trim()))
      .toEqual(['+ AMRAP', 'AMRAP', '★ AMRAP · Progression'])
    expect(controls.map(control => control.getAttribute('aria-label'))).toEqual([
      'Set 1: No AMRAP role. Next: AMRAP',
      'Set 2: AMRAP. Next: ★ AMRAP · Progression',
      'Set 3: ★ AMRAP · Progression. Next: No AMRAP role'
    ])
    expect(controls.every(control => control.closest('.setrow') == null)).toBe(true)
    expect(controls.every(control => control.parentElement.classList.contains('amrap-role-row'))).toBe(true)
    expect(container.querySelector('.setrow.warmup .amrap-role-control')).toBeNull()

    await act(async () => { controls[0].dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerenderWorkout()
    expect(mocks.S.active.entries[0].sets.map(set => set.amrapRole ?? null))
      .toEqual([null, 'amrap', 'amrap', 'progression'])

    controls = [...container.querySelectorAll('.amrap-role-control')]
    await act(async () => { controls[0].dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerenderWorkout()
    expect(mocks.S.active.entries[0].sets.map(set => set.amrapRole ?? null))
      .toEqual([null, 'progression', 'amrap', 'amrap'])

    controls = [...container.querySelectorAll('.amrap-role-control')]
    await act(async () => { controls[0].dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerenderWorkout()
    expect(mocks.S.active.entries[0].sets.map(set => set.amrapRole ?? null))
      .toEqual([null, 'none', 'amrap', 'amrap'])
  })

  it('excludes cardio rows from AMRAP controls even when malformed persisted roles are present', async () => {
    await mount([exercise('run', [], {
      target: { mode: 'cardio', min: 20, speed: 9 },
      sets: [{ phase: 'work', mode: 'cardio', min: 20, speed: 9, done: false, amrapRole: 'progression' }]
    })])

    expect(container.querySelector('.setrow.work .n')?.textContent.trim()).toBe('1')
    expect(container.querySelector('.amrap-role-control')).toBeNull()
    expect(mocks.S.active.entries[0].sets[0].amrapRole).toBe('progression')
  })

  it('keeps native keyboard semantics and the same pointer and keyboard click cycle', async () => {
    await mount([exercise('press', [], {
      target: { mode: 'reps', reps: 5, weight: 40, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [{ phase: 'work', w: 40, r: 5, done: false, amrapRole: 'none' }]
    })])

    let control = container.querySelector('.amrap-role-control')
    expect(control.tagName).toBe('BUTTON')
    expect(control.getAttribute('type')).toBe('button')
    expect(control.getAttribute('tabindex')).toBeNull()
    expect(control.getAttribute('aria-label')).toBe('Set 1: No AMRAP role. Next: AMRAP')

    const pointerClick = new dom.Event('click', { bubbles: true })
    Object.defineProperty(pointerClick, 'detail', { value: 1 })
    await act(async () => { control.dispatchEvent(pointerClick) })
    await rerenderWorkout()
    expect(mocks.S.active.entries[0].sets.map(set => set.amrapRole)).toEqual(['amrap'])

    control = container.querySelector('.amrap-role-control')
    const keyboardClick = new dom.Event('click', { bubbles: true })
    Object.defineProperty(keyboardClick, 'detail', { value: 0 })
    await act(async () => { control.dispatchEvent(keyboardClick) })
    await rerenderWorkout()
    expect(mocks.S.active.entries[0].sets.map(set => set.amrapRole)).toEqual(['progression'])
  })

  it('keeps text-only styling on a compact in-flow control that cannot cover set inputs', () => {
    const controlRule = cssSource.match(/\.amrap-role-control\s*\{([^}]*)\}/s)?.[1] ?? ''

    expect(controlRule).toMatch(/min-width:\s*44px/)
    expect(controlRule).toMatch(/height:\s*20px/)
    expect(controlRule).toMatch(/line-height:\s*16px/)
    expect(controlRule).toMatch(/min-height:\s*20px/)
    expect(controlRule).toMatch(/margin:\s*0 0 1px 32px/)
    expect(controlRule).toMatch(/white-space:\s*nowrap/)
    expect(controlRule).toMatch(/display:\s*flex[^}]*align-items:\s*center/s)
    expect(controlRule).not.toMatch(/position:\s*(?:absolute|fixed)/)
    expect(cssSource).not.toMatch(/\.amrap-role-control::before\s*\{/s)
    expect(cssSource).toMatch(/\.amrap-role-control\s*\{[^}]*background:\s*transparent[^}]*border:\s*0[^}]*box-shadow:\s*none/s)
    expect(cssSource).toMatch(/\.amrap-role-control\.role-amrap\s*,\s*\.amrap-role-control\.role-progression\s*\{[^}]*color:\s*var\(--acc\)/s)
    expect(cssSource).not.toMatch(/\.amrap-role-control:active\s*\{[^}]*background/s)
    expect(cssSource).toMatch(/\.sethead \.n-sp\s*\{\s*width:\s*24px/s)
  })
})

describe('Workout superset set-row scrolling', () => {
  it('exposes a semantic group heading and visible cog that opens active-only group settings', async () => {
    await mount([
      exercise('clean', [false], { sg: 'pair', occurrenceId: 'clean#1' }),
      exercise('press', [false], { sg: 'pair', occurrenceId: 'press#1' }),
    ], 0, { active: {
      routineId: 'routine-1',
      routineEntryMap: [{ occurrenceId: 'clean#1', routineIndex: 0, id: 'clean' }, { occurrenceId: 'press#1', routineIndex: 1, id: 'press' }],
      groupMeta: { pair: { kind: 'complex', label: 'Clean + press', cues: 'Stay tight.' } }
    }, routines: [{ id: 'routine-1', ex: [{ id: 'clean', sg: 'pair' }, { id: 'press', sg: 'pair' }] }] })

    const heading = container.querySelector('button.ss-heading-button')
    const cog = container.querySelector('button[aria-label="Edit group"]')
    expect(heading?.textContent).toContain('Clean + press')
    expect(cog?.querySelector('svg')).toBeTruthy()
    await act(async () => { cog.dispatchEvent(new dom.Event('click', { bubbles: true })) })

    expect(mocks.activeGroupMetaSheet).toHaveBeenCalledWith('pair', expect.objectContaining({ onSaveToRoutine: expect.any(Function) }))
  })

  it('centers the newly active partner first incomplete set after set-flow advances', async () => {
    const group = 'scroll-partner'
    await mount([
      exercise('superset-a', [false, false], { sg: group }),
      exercise('superset-b', [true, false, false], { sg: group }),
    ])
    const partner = container.querySelector('[data-exidx="1"]')
    const rows = partner.querySelectorAll('.setrow')
    const firstIncompleteScroll = vi.fn()
    const wrapperScroll = vi.fn()
    rows[1].scrollIntoView = firstIncompleteScroll
    partner.scrollIntoView = wrapperScroll

    await toggleSet(0)
    await rerenderWorkout()

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.startRest).not.toHaveBeenCalled()
    expect(firstIncompleteScroll).toHaveBeenCalledOnce()
    expect(firstIncompleteScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    expect(wrapperScroll).not.toHaveBeenCalled()
  })

  it('centers the last set row when navigation selects a completed superset entry', async () => {
    const group = 'scroll-complete'
    await mount([
      exercise('superset-a', [false], { sg: group }),
      exercise('superset-b', [true, true, true], { sg: group, asked: true }),
    ])
    const partner = container.querySelector('[data-exidx="1"]')
    const rows = partner.querySelectorAll('.setrow')
    const lastSetScroll = vi.fn()
    const wrapperScroll = vi.fn()
    rows[2].scrollIntoView = lastSetScroll
    partner.scrollIntoView = wrapperScroll

    mocks.S.active.cur = 1
    await rerenderWorkout()

    expect(lastSetScroll).toHaveBeenCalledOnce()
    expect(lastSetScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    expect(wrapperScroll).not.toHaveBeenCalled()
  })

  it('centers the exercise wrapper when the active superset entry has no set row', async () => {
    const group = 'scroll-wrapper'
    await mount([
      exercise('superset-a', [false], { sg: group }),
      exercise('superset-b', [], { sg: group }),
    ])
    const partner = container.querySelector('[data-exidx="1"]')
    const wrapperScroll = vi.fn()
    partner.scrollIntoView = wrapperScroll

    mocks.S.active.cur = 1
    await rerenderWorkout()

    expect(partner.querySelector('.setrow')).toBeNull()
    expect(wrapperScroll).toHaveBeenCalledOnce()
    expect(wrapperScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  })

  it('does not auto-scroll set rows or wrappers during ordinary workout navigation', async () => {
    await mount([
      exercise('ordinary-a', [false]),
      exercise('ordinary-b', [false, false]),
    ])
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    mocks.S.active.cur = 1
    await rerenderWorkout()

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('cleans an unmounted set-row ref before falling back to the exercise wrapper', async () => {
    const group = 'scroll-cleanup'
    await mount([
      exercise('superset-a', [false], { sg: group }),
      exercise('superset-b', [false], { sg: group }),
    ])
    const partner = container.querySelector('[data-exidx="1"]')
    const staleRow = partner.querySelector('.setrow')
    const staleRowScroll = vi.fn()
    const wrapperScroll = vi.fn()
    staleRow.scrollIntoView = staleRowScroll
    partner.scrollIntoView = wrapperScroll

    mocks.S.active.entries[1].sets = []
    await rerenderWorkout()
    mocks.S.active.cur = 1
    await rerenderWorkout()

    expect(staleRowScroll).not.toHaveBeenCalled()
    expect(wrapperScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  })
})

describe('Workout set completion flow', () => {
  it('shows workout completion when an incomplete final exercise shifts into a completed index', async () => {
    await mount([
      exercise('completed-first', [true], { asked: true }),
      exercise('incomplete-final', [false], { asked: true }),
    ], 1)

    await act(async () => {
      removeActiveExercise(0)
      root.render(React.createElement(Workout))
    })
    await toggleSet(0)

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['incomplete-final'])
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
  })

  it('restarts configured rest after an ordinary set is unchecked and checked again without replaying high-water side effects', async () => {
    await mount([exercise('plain-bench', [false, false, false], {
      target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 120 },
    })])

    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(120)
    expect(mocks.stopTimers).toHaveBeenCalledOnce()
    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(0)

    await toggleSet(0)

    expect(mocks.stopTimers).toHaveBeenCalledTimes(2)
    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.S.active.entries[0].sets[0].done).toBe(false)
    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(0)

    await toggleSet(0)

    expect(mocks.stopTimers).toHaveBeenCalledTimes(3)
    expect(mocks.startRest).toHaveBeenCalledTimes(2)
    expect(mocks.startRest).toHaveBeenLastCalledWith(120)
    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(0)
  })

  it('starts rest after a non-final ordinary set, but stops rest without restarting it on the final set', async () => {
    await mount([exercise('plain-bench', [false, false, false])])
    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(90)
    expect(mocks.stopRest).not.toHaveBeenCalled()

    await unmount()
    vi.clearAllMocks()
    await mount([exercise('plain-singleton', [false], { asked: true })])
    await toggleSet(0)

    expect(mocks.stopRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()

    await toggleSet(0)
    await toggleSet(0)

    expect(mocks.stopRest).toHaveBeenCalledTimes(2)
    expect(mocks.startRest).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledTimes(2)
  })

  it('starts configured rest after a completed non-final singleton exercise', async () => {
    await mount([
      exercise('first-singleton', [false], {
        asked: true,
        target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 120 },
      }),
      exercise('next-singleton', [false], { asked: true }),
    ])

    await toggleSet(0)

    expect(mocks.stopRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(120)
  })

  it('does not start inter-exercise rest while the next singleton has an unfinished warm-up', async () => {
    await mount([
      exercise('first-singleton', [false], {
        asked: true,
        target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 120 },
      }),
      exercise('next-with-warmup', [], {
        asked: true,
        sets: [
          { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: false },
        ],
      }),
    ])

    await toggleSet(0)

    expect(mocks.stopRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('keeps a zero inter-exercise rest override at zero', async () => {
    await mount([
      exercise('first-singleton', [false], {
        asked: true,
        target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 0 },
      }),
      exercise('next-singleton', [false], { asked: true }),
    ])

    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(0)
  })

  it('restarts rest after a superset round-ending recheck without re-advancing the active exercise', async () => {
    const group = 'superset-round'
    await mount([
      exercise('superset-a', [true, false], { sg: group, asked: true }),
      exercise('superset-b', [true, false], {
        sg: group,
        asked: true,
        target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 110 },
      }),
    ], 1)

    await toggleSet(3)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(110)
    expect(mocks.S.active.cur).toBe(0)

    await toggleSet(3)
    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.S.active.entries[1].sets[1].done).toBe(false)
    expect(mocks.S.active.cur).toBe(0)

    await toggleSet(3)

    expect(mocks.startRest).toHaveBeenCalledTimes(2)
    expect(mocks.startRest).toHaveBeenLastCalledWith(110)
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
  })

  it('serializes and resumes a four-component technical complex with rest only between rounds', async () => {
    const group = 'fhof:a:snatch-complex'
    const components = ['snatch-grip-rdl', 'snatch-high-pull', 'muscle-snatch', 'overhead-squat']
      .map(id => exercise(id, [false, false], {
        sg: group,
        asked: true,
        target: { mode: 'reps', reps: 3, weight: 20, workRestSec: 60 },
      }))
    await mount(components)

    expect(mocks.S.active.entries.map(entry => entry.sg)).toEqual([group, group, group, group])
    for (const checkbox of [0, 2, 4]) await toggleSet(checkbox)
    expect(mocks.startRest).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(3)

    await toggleSet(6)
    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(60)
    expect(mocks.S.active.cur).toBe(0)
    const resumed = JSON.parse(JSON.stringify(mocks.S.active))
    expect(resumed.entries.map(entry => entry.sets.map(set => set.done))).toEqual([
      [true, false], [true, false], [true, false], [true, false],
    ])

    await unmount()
    vi.clearAllMocks()
    await mount(resumed.entries, resumed.cur)
    for (const checkbox of [1, 3, 5]) await toggleSet(checkbox)
    expect(mocks.startRest).not.toHaveBeenCalled()
    await toggleSet(7)
    expect(mocks.startRest).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
  })

  it('leaves a completed superset selected while its top-weight sheet owns the advance choice', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [true, true, true], { sg: group, asked: true }),
      exercise('superset-b', [true, true, false], { sg: group, target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 120 } }),
      exercise('next-exercise', [false, false, false]),
    ], 1)
    await toggleSet(5)

    expect(mocks.topWeightSheet).toHaveBeenCalledWith(1)
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(120)

    await toggleSet(5)
    await toggleSet(5)

    expect(mocks.topWeightSheet).toHaveBeenCalledOnce()
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.startRest).toHaveBeenCalledTimes(2)
    expect(mocks.startRest).toHaveBeenLastCalledWith(120)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('uses the routine work-rest override for a normal exercise', async () => {
    await mount([exercise('plain-bench', [false, false, false])], 0, {
      active: { routineId: 'routine-1' },
      routines: [{ id: 'routine-1', workRestSec: 120, ex: [] }],
    })

    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledWith(120)
  })

  it('uses warm-up rest for a completed warm-up row', async () => {
    await mount([exercise('plain-bench', [false, false], {
      target: { mode: 'reps', reps: 5, weight: 60, warmupRestSec: 40, workRestSec: 120 },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false },
      ],
    })])

    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledWith(40)
  })

  it('uses a set-specific rest override before exercise and routine settings', async () => {
    await mount([exercise('plain-bench', [false, false], {
      target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 120 },
      sets: [
        { phase: 'work', mode: 'reps', w: 60, r: 5, restSec: 15, done: false },
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false },
      ],
    })])

    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledWith(15)
  })

  it('uses the triggering superset member rest when a round ends before the unit is complete', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [true, false], { sg: group, target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 45 } }),
      exercise('superset-b', [false, false], { sg: group, target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 110 } }),
    ], 1)

    await toggleSet(2)

    expect(mocks.startRest).toHaveBeenCalledWith(110)
  })

  it('advances to the next superset unit and keeps the triggering member rest', async () => {
    const firstGroup = 'superset-first'
    const nextGroup = 'superset-next'
    await mount([
      exercise('first-a', [true, true], { sg: firstGroup, asked: true }),
      exercise('first-b', [true, false], { sg: firstGroup, asked: true, target: { mode: 'reps', reps: 5, weight: 60, workRestSec: 80 } }),
      exercise('next-a', [false, false], { sg: nextGroup }),
      exercise('next-b', [false, false], { sg: nextGroup }),
    ], 1)

    await toggleSet(3)

    expect(mocks.S.active.cur).toBe(2)
    expect(mocks.startRest).toHaveBeenCalledWith(80)
  })
})

describe('Workout add exercise flow', () => {
  it('offers direct current-exercise move and swap controls without an editor detour', async () => {
    await mount([exercise('first', [false]), exercise('second', [false])], 1)
    const moveUp = container.querySelector('button[aria-label="Move up"]')
    const moveDown = container.querySelector('button[aria-label="Move down"]')
    const swap = container.querySelector('button[aria-label="Swap exercise"]')
    expect(container.querySelector('.hdr button[aria-label="Edit workout"]')).toBeNull()
    expect([moveUp?.textContent, moveDown?.textContent, swap?.textContent]).toEqual(['Move up', 'Move down', 'Swap exercise'])

    await act(async () => { moveUp.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['second', 'first'])
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.stopTimers).toHaveBeenCalledOnce()

    await rerenderWorkout()
    await act(async () => { container.querySelector('button[aria-label="Swap exercise"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.swapActiveWorkoutExercise).toHaveBeenCalledWith(0)
  })

  it.each([
    ['reps', { mode: 'reps', reps: 5, kind: 'amrap', amrapMinReps: 1 }, { phase: 'work', mode: 'reps', w: 60, r: 5, done: false }, 'amrapMinReps', 2],
    ['time', { mode: 'time', sec: 5, kind: 'amrap' }, { phase: 'work', mode: 'time', sec: 5, done: false }, 'sec', 6],
  ])('adjusts the active %s AMRAP target with a positive lower bound only', async (_mode, target, set, field, expected) => {
    await mount([exercise('amrap', [], { target, sets: [set], plan: { policy: 'greyskull' } })])
    const decrease = container.querySelector('button[aria-label="Decrease AMRAP target"]')
    const increase = container.querySelector('button[aria-label="Increase AMRAP target"]')
    expect(decrease).toBeTruthy()
    expect(increase).toBeTruthy()

    await act(async () => { decrease.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.active.entries[0].sets[0].amrapTarget).toBe(1)
    await act(async () => { increase.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.active.entries[0].sets[0].amrapTarget).toBe(expected)
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject(set)
    expect(mocks.S.active.entries[0].plan).toEqual({ policy: 'greyskull' })
  })

  it('renders independent target steppers beside each selected AMRAP row', async () => {
    await mount([exercise('weighted-amrap', [], {
      target: { mode: 'reps', kind: 'amrap', reps: 5, amrapMinReps: 5, weight: 20, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: false, amrapRole: 'amrap', amrapTarget: 12 },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false, amrapRole: 'progression', amrapTarget: 5 }
      ]
    })])

    expect(container.querySelector('.amrap-target-controls')).toBeNull()
    const rows = [...container.querySelectorAll('.amrap-target-inline')]
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.querySelector('.amrap-target-value')?.textContent.trim())).toEqual(['12 reps', '5 reps'])
    expect(rows.every(row => row.querySelector('button[aria-label="Decrease AMRAP target"]'))).toBe(true)
    expect(rows.every(row => row.querySelector('button[aria-label="Increase AMRAP target"]'))).toBe(true)

    await act(async () => {
      rows[0].querySelector('button[aria-label="Increase AMRAP target"]').dispatchEvent(new dom.Event('click', { bubbles: true }))
    })
    expect(mocks.S.active.entries[0].sets.map(set => [set.r, set.amrapTarget]))
      .toEqual([[12, 13], [5, 5]])
  })

  it('preserves distinct row-owned AMRAP targets through the real Work-settings callback', async () => {
    await mount([exercise('weighted-amrap', [], {
      target: { mode: 'reps', kind: 'amrap', reps: 5, amrapMinReps: 5, weight: 100, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: false, amrapRole: 'amrap', amrapTarget: 12 },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false, amrapRole: 'progression', amrapTarget: 5 }
      ]
    })])

    await saveWorkSettingsThroughCog({ mode: 'reps', kind: 'amrap', sets: 2, amrapMinReps: 6, reps: 6, weight: 100 })

    expect(mocks.S.active.entries[0].sets.map(set => [set.r, set.amrapTarget]))
      .toEqual([[6, 12], [6, 5]])
  })

  it('never exposes or persists AMRAP Save routine for a legacy Programme active session', async () => {
    await mount([exercise('legacy-amrap', [], {
      occurrenceId: 'legacy-amrap#1',
      target: { mode: 'reps', reps: 5, kind: 'amrap', amrapMinReps: 5, weight: 60 },
      sets: [{ phase: 'work', mode: 'reps', w: 60, r: 5, done: false }]
    })], 0, {
      active: {
        cycleId: 'legacy-cycle', routineId: 'routine-1',
        routineEntryMap: [{ occurrenceId: 'legacy-amrap#1', routineIndex: 0, id: 'legacy-amrap' }]
      },
      routines: [{ id: 'routine-1', ex: [{ id: 'legacy-amrap', mode: 'reps', kind: 'amrap', amrapMinReps: 5 }] }]
    })

    expect(container.querySelector('button[aria-label="Decrease AMRAP target"]')).toBeTruthy()
    expect([...container.querySelectorAll('button')].some(button => button.textContent.trim() === 'Save routine')).toBe(false)
    await act(async () => { container.querySelector('button[aria-label="Increase AMRAP target"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.routines[0].ex[0].amrapMinReps).toBe(5)
  })

  it('inserts after the current exercise in a freestyle workout and lands on it', async () => {
    await mount([
      exercise('first', [false]),
      exercise('current', [false]),
      exercise('last', [false]),
    ], 1)

    await addExerciseThroughSheets({ id: 'inserted' })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['first', 'current', 'inserted', 'last'])
    expect(mocks.S.active.cur).toBe(2)
  })

  it('inserts after the complete current superset unit and keeps existing grouping intact', async () => {
    await mount([
      exercise('superset-a', [false], { sg: 'group-1' }),
      exercise('superset-b', [false], { sg: 'group-1' }),
      exercise('after-group', [false]),
    ], 1)

    await addExerciseThroughSheets({ id: 'inserted' })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['superset-a', 'superset-b', 'inserted', 'after-group'])
    expect(mocks.S.active.entries.slice(0, 2).map(entry => entry.sg)).toEqual(['group-1', 'group-1'])
    expect(mocks.S.active.entries[2].sg).toBeUndefined()
    expect(mocks.S.active.cur).toBe(2)
  })

  it('appends after the current unit when it is the last unit', async () => {
    await mount([
      exercise('first', [false]),
      exercise('last', [false]),
    ], 1)

    await addExerciseThroughSheets({ id: 'inserted' })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['first', 'last', 'inserted'])
    expect(mocks.S.active.cur).toBe(2)
  })

  it.each([
    ['freestyle', {}],
    ['planned', {
      active: { routineId: 'routine-1' },
      routines: [{ id: 'routine-1', ex: [] }],
    }],
  ])('saves the selected config through the picker chain for a %s session', async (_label, overrides) => {
    await mount([exercise('current', [false]), exercise('last', [false])], 0, overrides)

    await addExerciseThroughSheets({ id: 'configured' }, { mode: 'reps', sets: 2, reps: 6, weight: 20 })

    const added = mocks.S.active.entries[1]
    expect(added.id).toBe('configured')
    expect(added.target.reps).toBe(6)
    expect(added.target.sets).toBe(2)
    expect(added.sets).toHaveLength(2)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('keeps a generic freestyle start blank instead of seeding the latest freestyle history', async () => {
    await mount([], 0, {
      workouts: [{
        d: '2026-08-10',
        unit: 'kg',
        complete: true,
        routineId: null,
        entries: [{
          id: 'configured',
          unit: 'kg',
          target: { mode: 'reps', sets: 4, reps: 8, weight: 60, prog: 'linear', unit: 'kg' },
          sets: [
            { phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 8, done: true },
            { phase: 'work', mode: 'reps', unit: 'kg', w: 62.5, r: 7, done: true },
            { phase: 'work', mode: 'reps', unit: 'kg', w: 62.5, r: 6, done: true },
            { phase: 'work', mode: 'reps', unit: 'kg', w: 62.5, r: 5, done: true }
          ]
        }]
      }]
    })
    expect(mocks.S.active.entries).toEqual([])

    await addExerciseThroughSheets({ id: 'configured' }, { mode: 'reps', sets: 1, reps: 5, weight: 0 })

    const configCall = mocks.exConfigSheet.mock.calls.at(-1)
    const added = mocks.S.active.entries[0]
    expect(configCall[5]).toBeUndefined()
    expect(added.target).toMatchObject({ mode: 'reps', sets: 1, reps: 5, weight: 0 })
    expect(added.sets).toHaveLength(1)
    expect(added.sets[0]).toMatchObject({ w: 0, r: 5, done: false })
  })

  it('resolves an explicit percentage load from the latest global work history without seeding fresh freestyle', async () => {
    await mount([], 0, {
      workouts: [{
        d: '2026-08-10', unit: 'kg', complete: true,
        entries: [{
          id: 'configured', unit: 'kg',
          target: { mode: 'reps', sets: 1, reps: 3, weight: 80, unit: 'kg' },
          sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }]
        }]
      }]
    })

    expect(mocks.S.active.entries).toEqual([])
    await addExerciseThroughSheets({ id: 'configured' }, {
      mode: 'reps', sets: 2, reps: 5, weight: 0,
      weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 }
    })

    const added = mocks.S.active.entries[0]
    expect(added.target).toMatchObject({ weight: 45, resolvedWeight: 45,
      weightPrescription: { kind: 'percentage', percent: 50 } })
    expect(added.sets.map(set => set.w)).toEqual([45, 45])
    expect(mocks.S.active.entries).toHaveLength(1)
  })

  it('resolves percentage Work settings from global history while keeping fresh freestyle scoped', async () => {
    await mount([{
      id: 'configured',
      target: { mode: 'reps', sets: 2, reps: 5, weight: 0 },
      sets: [
        { phase: 'work', mode: 'reps', w: 0, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 0, r: 5, done: false }
      ]
    }], 0, {
      workouts: [{
        d: '2026-08-10', unit: 'kg', complete: true,
        entries: [{
          id: 'configured', unit: 'kg', target: { mode: 'reps', reps: 3, weight: 80, unit: 'kg' },
          sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }]
        }]
      }]
    })

    await saveWorkSettingsThroughCog({
      loadMode: 'percentage', sets: 2, mode: 'reps', reps: 5, weight: 0,
      weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 }
    })

    const updated = mocks.S.active.entries[0]
    expect(updated.target).toMatchObject({ weight: 45, resolvedWeight: 45,
      weightPrescription: { kind: 'percentage', percent: 50 } })
    expect(updated.sets.map(set => set.w)).toEqual([45, 45])
  })

  it('switches percentage Work settings to fixed and rebuilds only unfinished work rows', async () => {
    const completed = { phase: 'work', mode: 'reps', w: 45, r: 5, done: true, effort: 'keep' }
    const pending = { phase: 'work', mode: 'reps', w: 45, r: 5, done: false }
    await mount([{
      id: 'configured',
      target: {
        mode: 'reps', sets: 3, reps: 5, weight: 45, resolvedWeight: 45,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 },
        load: { kind: 'percentage', percent: 50 }, loadMode: 'percentage', loadPercent: 50, loadFallback: 0,
        workWeight: 45, workResolvedWeight: 45, workLoadMode: 'percentage'
      },
      sets: [completed, pending, { ...pending }]
    }])

    await saveWorkSettingsThroughCog({ loadMode: 'fixed', sets: 3, mode: 'reps', reps: 5, weight: 70 })

    const updated = mocks.S.active.entries[0]
    expect(updated.target).toMatchObject({ sets: 3, reps: 5, weight: 70 })
    for (const key of [
      'weightPrescription', 'resolvedWeight', 'load', 'loadMode', 'loadPercent', 'loadFallback',
      'workW', 'workWeight', 'workResolvedWeight', 'workWeightPrescription', 'workLoad',
      'workLoadMode', 'workLoadPercent', 'workLoadFallback'
    ]) expect(updated.target).not.toHaveProperty(key)
    expect(updated.sets[0]).toBe(completed)
    expect(updated.sets[0]).toEqual(completed)
    expect(updated.sets.slice(1).map(set => set.w)).toEqual([70, 70])
    expect(updated.sets.slice(1).every(set => set.done === false)).toBe(true)
  })

  it('updates unfinished rows for an ordinary fixed-to-fixed Work settings edit', async () => {
    const completed = { phase: 'work', mode: 'reps', w: 50, r: 5, done: true }
    await mount([{
      id: 'configured',
      target: { mode: 'reps', sets: 2, reps: 5, weight: 50 },
      sets: [completed, { phase: 'work', mode: 'reps', w: 50, r: 5, done: false }]
    }])

    await saveWorkSettingsThroughCog({ loadMode: 'fixed', sets: 2, mode: 'reps', reps: 6, weight: 65 })

    const updated = mocks.S.active.entries[0]
    expect(updated.sets[0]).toBe(completed)
    expect(updated.sets[1]).toMatchObject({ phase: 'work', mode: 'reps', w: 65, r: 6, done: false })
  })

  it('keeps stable Programme row identities when the real Work settings save changes its count', async () => {
    const programmeEntry = {
      id: 'configured',
      target: { mode: 'reps', sets: 2, reps: 5, weight: 50 },
      sets: [
        { phase: 'work', mode: 'reps', w: 50, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 50, r: 5, done: false }
      ]
    }
    const baseline = partialExitBaseline([programmeEntry])
    await mount([programmeEntry], 0, { active: { sessionType: 'programme', partialExitBaseline: baseline } })

    await saveWorkSettingsThroughCog({ loadMode: 'fixed', sets: 3, mode: 'reps', reps: 6, weight: 65 })

    expect(mocks.S.active.entries[0].sets.map(set => set.programmeRowId))
      .toEqual(['configured#1:work:1', 'configured#1:work:2', undefined])
  })

  it('resolves repeated percentage edits from canonical global compatible history while newer outliers stay median-smoothed', async () => {
    const selected = {
      d: '2026-08-01', unit: 'kg', entries: [{
        id: 'configured', unit: 'kg', target: { mode: 'reps', reps: 5, weight: 60, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }]
      }]
    }
    const newer = {
      d: '2026-08-10', unit: 'kg', entries: [{
        id: 'configured', unit: 'kg', target: { mode: 'reps', reps: 8, weight: 100, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 8, done: true }]
      }]
    }
    await mount([{
      id: 'configured',
      target: { mode: 'reps', sets: 1, reps: 5, weight: 0 },
      sets: [{ phase: 'work', mode: 'reps', w: 0, r: 5, done: false }]
    }], 0, {
      active: { start: Date.parse('2026-08-23T12:00:00Z'), routineId: null, historyPolicy: { kind: 'selected-freestyle', workout: selected } },
      workouts: [selected, newer]
    })

    await saveWorkSettingsThroughCog({
      loadMode: 'percentage', sets: 1, mode: 'reps', reps: 5, weight: 0,
      weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 }
    })

    const workOptions = mocks.workConfigSheet.mock.calls.at(-1)?.[4]
    expect(workOptions?.percentageState).toBe(mocks.S)
    expect(workOptions?.now).toBe(mocks.S.active.start)
    const updated = mocks.S.active.entries[0]
    expect(updated.target).toMatchObject({ weight: 50, resolvedWeight: 50 })
    expect(updated.sets[0]).toMatchObject({ w: 50, r: 5, done: false })
    expect(updated.sets[0].w).not.toBe(35)

    await saveWorkSettingsThroughCog({
      loadMode: 'percentage', sets: 1, mode: 'reps', reps: 5, weight: 0,
      weightPrescription: { kind: 'percentage', source: 'latest', percent: 50, fallbackWeight: 0 }
    })

    expect(mocks.S.active.entries[0].target).toMatchObject({ weight: 62.5, resolvedWeight: 62.5,
      weightPrescription: { kind: 'percentage', source: 'latest', percent: 50 } })
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 5, done: false })
  })

  it('passes canonical global history to selected Repeat Add while preserving the selected source rows', async () => {
    const selected = {
      d: '2026-08-01', unit: 'kg', entries: [{
        id: 'configured', unit: 'kg', target: { mode: 'reps', reps: 5, weight: 60, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }]
      }]
    }
    const newer = {
      d: '2026-08-10', unit: 'kg', entries: [{
        id: 'configured', unit: 'kg', target: { mode: 'reps', reps: 8, weight: 100, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 8, done: true }]
      }]
    }
    await mount([exercise('configured', [false])], 0, {
      active: { routineId: null, historyPolicy: { kind: 'selected-freestyle', workout: selected } },
      workouts: [selected, newer]
    })

    await addExerciseThroughSheets({ id: 'configured' }, { mode: 'reps', sets: 1, reps: 5, weight: 0 })

    const options = mocks.exConfigSheet.mock.calls.at(-1)?.[6]
    expect(options?.historyState?.workouts).toEqual([selected, newer])
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ w: 60, r: 5, done: false })
  })
})
