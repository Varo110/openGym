// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: null,
  navigate: vi.fn(),
  startFlow: vi.fn(),
  startSessionSheet: vi.fn(),
  dayOverrideSheet: vi.fn(),
  dayViewSheet: vi.fn(),
}))

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector(mocks.state) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(),
  beginWorkout: vi.fn(),
  repeatFreestyleSheet: vi.fn(),
  goalSheet: vi.fn(),
  dayOverrideSheet: mocks.dayOverrideSheet,
  dayViewSheet: mocks.dayViewSheet,
  calendarSheet: vi.fn(),
  startFlow: mocks.startFlow,
  startSessionSheet: mocks.startSessionSheet,
  loadStarterPlan: vi.fn(),
  bwDeltaColor: () => 'var(--acc)',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))

const { default: Home } = await import('./Home.jsx')

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root
let host

const classicRoutine = {
  id: 'classic/id with spaces', name: 'Classic push', emoji: null, ex: [{ id: 'lift' }]
}
const programmeRoutine = {
  id: 'programme/id with spaces', name: 'Programme push', emoji: null, ex: [{ id: 'lift' }]
}

function baseState(overrides = {}) {
  return {
    unit: 'kg', bodyweight: [], routines: [classicRoutine], week: {}, dayPlan: {},
    workouts: [], active: null, programmes: null, ...overrides
  }
}

function programmeState({ editable = true, skipped = false } = {}) {
  const instanceId = 'pi:cycle-1:programme-session'
  return baseState({
    routines: editable ? [programmeRoutine] : [],
    programmes: {
      version: 1,
      skippedInstanceIds: skipped ? [instanceId] : [],
      cycles: [{
        id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-07-27T00:00:00Z',
        timeZone: 'UTC', week1StartDate: '2026-07-27',
        snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
          id: 'programme-session', routineId: programmeRoutine.id, routineSnapshot: programmeRoutine
        }] }] }] }
      }]
    }
  })
}

function mount(state) {
  mocks.state = { S: state, user: null }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Home />))
  return host
}

function click(element) {
  expect(element).toBeTruthy()
  act(() => element.click())
}

function rowFor(text) {
  return [...host.querySelectorAll('.today-row')].find(row => row.textContent.includes(text))
}

function buttonFor(row, text = 'Start') {
  return [...row.querySelectorAll('button')].find(button => button.textContent.trim() === text)
}

describe('Home weekly routine row actions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (root) act(() => root.unmount())
    root = null
    host?.remove()
    host = null
    vi.useRealTimers()
  })

  it('starts the exact classic routine once without navigating when its Start button is clicked', () => {
    const state = baseState({ dayPlan: { '2026-07-27': [classicRoutine.id] } })
    mount(state)
    const row = rowFor(classicRoutine.name)

    click(buttonFor(row))

    expect(mocks.startFlow).toHaveBeenCalledTimes(1)
    expect(mocks.startFlow).toHaveBeenCalledWith(classicRoutine.id)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('opens the encoded classic routine editor without starting when the row body is clicked', () => {
    const state = baseState({ dayPlan: { '2026-07-27': [classicRoutine.id] } })
    mount(state)

    click(rowFor(classicRoutine.name).querySelector('.ttl'))

    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).toHaveBeenCalledWith(`/plan/r/${encodeURIComponent(classicRoutine.id)}`)
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('starts the exact programme snapshot once without navigating when its Start button is clicked', () => {
    mount(programmeState())
    const row = rowFor(programmeRoutine.name)

    click(buttonFor(row))

    expect(mocks.startFlow).toHaveBeenCalledTimes(1)
    expect(mocks.startFlow).toHaveBeenCalledWith(
      programmeRoutine.id,
      expect.objectContaining({ routineId: programmeRoutine.id, instanceId: 'pi:cycle-1:programme-session' })
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('opens the current encoded programme routine editor without starting when the row body is clicked', () => {
    mount(programmeState())

    click(rowFor(programmeRoutine.name).querySelector('.ttl'))

    expect(mocks.navigate).toHaveBeenCalledWith(`/plan/r/${encodeURIComponent(programmeRoutine.id)}`)
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('falls back to the existing day detail for a programme snapshot with no editable routine', () => {
    mount(programmeState({ editable: false }))

    click(rowFor(programmeRoutine.name).querySelector('.ttl'))

    expect(mocks.dayViewSheet).toHaveBeenCalledWith('2026-07-27')
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('keeps a skipped programme row non-startable', () => {
    mount(programmeState({ skipped: true }))
    const row = rowFor(programmeRoutine.name)

    expect(buttonFor(row)).toBeUndefined()
    expect(row.textContent).toContain('Finish and skip')
    click(row.querySelector('.ttl'))

    expect(mocks.startFlow).not.toHaveBeenCalled()
    expect(mocks.dayViewSheet).toHaveBeenCalledWith('2026-07-27')
  })

  it('uses the same semantic component, class and size for classic and programme Start controls', () => {
    const state = programmeState()
    state.routines = [classicRoutine, programmeRoutine]
    state.dayPlan = { '2026-07-27': [classicRoutine.id] }
    mount(state)

    const starts = [...host.querySelectorAll('.today-row button')]
      .filter(button => button.textContent.trim() === 'Start')
    expect(starts).toHaveLength(2)
    for (const button of starts) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.type).toBe('button')
      expect(button.classList.contains('primary')).toBe(true)
      expect(button.classList.contains('sm')).toBe(true)
      expect(button.classList.contains('home-start-action')).toBe(true)
    }
  })
})
