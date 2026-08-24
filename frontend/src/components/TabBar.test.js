import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { todayISO } from '../lib/format.js'

const mocks = vi.hoisted(() => ({
  state: null,
  nav: vi.fn(),
  onStart: vi.fn(),
  stopTimers: vi.fn(),
  startSessionSheet: vi.fn(),
  resumeWeeklySession: vi.fn()
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useLocation: () => ({ pathname: '/home' })
}))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector(mocks.state) }))

vi.mock('../sheets.jsx', () => ({
  startSessionSheet: mocks.startSessionSheet,
  resumeWeeklySession: mocks.resumeWeeklySession
}))
vi.mock('../components/Icon.jsx', () => ({ default: () => null }))
vi.mock('../lib/i18n.js', () => ({ t: value => value }))

const source = readFileSync(new URL('./TabBar.jsx', import.meta.url), 'utf8')

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

describe('TabBar timer navigation barrier', () => {
  it('keeps app-global timers running while navigating tabs', () => {
    const barrier = source.slice(source.indexOf('const navigateTab'), source.indexOf('const Tab'))
    expect(barrier).not.toContain('useUI.getState().stopTimers()')
    expect(barrier).toContain('nav(to)')

    const startWorkout = source.slice(source.indexOf('const startWorkout'), source.indexOf('const navigateTab'))
    expect(startWorkout).not.toContain('stopTimers')
  })
})

describe('TabBar completed planned-session guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 27, 12))
    vi.clearAllMocks()
    const iso = todayISO()
    mocks.state = {
      S: {
        unit: 'kg', routines: [{ id: 'push', name: 'Push', ex: [{ id: 'lift' }] }],
        week: {}, dayPlan: { [iso]: ['push'] },
        workouts: [{ d: iso, routineId: 'push', unit: 'kg', entries: [] }], active: null
      },
      user: { id: 'user-1' },
      isGuest: () => false
    }
  })

  it('renders Done and opens choose-another without forwarding a completed plan to start', async () => {
    const { default: TabBar } = await import('./TabBar.jsx')
    const tree = TabBar({ onStart: mocks.onStart })
    const startButton = findElement(tree, node => node.props?.className === 'start')
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('>Done</span>')
    expect(html).not.toContain('>Start</span>')
    expect(startButton).toBeTruthy()

    startButton.props.onClick()

    expect(mocks.onStart).not.toHaveBeenCalled()
    expect(mocks.startSessionSheet).toHaveBeenCalledTimes(1)
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('renders Resume and recovers an explicitly early-finished plan', async () => {
    mocks.state.S.workouts = [{
      d: todayISO(), routineId: 'push', plannedComplete: false, unit: 'kg', entries: []
    }]
    const { default: TabBar } = await import('./TabBar.jsx')
    const tree = TabBar({ onStart: mocks.onStart })
    const startButton = findElement(tree, node => node.props?.className === 'start rec')
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('>Resume</span>')
    expect(html).not.toContain('>Start</span>')
    startButton.props.onClick()

    expect(mocks.onStart).not.toHaveBeenCalled()
    expect(mocks.resumeWeeklySession).toHaveBeenCalledWith({
      source: 'classic', routineId: 'push', calendarDate: todayISO()
    })
    expect(mocks.startSessionSheet).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('renders Done after an early-finished Repeat follows a completed plan', async () => {
    mocks.state.S.workouts = [
      { d: todayISO(), routineId: 'push', plannedComplete: true, unit: 'kg', entries: [] },
      { d: todayISO(), routineId: 'push', plannedComplete: false, unit: 'kg', entries: [] },
    ]
    const { default: TabBar } = await import('./TabBar.jsx')
    const html = renderToStaticMarkup(TabBar({ onStart: mocks.onStart }))

    expect(html).toContain('>Done</span>')
    expect(html).not.toContain('>Incomplete</span>')
    expect(html).not.toContain('>Start</span>')
  })

  it('renders a converted-classic completion as Done and non-startable', async () => {
    mocks.state.S.workouts = [{
      d: todayISO(), routineId: 'push', plannedComplete: true, unit: 'kg', entries: [],
      programmeId: 'converted-programme', classicConversion: true
    }]
    const { default: TabBar } = await import('./TabBar.jsx')
    const tree = TabBar({ onStart: mocks.onStart })
    const startButton = findElement(tree, node => node.props?.className === 'start')
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('>Done</span>')
    expect(html).not.toContain('>Start</span>')
    startButton.props.onClick()
    expect(mocks.onStart).not.toHaveBeenCalled()
    expect(mocks.startSessionSheet).toHaveBeenCalledTimes(1)
  })
})