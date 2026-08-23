// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useLocation: () => ({ pathname: '/home' }), useNavigate: () => vi.fn() }
})
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))

import { beginWorkout, DayView, finishWorkout, loadStarterPlan, resumeWeeklySession, StartSessions, startFlow } from '../sheets.jsx'
import { DEF, loadState, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import TabBar from '../components/TabBar.jsx'
import Home from './Home.jsx'
import { StartChooser } from './Workout.jsx'

const FRIDAY = '2026-08-21'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function setAllSetsDone() {
  useStore.setState(({ S }) => ({
    S: {
      ...S,
      active: {
        ...S.active,
        entries: S.active.entries.map(entry => ({
          ...entry,
          sets: entry.sets.map(set => ({ ...set, done: true }))
        }))
      }
    }
  }))
}

describe('Home resumed weekly completion', () => {
  let host
  let root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    localStorage.setItem('gym_guest', '1')
    const state = clone(DEF)
    state.sound = false
    useStore.setState({ S: state, user: null, ready: true })
    useUI.setState({ sheets: [], timer: null, prep: null, work: null })
    loadStarterPlan()
  })

  afterEach(() => {
    if (root) act(() => root.unmount())
    host?.remove()
    useUI.getState().closeAll()
    localStorage.removeItem('gym_guest')
    vi.useRealTimers()
  })

  it('restores the full future Friday guest payload after a zero-set early finish and reload, then renders Done', () => {
    const legDay = useStore.getState().S.routines.find(routine => routine.name === 'Leg Day')
    beginWorkout(legDay.id, 70, null, null, { calendarDate: FRIDAY })
    const sourceId = useStore.getState().S.active.id
    expect(useStore.getState().S.active.entries).toHaveLength(6)
    expect(useStore.getState().S.active.entries.reduce((sum, entry) => sum + entry.sets.length, 0)).toBe(20)

    finishWorkout()
    const earlyFinish = useUI.getState().sheets.at(-1)
    earlyFinish.render(() => {}).props.onConfirm()
    useUI.getState().closeAll()

    const early = useStore.getState().S.workouts[0]
    expect(early).toMatchObject({ id: sourceId, d: FRIDAY, routineId: legDay.id, plannedComplete: false })
    expect(early.entries).toEqual([])

    useStore.setState({ S: loadState() })
    expect(resumeWeeklySession({ source: 'classic', routineId: legDay.id, calendarDate: FRIDAY })).toBe(true)
    expect(useStore.getState().S.active).toMatchObject({
      id: sourceId, sourceWorkoutId: sourceId, d: FRIDAY, routineId: legDay.id
    })
    expect(useStore.getState().S.active.entries).toHaveLength(6)
    expect(useStore.getState().S.active.entries.reduce((sum, entry) => sum + entry.sets.length, 0)).toBe(20)

    useStore.setState({ S: loadState() })
    expect(useStore.getState().S.active.entries).toHaveLength(6)
    expect(useStore.getState().S.active.entries.reduce((sum, entry) => sum + entry.sets.length, 0)).toBe(20)

    setAllSetsDone()
    finishWorkout()
    useUI.getState().closeAll()
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().S.workouts[0]).toMatchObject({
      id: sourceId, d: FRIDAY, routineId: legDay.id, plannedComplete: true
    })
    expect(useStore.getState().S.workouts[0]).not.toHaveProperty('resumeEntries')

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(<Home />))
    const friday = [...host.querySelectorAll('.wday')].find(day => day.textContent.includes('21'))
    act(() => friday.click())
    const row = [...host.querySelectorAll('.today-row')].find(candidate => candidate.textContent.includes('Leg Day'))

    expect(row.textContent).toContain('Done')
    expect(row.textContent).not.toContain('Start')
    expect(row.textContent).not.toContain('Resume')

    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'))
    act(() => root.render(<TabBar onStart={() => {}} />))
    expect(host.textContent).toContain('Done')
    expect(host.textContent).not.toContain('Resume')

    act(() => root.render(<StartChooser />))
    expect(host.textContent).not.toContain('Start Leg Day')
    expect(host.textContent).not.toContain('Resume')

    act(() => root.render(<StartSessions close={() => {}} iso={FRIDAY} />))
    expect(host.textContent).toContain('Every planned session is done today')
    expect(host.textContent).not.toContain('Start Leg Day')
    expect(host.textContent).not.toContain('Resume')

    act(() => root.render(<DayView close={() => {}} iso={FRIDAY} />))
    expect(host.textContent).toContain('Leg Day')
    expect(host.textContent).toContain('Done')
    expect(host.textContent).not.toContain('Resume')

    expect(startFlow(legDay.id, null, { calendarDate: FRIDAY })).toBe(false)
    expect(useStore.getState().S.active).toBeNull()
  })
})
