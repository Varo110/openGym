// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

const planCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

const mocks = vi.hoisted(() => ({ dayOverrideSheet: vi.fn() }))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', async importOriginal => ({
  ...await importOriginal(),
  dayOverrideSheet: mocks.dayOverrideSheet
}))

vi.stubGlobal('localStorage', {
  setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn()
})
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const routines = [
  { id: 'first', name: 'First very long routine', ex: [] },
  { id: 'second', name: 'Second very long routine', ex: [] }
]

let root
let host

function mountPlan() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Plan />))
  return host
}

function touchMove(target) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true })
  const dispatched = target.dispatchEvent(event)
  return { dispatched, event }
}

describe('Plan eight-day week panel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-23T12:00:00.000Z'))
    mocks.dayOverrideSheet.mockReset()
    useStore.setState({
      S: {
        ...JSON.parse(JSON.stringify(DEF)),
        routines,
        week: {},
        dayPlan: { '2026-02-23': ['first', 'second'] },
        programmes: { version: 1, definitions: [], cycles: [] }
      }
    })
  })

  afterEach(() => {
    if (root) act(() => root.unmount())
    root = null
    host?.remove()
    host = null
    vi.useRealTimers()
  })

  it('renders exactly today through day seven as consecutive ISO cells', () => {
    const panel = mountPlan().querySelector('.pweek')
    expect([...panel.querySelectorAll('.pday')].map(day => day.dataset.iso)).toEqual([
      '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26',
      '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'
    ])
  })

  it('stacks full-width accessible routine tags and opens their exact day once', () => {
    const panel = mountPlan().querySelector('.pweek')
    const today = panel.querySelector('.pday[data-iso="2026-02-23"]')
    const tags = [...today.querySelectorAll('.pday-tag')]

    expect(tags).toHaveLength(2)
    expect(tags.map(tag => tag.getAttribute('aria-label'))).toEqual(routines.map(routine => routine.name))
    expect(tags.every(tag => tag.getAttribute('title') === tag.getAttribute('aria-label'))).toBe(true)

    act(() => tags[0].click())
    expect(mocks.dayOverrideSheet).toHaveBeenCalledTimes(1)
    expect(mocks.dayOverrideSheet).toHaveBeenCalledWith('2026-02-23')
  })

  it('leaves vertical touch moves unprevented from the panel, a day, and a tag', () => {
    const panel = mountPlan().querySelector('.pweek')
    const today = panel.querySelector('.pday[data-iso="2026-02-23"]')
    const tag = today.querySelector('.pday-tag')

    for (const target of [panel, today, tag]) {
      const { dispatched, event } = touchMove(target)
      expect(dispatched).toBe(true)
      expect(event.defaultPrevented).toBe(false)
    }
  })

  it('owns layout, vertical touch action, full-width ellipsis, and today month contrast in CSS', () => {
    expect(planCss).toMatch(/\.pweek\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[^}]*touch-action:\s*pan-y[^}]*\}/s)
    expect(planCss).not.toMatch(/\.pweek\s*\{[^}]*touch-action:\s*pan-x/s)
    expect(planCss).toMatch(/\.pday-tag\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*text-overflow:\s*ellipsis[^}]*\}/s)
    expect(planCss).toMatch(/\.pday\.today\s+\.pday-month\s*\{[^}]*color:\s*var\(--on-acc\)[^}]*\}/s)
  })
})
