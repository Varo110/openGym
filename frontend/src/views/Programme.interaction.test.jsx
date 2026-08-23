// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEF, useStore } from '../store/useStore.js'
import { beginWorkout } from '../sheets.jsx'
import { pickupExerciseRows, programmeCycleItems } from '../lib/programmes-ui.js'
import Plan, { activeProgrammeEditState } from './Plan.jsx'

const routing = vi.hoisted(() => ({ navigate: vi.fn(), locationState: null }))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: routing.locationState }),
  useNavigate: () => routing.navigate
}))

const { default: ProgrammeBuilder, cancelProgrammeEdit, saveProgrammeInState } = await import('./ProgrammeNew.jsx')
const { default: ProgrammePickup, startProgrammePickupInState, suggestionForRow } = await import('./ProgrammePickup.jsx')

const routine = {
  id: 'r1', name: 'Push', prog: 'linear', ex: [{ id: 'bench', mode: 'reps', weight: 60, reps: 5 }]
}

const programme = {
  id: 'p1', name: 'P1', progression: 'linear', weeks: [{ weekIndex: 1, mode: 'normal', days: [{
    weekday: 1, sessions: [{ id: 'push:w1:d1:s1', routineId: 'r1', routineSnapshot: { ...routine, ex: [{ ...routine.ex[0], weight: 80 }] } }]
  }] }]
}

vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn(() => null) })
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let mountedRoot = null
let mountedHost = null

function mount(view) {
  mountedHost = document.createElement('div')
  document.body.appendChild(mountedHost)
  mountedRoot = createRoot(mountedHost)
  act(() => mountedRoot.render(view))
  return mountedHost
}

function click(element) {
  act(() => element.click())
}

function changeInput(element, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(element.ownerDocument.defaultView.HTMLInputElement.prototype, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function stateWith(overrides = {}) {
  return {
    ...JSON.parse(JSON.stringify(DEF)),
    unit: 'kg',
    routines: [JSON.parse(JSON.stringify(routine))],
    week: { 1: 'r1' },
    programmes: { version: 1, definitions: [], cycles: [] },
    ...overrides
  }
}

describe('programme builder and pickup surfaces', () => {
  afterEach(() => {
    if (mountedRoot) act(() => mountedRoot.unmount())
    mountedRoot = null
    mountedHost?.remove()
    mountedHost = null
    routing.navigate.mockReset()
    routing.locationState = null
  })

  it('renders the in-progress builder with routine editing and save controls', () => {
    useStore.setState({ S: stateWith() })
    expect(useStore.getState().S.routines).toHaveLength(1)
    const html = renderToStaticMarkup(<ProgrammeBuilder />)

    expect(html).toContain('New programme')
    expect(html).toContain('New routine')
    expect(html).toContain('Save programme')
    expect(html).toContain('programme-builder-days')
  })

  it('persists a deload suggestion through the store and keeps the runtime target at that value', () => {
    const initial = stateWith({ programmes: { version: 1, definitions: [programme], cycles: [] } })
    useStore.setState({ S: initial })
    const rows = pickupExerciseRows(initial, programme)
    const row = rows[0]
    const chosen = suggestionForRow(row, 'deload', 10)
    let cycle = null
    useStore.getState().update(state => {
      cycle = startProgrammePickupInState(state, {
        definition: programme, rows, loadMode: 'deload', deloadPercent: 10,
        values: { [row.key]: chosen }, unit: 'kg', timeZone: 'UTC'
      })
    })

    expect(cycle.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(72.5)
    const item = programmeCycleItems(cycle, { now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' })[0]
    beginWorkout(null, null, item)
    const active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ weight: 72.5 })
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 72.5)).toBe(true)
  })

  it('renders bodyweight pickup targets as compact fixed values instead of a load suggestion editor', () => {
    const bodyweightProgramme = {
      id: 'bodyweight-programme', name: 'Bodyweight block', progression: 'linear', weeks: [{ weekIndex: 1, mode: 'normal', days: [{
        weekday: 1, sessions: [{ id: 'bw:w1:d1:s1', routineId: 'bw-routine', routineSnapshot: {
          id: 'bw-routine', name: 'Core', ex: [{ id: '0001', mode: 'reps', sets: 4, reps: 12 }]
        } }]
      }] }]
    }
    const initial = stateWith({ programmes: { version: 1, definitions: [bodyweightProgramme], cycles: [] } })
    useStore.setState({ S: initial })
    routing.locationState = { programmeId: bodyweightProgramme.id, mode: 'start' }
    const host = mount(<ProgrammePickup />)
    expect(host.querySelector('.pickup-fixed-target')?.textContent).toContain('reps × 4')
    expect(host.querySelector('.pickup-suggestion-copy')).toBeNull()
  })

  it('routes active-programme edits with the cycle identity, not only the reusable programme id', () => {
    expect(activeProgrammeEditState({ id: 'cycle-1', programmeId: 'p1' })).toEqual({
      mode: 'edit-cycle', cycleId: 'cycle-1', programmeId: 'p1'
    })
  })

  it('saves edited routine data into the active snapshot, leaves the reusable definition intact, and cancels without a second write', () => {
    const active = {
      id: 'cycle-1', programmeId: 'p1', status: 'active', projectionPrepared: true, lengthWeeks: 1,
      programmeSnapshot: { ...programme, name: 'Active snapshot' }, snapshot: { weeks: programme.weeks }
    }
    useStore.setState({ S: stateWith({ programmes: { version: 1, definitions: [programme], cycles: [active] } }) })
    const edited = {
      ...programme, name: 'Active edited', weeks: [{ ...programme.weeks[0], days: [{
        ...programme.weeks[0].days[0], sessions: [{
          ...programme.weeks[0].days[0].sessions[0], routineSnapshot: { ...routine, name: 'Push edited', ex: [{ ...routine.ex[0], weight: 90 }] }
        }]
      }] }]
    }
    useStore.getState().update(state => {
      saveProgrammeInState(state, edited, {
        editCycleId: 'cycle-1', pendingRoutines: { r1: { ...routine, name: 'Push edited', ex: [{ ...routine.ex[0], weight: 90 }] } }
      })
    })
    const saved = useStore.getState().S
    expect(saved.programmes.cycles[0].programmeSnapshot.name).toBe('Active edited')
    expect(saved.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(90)
    expect(saved.programmes.definitions[0].name).toBe('P1')
    expect(saved.routines[0].name).toBe('Push edited')

    const beforeCancel = JSON.stringify(saved)
    cancelProgrammeEdit(routing.navigate)
    expect(routing.navigate).toHaveBeenCalledWith('/plan')
    expect(JSON.stringify(useStore.getState().S)).toBe(beforeCancel)
  })

  it('mounts Plan and Pickup together through navigation, controls, store, and workout runtime', () => {
    const initial = stateWith({ programmes: { version: 1, definitions: [programme], cycles: [] } })
    useStore.setState({ S: initial })
    const planHost = mount(<Plan />)
    const readyStart = [...planHost.querySelectorAll('[data-testid="ready-programme-row"] button')]
      .find(button => button.textContent.includes('Start'))
    expect(readyStart).toBeTruthy()
    click(readyStart)
    expect(routing.navigate).toHaveBeenLastCalledWith('/programme/pickup', { state: { programmeId: 'p1', mode: 'start' } })

    routing.locationState = routing.navigate.mock.calls.at(-1)[1].state
    act(() => mountedRoot.unmount())
    mountedRoot = null
    planHost.remove()
    const pickupHost = mount(<ProgrammePickup />)
    const lighterRestart = [...pickupHost.querySelectorAll('button')].find(button => button.textContent.includes('Lighter restart'))
    const useSuggestion = [...pickupHost.querySelectorAll('button')].find(button => button.textContent.includes('Use suggestion'))
    const applyAll = [...pickupHost.querySelectorAll('button')].find(button => button.textContent.includes('Apply all'))
    expect(lighterRestart).toBeTruthy()
    expect(useSuggestion).toBeTruthy()
    expect(applyAll).toBeTruthy()
    click(lighterRestart)
    click(useSuggestion)
    const targetInput = [...pickupHost.querySelectorAll('input.num')].at(-1)
    changeInput(targetInput, '70')
    expect(targetInput.value).toBe('70')
    click(applyAll)
    expect(targetInput.value).toBe('72.5')

    const start = [...pickupHost.querySelectorAll('button')].find(button => button.textContent.includes('Start cycle'))
    expect(start).toBeTruthy()
    click(start)
    const cycle = useStore.getState().S.programmes.cycles[0]
    expect(cycle).toMatchObject({ programmeId: 'p1', status: 'active' })
    expect(routing.navigate).toHaveBeenLastCalledWith('/plan')

    const item = programmeCycleItems(cycle, { now: '2026-02-23T12:00:00.000Z', timeZone: 'UTC' })[0]
    act(() => beginWorkout(null, null, item))
    const active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ weight: 72.5 })
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 72.5)).toBe(true)
  })

  it('mounts the programme builder, edits its controls, saves through the store, and navigates back', () => {
    useStore.setState({ S: stateWith() })
    const host = mount(<ProgrammeBuilder />)
    const name = host.querySelector('#programme-name')
    changeInput(name, 'Mounted cycle')
    expect(name.value).toBe('Mounted cycle')
    const weekTab = [...host.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.includes('Week 1'))
    click(weekTab)
    const save = [...host.querySelectorAll('button')].find(button => button.textContent.includes('Save programme'))
    click(save)

    expect(useStore.getState().S.programmes.definitions).toHaveLength(1)
    expect(useStore.getState().S.programmes.definitions[0].name).toBe('Mounted cycle')
    expect(routing.navigate).toHaveBeenLastCalledWith('/plan')

    routing.navigate.mockClear()
    click(host.querySelector('button[aria-label="Close"]'))
    expect(routing.navigate).toHaveBeenCalledWith('/plan')
  })

  it('lets the builder choose a programme colour and renders it on the Plan week strip', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-23T12:00:00.000Z'))
    try {
      const active = {
        id: 'cycle-colour', programmeId: 'p1', status: 'active', projectionPrepared: true,
        week1StartDate: '2026-02-23', timeZone: 'UTC',
        programmeSnapshot: { ...programme, colour: 'sky' },
        snapshot: { weeks: programme.weeks, colour: 'sky' }
      }
      useStore.setState({ S: stateWith({ week: { 1: 'r1' },
        programmes: { version: 1, definitions: [{ ...programme, colour: null }], cycles: [active] }
      }) })

      const host = mount(<ProgrammeBuilder />)
      const sky = host.querySelector('[data-testid="programme-colour-sky"]')
      expect(sky).toBeTruthy()
      click(sky)
      const save = [...host.querySelectorAll('button')].find(button => button.textContent.includes('Save programme'))
      click(save)
      expect(useStore.getState().S.programmes.definitions.at(-1).colour).toBe('sky')

      act(() => mountedRoot.unmount())
      mountedRoot = null
      host.remove()
      const planHost = mount(<Plan />)
      const programmeTag = [...planHost.querySelectorAll('.pweek .tag')]
        .find(tag => tag.textContent.includes('P1'))
      expect(programmeTag).toBeTruthy()
      expect(programmeTag.textContent).toBe('P1')
      expect(programmeTag.getAttribute('aria-label')).toBe('P1 · Push')
      expect(programmeTag.getAttribute('style')).toContain('var(--blue)')
      const programmeDay = programmeTag.closest('.pday')
      expect([...programmeDay.querySelectorAll('.tag')].some(tag => tag.textContent.trim() === 'Push')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('mounts the active programme detail and drives timeline close/edit navigation', () => {
    const active = {
      id: 'cycle-1', programmeId: 'p1', status: 'active', projectionPrepared: true, lengthWeeks: 1,
      week1StartDate: '2026-02-23', timeZone: 'UTC', progression: 'linear',
      programmeSnapshot: { ...programme }, snapshot: { weeks: programme.weeks }
    }
    useStore.setState({ S: stateWith({ programmes: { version: 1, definitions: [programme], cycles: [active] } }) })
    const host = mount(<Plan />)
    const view = [...host.querySelectorAll('button')].find(button => button.textContent.includes('View programme'))
    click(view)
    expect(host.querySelector('[data-testid="active-programme-detail"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="programme-exercise-timeline"]')).toBeTruthy()

    const edit = [...host.querySelectorAll('button')].find(button => button.textContent.includes('Edit programme'))
    click(edit)
    expect(routing.navigate).toHaveBeenLastCalledWith('/programme/new', { state: activeProgrammeEditState(active) })
  })

  it('switches detail week pills and expands or collapses next-up and session rows', () => {
    const firstRoutine = { id: 'push', name: 'Push A', ex: [{ id: 'bench', name: 'Bench press', mode: 'reps', sets: 3, weight: 60, reps: 5 }] }
    const secondRoutine = { id: 'pull', name: 'Pull B', ex: [{ id: 'row', name: 'Barbell row', mode: 'reps', sets: 4, weight: 40, reps: 8 }] }
    const multiWeek = {
      id: 'p2', name: 'Two week block', progression: 'linear', weeks: [
        { weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{ id: 'push:w1', routineId: 'push', routineSnapshot: firstRoutine }] }] },
        { weekIndex: 2, mode: 'normal', days: [{ weekday: 3, sessions: [{ id: 'pull:w2', routineId: 'pull', routineSnapshot: secondRoutine }] }] }
      ]
    }
    const active = {
      id: 'cycle-2', programmeId: 'p2', status: 'active', projectionPrepared: true, lengthWeeks: 2,
      week1StartDate: '2026-02-23', timeZone: 'UTC', progression: 'linear',
      programmeSnapshot: multiWeek, snapshot: { weeks: multiWeek.weeks }
    }
    useStore.setState({ S: stateWith({ programmes: { version: 1, definitions: [multiWeek], cycles: [active] } }) })
    const host = mount(<Plan />)
    click([...host.querySelectorAll('button')].find(button => button.textContent.includes('View programme')))

    const detail = host.querySelector('[data-testid="active-programme-detail"]')
    const nextToggle = detail.querySelector('[data-testid="programme-next-toggle"]')
    expect(nextToggle.getAttribute('aria-expanded')).toBe('false')
    click(nextToggle)
    expect(nextToggle.getAttribute('aria-expanded')).toBe('true')

    click(detail.querySelector('[data-testid="programme-week-pill-1"]'))
    expect(detail.querySelector('[data-testid="programme-week-label"]').textContent).toContain('Week 1')
    expect(detail.textContent).toContain('Push A')
    const session = detail.querySelector('[data-testid="programme-session-row"]')
    expect(session.getAttribute('aria-expanded')).toBe('false')
    click(session)
    expect(session.getAttribute('aria-expanded')).toBe('true')
    expect(detail.querySelectorAll('[data-testid="programme-exercise-timeline"]').length).toBeGreaterThan(0)
    click(session)
    expect(session.getAttribute('aria-expanded')).toBe('false')
  })

  it('preserves a duplicate exercise occurrence in a ready-programme deep link', () => {
    const duplicateRoutine = {
      id: 'r1', name: 'Push', ex: [
        { id: 'bench', name: 'Bench first', mode: 'reps', sets: 1, reps: 5 },
        { id: 'squat', name: 'Squat', mode: 'reps', sets: 1, reps: 5 },
        { id: 'bench', name: 'Bench second', mode: 'reps', sets: 1, reps: 5 }
      ]
    }
    const duplicateProgramme = {
      id: 'duplicate', name: 'Duplicate programme', weeks: [{ weekIndex: 1, mode: 'normal', days: [{
        weekday: 1, sessions: [{ id: 'duplicate-session', routineId: 'r1', routineSnapshot: duplicateRoutine }]
      }] }]
    }
    useStore.setState({ S: stateWith({
      routines: [duplicateRoutine], programmes: { version: 1, definitions: [duplicateProgramme], cycles: [] }
    }) })
    const host = mount(<Plan />)
    click(host.querySelector('[data-testid="ready-programme-row"]'))

    const detail = host.querySelector('[data-testid="ready-programme-detail"]')
    expect(detail).toBeTruthy()
    click(detail.querySelector('.prog-session-toggle'))
    const rows = detail.querySelectorAll('[data-testid="programme-exercise-timeline"]')
    expect(rows).toHaveLength(3)
    click(rows[2])

    expect(routing.navigate).toHaveBeenLastCalledWith('/plan/r/r1?ex=bench&exi=2&exo=1')
  })
})
