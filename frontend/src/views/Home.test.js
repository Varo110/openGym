import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { todayISO } from '../lib/format.js'

const mocks = vi.hoisted(() => ({
  state: null,
  noop: vi.fn(),
  startFlow: vi.fn(),
  startSessionSheet: vi.fn(),
  dayOverrideSheet: vi.fn(),
  bwSheet: vi.fn(),
  goalSheet: vi.fn(),
  calendarSheet: vi.fn(),
  loadStarterPlan: vi.fn(),
  useState: vi.fn(initial => [initial, vi.fn()])
}))

vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return { ...actual, useState: mocks.useState }
})
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector(mocks.state) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.noop }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: mocks.bwSheet,
  goalSheet: mocks.goalSheet,
  dayOverrideSheet: mocks.dayOverrideSheet,
  calendarSheet: mocks.calendarSheet,
  startFlow: mocks.startFlow,
  startSessionSheet: mocks.startSessionSheet,
  loadStarterPlan: mocks.loadStarterPlan,
  bwDeltaColor: () => 'var(--acc)'
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Icon.jsx', () => ({ default: () => null }))

const source = readFileSync(new URL('./Home.jsx', import.meta.url), 'utf8')

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  const children = node.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return findElement(children, predicate)
}

describe('Home unit-compatible workout count contract', () => {
  it('uses the canonical current-unit workout collection for dots and counts', () => {
    expect(source).toContain('workoutsForUnit')
    expect(source).toContain('const unitWorkouts = workoutsForUnit(S)')
    expect(source).toContain('unitWorkouts.map(w => w.d)')
    expect(source).toContain('unitWorkouts.filter(w => weekKey(w.d)')
    expect(source).toContain('unitWorkouts.length')
  })
})

describe('Home multi-session start affordance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 27, 12))
    vi.clearAllMocks()
    const iso = todayISO()
    const routines = [
      { id: 'home-1', name: 'Long home session one', emoji: null, ex: [{ id: 'lift-1' }] },
      { id: 'home-2', name: 'Home session two', emoji: null, ex: [{ id: 'lift-2' }] }
    ]
    mocks.state = {
      S: {
        unit: 'kg', bodyweight: [], routines, week: {}, dayPlan: { [iso]: routines.map(r => r.id) },
        workouts: [], active: null
      },
      user: null
    }
  })

  it('renders every planned routine and makes Start open the picker for multiple plans', async () => {
    const { default: Home } = await import('./Home.jsx')
    const tree = Home()
    const start = findElement(tree, node => node.props?.['aria-label'] === 'Start session')
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('class="ttl home-routine-list"')
    expect(html).toContain('class="home-routine">Long home session one</span>')
    expect(html).toContain('class="home-routine">Home session two</span>')
    expect(html).toContain('aria-label="Start session"')
    expect(start).toBeTruthy()
    expect(start.props.onClick).toEqual(expect.any(Function))
    expect(start.props.variant).toBe('primary')
    expect(start.props.size).toBe('sm')

    start.props.onClick()

    expect(mocks.startSessionSheet).toHaveBeenCalledTimes(1)
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })

  it('opens the picker for the date selected in the week strip', async () => {
    const selectedISO = '2026-07-28'
    mocks.state.S.dayPlan = { [selectedISO]: mocks.state.S.routines.map(r => r.id) }
    mocks.useState
      .mockImplementationOnce(initial => [initial, vi.fn()])
      .mockImplementationOnce(() => [selectedISO, vi.fn()])

    const { default: Home } = await import('./Home.jsx')
    const start = findElement(Home(), node => node.props?.['aria-label'] === 'Start session')

    expect(start).toBeTruthy()
    start.props.onClick()

    expect(mocks.startSessionSheet).toHaveBeenCalledWith(selectedISO)
    expect(mocks.startFlow).not.toHaveBeenCalled()
  })
})

describe('Home completed planned-session guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 27, 12))
    vi.clearAllMocks()
    const iso = todayISO()
    const routine = { id: 'push', name: 'Push', emoji: null, ex: [{ id: 'lift' }] }
    mocks.state = {
      S: {
        unit: 'kg', bodyweight: [], routines: [routine], week: {}, dayPlan: { [iso]: ['push'] },
        workouts: [{ d: iso, routineId: 'push', unit: 'kg', entries: [] }], active: null
      },
      user: null
    }
  })

  it('renders Done and opens choose-another instead of starting a completed sole plan', async () => {
    const { default: Home } = await import('./Home.jsx')
    const tree = Home()
    const row = findElement(tree, node => node.props?.className === 'today-row')
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('>Done</span>')
    expect(html).not.toContain('>Start</span>')
    expect(row).toBeTruthy()

    row.props.onClick()

    expect(mocks.startFlow).not.toHaveBeenCalled()
    expect(mocks.startSessionSheet).toHaveBeenCalledTimes(1)
  })

  it('shows a durable Programme finish-and-skip disposition on the Today row', async () => {
    const programmeRoutine = { id: 'programme-routine', name: 'Programme push', emoji: null, ex: [{ id: 'lift' }] }
    const instanceId = 'pi:cycle-1:programme-session'
    mocks.state.S.week = {}
    mocks.state.S.dayPlan = {}
    mocks.state.S.programmes = {
      version: 1,
      skippedInstanceIds: [instanceId],
      cycles: [{
        id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-07-27T00:00:00Z',
        timeZone: 'UTC', week1StartDate: '2026-07-27',
        snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
          id: 'programme-session', routineId: programmeRoutine.id, routineSnapshot: programmeRoutine
        }] }] }] }
      }]
    }

    const { default: Home } = await import('./Home.jsx')
    const html = renderToStaticMarkup(Home())
    expect(html).toContain('Finish and skip')
    expect(html).toContain('Programme push')
  })

  it('labels today programme work with its programme and routine, and colours its week dot', async () => {
    mocks.state.S.week = {}
    mocks.state.S.dayPlan = {}
    const programmeRoutine = { id: 'programme-routine', name: 'Programme push', emoji: null, ex: [{ id: 'lift' }] }
    mocks.state.S.programmes = {
      version: 1,
      definitions: [{ id: 'programme-1', name: 'Summer block', colour: 'sky' }],
      cycles: [{
        id: 'cycle-colour', programmeId: 'programme-1', status: 'active', createdAt: '2026-07-27T00:00:00Z',
        timeZone: 'UTC', week1StartDate: '2026-07-27',
        programmeSnapshot: { name: 'Summer block', colour: 'sky' },
        snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{
          id: 'programme-session', routineId: programmeRoutine.id, routineSnapshot: programmeRoutine
        }] }] }] }
      }]
    }

    const { default: Home } = await import('./Home.jsx')
    const html = renderToStaticMarkup(Home())
    expect(html).toContain('Summer block')
    expect(html).toContain('Programme push')
    expect(html).toContain('background:var(--blue)')
  })

  it('renders the Programme queue date in its persisted timezone rather than the device date', async () => {
    vi.setSystemTime(new Date('2026-02-23T00:30:00Z'))
    mocks.state.S.week = {}
    mocks.state.S.dayPlan = {}
    mocks.state.S.programmes = {
      version: 1,
      timeZone: 'America/Los_Angeles',
      cycles: [{
        id: 'cycle-travel', programmeId: 'programme-travel', status: 'active', createdAt: '2026-02-01T00:00:00Z',
        timeZone: 'America/Los_Angeles', week1StartDate: '2026-02-16',
        snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 7, sessions: [{
          id: 'programme-sunday', routineId: 'programme-routine', routineSnapshot: {
            id: 'programme-routine', name: 'Programme Sunday', emoji: null, ex: [{ id: 'lift' }]
          }
        }] }] }] }
      }]
    }

    const { default: Home } = await import('./Home.jsx')
    expect(renderToStaticMarkup(Home())).toContain('Programme Sunday')
  })
})
