// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: null,
  navigate: vi.fn(),
  startFlow: vi.fn(),
  resumeWeeklySession: vi.fn(),
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
  resumeWeeklySession: mocks.resumeWeeklySession,
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

function programmeState({ editable = true, skipped = false, finished = false } = {}) {
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
    },
    programmeDispositions: {
      version: 1,
      entries: finished ? {
        [instanceId]: {
          version: 1, disposition: 'finish', instanceId,
          calendarDate: '2026-07-27', recordedAt: '2026-07-27T11:00:00.000Z'
        }
      } : {}
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
    expect(mocks.startFlow).toHaveBeenCalledWith(classicRoutine.id, null, { calendarDate: '2026-07-27' })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('passes the future week-strip date into the exact classic start', () => {
    const selectedDate = '2026-07-30'
    const state = baseState({ dayPlan: { [selectedDate]: [classicRoutine.id] } })
    mount(state)
    const futureDay = [...host.querySelectorAll('.wday')].find(day => day.textContent.includes('30'))
    click(futureDay)
    const row = rowFor(classicRoutine.name)

    click(buttonFor(row))

    expect(mocks.startFlow).toHaveBeenCalledWith(classicRoutine.id, null, { calendarDate: selectedDate })
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

  it('keeps a finished programme row viewable but non-startable', () => {
    const state = programmeState({ finished: true })
    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(buttonFor(row)).toBeUndefined()
    expect(row.querySelector('button[aria-label="Start session"]')).toBeNull()
    expect(row.textContent).toContain('Done')
    click(row.querySelector('.ttl'))

    expect(mocks.startFlow).not.toHaveBeenCalled()
    expect(mocks.dayViewSheet).toHaveBeenCalledWith('2026-07-27')
    expect(state.active).toBeNull()
  })

  it('shows Resume and returns to an active workout without restarting it', () => {
    const active = {
      id: 'active-1', d: '2026-07-27', routineId: classicRoutine.id,
      name: 'Lifecycle workout', cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 62.5, r: 9, done: false, amrapRole: 'progression' }] }],
    }
    const state = baseState({ dayPlan: { '2026-07-27': [classicRoutine.id] }, active })
    mount(state)
    const row = rowFor(active.name)

    expect(row.textContent).toContain('Resume')
    click(row)

    expect(mocks.navigate).toHaveBeenCalledWith('/workout')
    expect(state.active).toEqual(active)
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('keeps an all-checked classic session resumable until explicit Finish', () => {
    const active = {
      id: 'active-all-checked', d: '2026-07-27', routineId: classicRoutine.id,
      name: classicRoutine.name, cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 62.5, r: 9, done: true }] }],
    }
    const state = baseState({ dayPlan: { '2026-07-27': [classicRoutine.id] }, active })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Resume')
    expect(row.textContent).not.toContain('Done')
    expect(state.active).toEqual(active)
  })

  it('does not turn a different classic routine on the same date into Resume', () => {
    const state = baseState({
      routines: [classicRoutine, { id: 'other-routine', name: 'Other routine', emoji: null, ex: [{ id: 'other-lift' }] }],
      dayPlan: { '2026-07-27': [classicRoutine.id] },
      active: {
        id: 'active-other', d: '2026-07-27', routineId: 'other-routine', name: 'Other routine', cur: 0,
        entries: [{ id: 'other-lift', sets: [{ w: 20, r: 5, done: false }] }],
      },
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row).toBeTruthy()
    expect(row.textContent).toContain('Start')
    expect(row.textContent).not.toContain('Resume')
  })

  it('does not turn the same classic routine from a different date into Resume', () => {
    const state = baseState({
      dayPlan: { '2026-07-27': [classicRoutine.id] },
      active: {
        id: 'active-yesterday', d: '2026-07-26', routineId: classicRoutine.id,
        name: classicRoutine.name, cur: 0,
        entries: [{ id: 'lift', sets: [{ w: 20, r: 5, done: false }] }],
      },
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Start')
    expect(row.textContent).not.toContain('Resume')
  })

  it('offers Resume for an explicitly early-finished classic session', () => {
    const state = baseState({
      dayPlan: { '2026-07-27': [classicRoutine.id] },
      workouts: [{
        id: 'finished-early', d: '2026-07-27', routineId: classicRoutine.id,
        plannedComplete: false, entries: [{ id: 'lift', sets: [{ done: true }, { done: false }] }],
      }],
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Resume')
    expect(row.textContent).not.toContain('Done')
    click(buttonFor(row, 'Resume'))
    expect(mocks.resumeWeeklySession).toHaveBeenCalledWith({
      source: 'classic', routineId: classicRoutine.id, calendarDate: '2026-07-27'
    })
  })

  it('labels an explicitly completed classic session Done', () => {
    const state = baseState({
      dayPlan: { '2026-07-27': [classicRoutine.id] },
      workouts: [{
        id: 'finished-complete', d: '2026-07-27', routineId: classicRoutine.id,
        plannedComplete: true, entries: [{ id: 'lift', sets: [{ done: true }] }],
      }],
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Done')
    expect(row.textContent).not.toContain('Start')
    expect(row.textContent).not.toContain('Resume')
  })

  it('keeps the classic row Done after an early-finished Repeat', () => {
    const state = baseState({
      dayPlan: { '2026-07-27': [classicRoutine.id] },
      workouts: [
        { id: 'completed', d: '2026-07-27', routineId: classicRoutine.id, plannedComplete: true, entries: [] },
        { id: 'repeat-early', d: '2026-07-27', routineId: classicRoutine.id, plannedComplete: false, entries: [] },
      ],
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Done')
    expect(row.textContent).not.toContain('Incomplete')
    expect(row.textContent).not.toContain('Start')
  })

  it('labels a converted-classic completion Done and non-startable', () => {
    const state = baseState({
      dayPlan: { '2026-07-27': [classicRoutine.id] },
      workouts: [{
        id: 'converted-completion', d: '2026-07-27', routineId: classicRoutine.id,
        plannedComplete: true, programmeId: 'converted-programme', classicConversion: true, entries: []
      }],
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Done')
    expect(row.textContent).not.toContain('Start')
    expect(buttonFor(row)).toBeUndefined()
  })

  it('returns a discarded classic session to Start without completion', () => {
    const state = baseState({
      dayPlan: { '2026-07-27': [classicRoutine.id] }, active: null, workouts: [],
    })

    mount(state)
    const row = rowFor(classicRoutine.name)

    expect(row.textContent).toContain('Start')
    expect(row.textContent).not.toContain('Done')
    expect(row.textContent).not.toContain('Resume')
  })

  it('shows Resume only on the Programme row with the matching instance identity', () => {
    const state = programmeState()
    state.active = {
      id: 'active-programme', d: '2026-07-27', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:programme-session',
      name: programmeRoutine.name, cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 40, r: 5, done: false }] }],
    }

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row).toBeTruthy()
    expect(row.textContent).toContain('Resume')
    expect(row.textContent).not.toContain('Start')
    click(row.querySelector('.ttl'))
    expect(mocks.navigate).toHaveBeenCalledWith('/workout')
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('keeps an all-checked Programme session resumable until explicit Finish', () => {
    const state = programmeState()
    state.active = {
      id: 'active-programme-complete', d: '2026-07-27', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:programme-session',
      name: programmeRoutine.name, cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 40, r: 5, done: true }] }],
    }

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Resume')
    expect(row.textContent).not.toContain('Done')
  })

  it('does not turn a different Programme instance with the same routine and date into Resume', () => {
    const state = programmeState()
    state.active = {
      id: 'active-other-instance', d: '2026-07-27', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:different-session',
      name: programmeRoutine.name, cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 40, r: 5, done: false }] }],
    }

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Start')
    expect(row.textContent).not.toContain('Resume')
    click(buttonFor(row))
    expect(mocks.navigate).toHaveBeenCalledWith('/workout')
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('does not turn the same Programme instance from a different date into Resume', () => {
    const state = programmeState()
    state.active = {
      id: 'active-programme-yesterday', d: '2026-07-26', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:programme-session',
      name: programmeRoutine.name, cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 40, r: 5, done: false }] }],
    }

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Start')
    expect(row.textContent).not.toContain('Resume')
  })

  it('keeps Programme Resume matched by nominal date after display-date reprojection', () => {
    const state = programmeState()
    state.active = {
      id: 'active-programme-reloaded', d: '2026-07-28', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:programme-session',
      programmeStep: { nominalDate: '2026-07-27', projectedDate: '2026-07-28' },
      name: programmeRoutine.name, cur: 0,
      entries: [{ id: 'lift', sets: [{ w: 40, r: 5, done: false }] }],
    }

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Resume')
    expect(row.textContent).not.toContain('Start')
  })

  it('labels an explicitly completed Programme instance Done', () => {
    const state = programmeState()
    state.workouts = [{
      id: 'programme-finished', d: '2026-07-27', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:programme-session', complete: true,
      entries: [{ id: 'lift', sets: [{ done: true }] }],
    }]

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Done')
    expect(row.textContent).not.toContain('Start')
    expect(row.textContent).not.toContain('Resume')
  })

  it('offers Resume for an explicitly early-finished Programme instance', () => {
    const state = programmeState()
    state.workouts = [{
      id: 'programme-finished-early', d: '2026-07-27', routineId: programmeRoutine.id,
      sessionType: 'programme', instanceId: 'pi:cycle-1:programme-session',
      partial: true, complete: false, owed: false, schedule: 'advance', exitIntent: 'skip',
      completion: { completedWorkSets: 1, prescribedWorkSets: 2, exitIntent: 'skip' },
      entries: [{ id: 'lift', sets: [{ done: true }, { done: false }] }],
    }]

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Resume')
    expect(row.textContent).not.toContain('Done')
    click(buttonFor(row, 'Resume'))
    expect(mocks.resumeWeeklySession).toHaveBeenCalledWith({
      source: 'programme', routineId: programmeRoutine.id,
      instanceId: 'pi:cycle-1:programme-session', calendarDate: '2026-07-27'
    })
  })

  it('returns a discarded Programme instance to Start without completion', () => {
    const state = programmeState()
    state.active = null
    state.workouts = []

    mount(state)
    const row = rowFor(programmeRoutine.name)

    expect(row.textContent).toContain('Start')
    expect(row.textContent).not.toContain('Done')
    expect(row.textContent).not.toContain('Resume')
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
