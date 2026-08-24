// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { SWIPE_GAP } from '../lib/swipe.js'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, sg) => ({
  id,
  ...(sg ? { sg } : {}),
  target: { mode: 'reps', sets: 1, reps: 5, weight: 60, bodyweight: false },
  sets: [{ phase: 'work', mode: 'reps', w: 60, r: 5, done: false }]
})

const fireEvent = {
  touchStart: (node, touches) => dispatchTouch(node, 'touchstart', touches),
  touchMove: (node, touches) => dispatchTouch(node, 'touchmove', touches),
  touchEnd: node => dispatchTouch(node, 'touchend', []),
  touchCancel: node => dispatchTouch(node, 'touchcancel', []),
}

function dispatchTouch(node, type, touches) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { configurable: true, value: touches })
  node.dispatchEvent(event)
  return event
}

function point(clientX, clientY) {
  return { clientX, clientY }
}

let root
let container
const originalScrollIntoView = Element.prototype.scrollIntoView

function renderWorkout(cur = 0, entries = null) {
  const S = clone(DEF)
  S.active = {
    id: 'swipe-test', d: '2026-08-14', start: Date.now(), routineId: null,
    name: 'Swipe test', bw: null, cur,
    entries: entries || [
      entry('1001', 'first-superset'),
      entry('1002', 'first-superset'),
      entry('1003'),
      entry('1004'),
    ]
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
  return container.querySelector('[data-testid="workout-swipe-area"]')
}

function slideCard() {
  return container.querySelector('[data-testid="workout-exercise-slide"]')
}

function peekCard() {
  return container.querySelector('[data-testid="workout-exercise-peek"]')
}

const SWIPE_WIDTH = 320

function transformedLeft(node, width = SWIPE_WIDTH) {
  const transform = node.style.transform
  const pixels = transform.match(/^translate3d\((-?[\d.]+)px, 0, 0\)$/)
  if (pixels) return Number(pixels[1])
  const percent = transform.match(/^translate3d\((-?100)%, 0, 0\)$/)
  if (percent) return Number(percent[1]) / 100 * width
  const calculated = transform.match(/^translate3d\(calc\((-?100)%((?: [+-] [\d.]+px)+)\), 0, 0\)$/)
  if (calculated) {
    const origin = Number(calculated[1]) / 100 * width
    const delta = [...calculated[2].matchAll(/ ([+-]) ([\d.]+)px/g)]
      .reduce((total, term) => total + Number(term[2]) * (term[1] === '-' ? -1 : 1), 0)
    return origin + delta
  }
  throw new Error(`Unsupported test transform: ${transform}`)
}

function mockHorizontalGeometry(node, width = SWIPE_WIDTH) {
  vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => {
    const left = transformedLeft(node, width)
    return { x: left, y: 0, left, right: left + width, top: 0, bottom: 400, width, height: 400 }
  })
}

function navButton(label) {
  return [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label)
}

function advanceTimers(ms) {
  act(() => vi.advanceTimersByTime(ms))
}

function settleSwipe() {
  advanceTimers(200)
}

function swipe(area, dx, dy, { settle = true } = {}) {
  let move
  act(() => {
    fireEvent.touchStart(area, [point(150, 100)])
    move = fireEvent.touchMove(area, [point(150 + dx, 100 + dy)])
    fireEvent.touchEnd(area)
  })
  if (settle) settleSwipe()
  return move
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(Date.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, prep: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
  else delete Element.prototype.scrollIntoView
})

describe('active workout exercise swipes', () => {
  it('centers the partner set row after a real-store superset transition', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const first = entry('1001', 'first-superset')
    const partner = entry('1002', 'first-superset')
    partner.target.sets = 2
    partner.sets = [
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: true },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: false },
    ]
    renderWorkout(0, [first, partner])
    const target = container.querySelectorAll('[data-exidx="1"] .setrow')[1]
    scrollIntoView.mockClear()

    act(() => container.querySelector('[data-exidx="0"] [role="checkbox"]').click())

    expect(useStore.getState().S.active.cur).toBe(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(target)
  })

  it('moves left and right by whole units, prevents horizontal scroll, and fires once per gesture', () => {
    const area = renderWorkout()
    let firstMove
    let repeatedMove

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      firstMove = fireEvent.touchMove(area, [point(60, 110)])
      repeatedMove = fireEvent.touchMove(area, [point(20, 110)])
      fireEvent.touchEnd(area)
    })

    expect(firstMove.defaultPrevented).toBe(true)
    expect(repeatedMove.defaultPrevented).toBe(true)
    expect(useStore.getState().S.active.cur).toBe(0)
    settleSwipe()
    expect(useStore.getState().S.active.cur).toBe(2)

    expect(swipe(area, 90, 10).defaultPrevented).toBe(true)
    expect(useStore.getState().S.active.cur).toBe(0)
  })

  it('rejects diagonal movement, does not wrap at either edge, and leaves a running rest untouched', () => {
    const area = renderWorkout()
    const rest = { left: 30, total: 30, endsAt: Date.now() + 30_000 }
    act(() => useUI.setState({ timer: rest }))

    const diagonal = swipe(area, -100, 80)
    expect(diagonal.defaultPrevented).toBe(false)
    expect(useStore.getState().S.active.cur).toBe(0)

    swipe(area, 90, 0)
    expect(useStore.getState().S.active.cur).toBe(0)

    swipe(area, -90, 0)
    swipe(area, -90, 0)
    expect(useStore.getState().S.active.cur).toBe(3)

    swipe(area, -90, 0)
    expect(useStore.getState().S.active.cur).toBe(3)
    expect(useUI.getState().timer).toEqual(rest)
  })

  it('does not navigate while a sheet is open', () => {
    const area = renderWorkout()
    act(() => useUI.setState({ sheets: [{ id: 'open-sheet' }] }))

    swipe(area, -90, 0)

    expect(useStore.getState().S.active.cur).toBe(0)
  })

  it('moves the current and next cards in lockstep with a visible gap', () => {
    const area = renderWorkout()
    const card = slideCard()
    let deadzoneMove
    let dragMove

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      deadzoneMove = fireEvent.touchMove(area, [point(143, 101)])
    })
    expect(deadzoneMove.defaultPrevented).toBe(false)
    expect(card.style.transform).toBe('')

    act(() => { dragMove = fireEvent.touchMove(area, [point(110, 105)]) })
    expect(dragMove.defaultPrevented).toBe(true)
    expect(slideCard()).toBe(card)
    expect(card.style.transform).toBe('translate3d(-40px, 0, 0)')
    expect(card.classList.contains('workout-swipe-transition')).toBe(false)
    const peek = peekCard()
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px - 40px), 0, 0)`)
    expect(peek.classList.contains('workout-swipe-transition')).toBe(false)

    mockHorizontalGeometry(card)
    mockHorizontalGeometry(peek)
    const currentBounds = card.getBoundingClientRect()
    const peekBounds = peek.getBoundingClientRect()
    expect(peekBounds.left - currentBounds.right).toBe(SWIPE_GAP)
    expect(currentBounds.right).toBeGreaterThan(0)
    expect(peekBounds.left).toBeLessThan(SWIPE_WIDTH)
    expect(useStore.getState().S.active.cur).toBe(0)
  })

  it('keeps the locked adjacent unit side by side and non-interactive while dragging left and right', () => {
    const area = renderWorkout(2)
    const card = slideCard()
    expect(peekCard()).toBeNull()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 102)])
    })
    let peek = peekCard()
    expect(peek).toBeTruthy()
    expect(peek.textContent).toContain('band squat')
    expect(peek.textContent).not.toContain('band squat row')
    expect(peek.nextElementSibling).toBe(slideCard())
    expect(peek.getAttribute('aria-hidden')).toBe('true')
    expect(peek.hasAttribute('inert')).toBe(true)
    expect(peek.style.pointerEvents).toBe('none')
    expect(card.style.transform).toBe('translate3d(-40px, 0, 0)')
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px - 40px), 0, 0)`)

    act(() => fireEvent.touchEnd(area))
    expect(peekCard()).toBe(peek)
    expect(card.style.transform).toBe('translate3d(0, 0, 0)')
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px), 0, 0)`)
    expect(card.classList.contains('workout-swipe-transition')).toBe(true)
    expect(peek.classList.contains('workout-swipe-transition')).toBe(true)
    settleSwipe()
    expect(peekCard()).toBeNull()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(190, 102)])
    })
    peek = peekCard()
    expect(peek).toBeTruthy()
    expect(peek.textContent).toContain('band single leg split squat')
    expect(peek.textContent).toContain('band lying straight leg raise')
    expect(card.style.transform).toBe('translate3d(40px, 0, 0)')
    expect(peek.style.transform).toBe(`translate3d(calc(-100% - ${SWIPE_GAP}px + 40px), 0, 0)`)

    mockHorizontalGeometry(card)
    mockHorizontalGeometry(peek)
    const previousBounds = peek.getBoundingClientRect()
    const currentBounds = card.getBoundingClientRect()
    expect(currentBounds.left - previousBounds.right).toBe(SWIPE_GAP)
    expect(previousBounds.right).toBeGreaterThan(0)
    expect(currentBounds.left).toBeLessThan(SWIPE_WIDTH)
    act(() => fireEvent.touchEnd(area))
    expect(peek.style.transform).toBe(`translate3d(calc(-100% - ${SWIPE_GAP}px), 0, 0)`)
    settleSwipe()
    expect(peekCard()).toBeNull()
  })

  it('does not render an outward peek at the first or last unit', () => {
    const area = renderWorkout()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(190, 100)])
    })
    expect(peekCard()).toBeNull()
    act(() => fireEvent.touchEnd(area))
    settleSwipe()

    swipe(area, -90, 0)
    swipe(area, -90, 0)
    expect(useStore.getState().S.active.cur).toBe(3)
    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 100)])
    })
    expect(peekCard()).toBeNull()
    act(() => fireEvent.touchEnd(area))
  })

  it('locks the peek direction when horizontal intent is first claimed', () => {
    const area = renderWorkout(2)

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 100)])
    })
    const lockedPeek = peekCard()
    expect(lockedPeek.textContent).toContain('band squat')
    expect(lockedPeek.textContent).not.toContain('band squat row')
    expect(lockedPeek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px - 40px), 0, 0)`)

    act(() => fireEvent.touchMove(area, [point(250, 100)]))
    expect(peekCard()).toBe(lockedPeek)
    expect(peekCard().textContent).toContain('band squat')
    expect(peekCard().textContent).not.toContain('band squat row')
    expect(peekCard().textContent).not.toContain('band single leg split squat')
    expect(slideCard().style.transform).toBe('translate3d(100px, 0, 0)')
    expect(lockedPeek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px + 100px), 0, 0)`)
    act(() => fireEvent.touchEnd(area))
    expect(useStore.getState().S.active.cur).toBe(2)
    expect(peekCard()).toBe(lockedPeek)
    expect(lockedPeek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px), 0, 0)`)
    settleSwipe()
    expect(peekCard()).toBeNull()
  })

  it('keeps both cards mounted through cancel and navigation, then resets and unmounts the adjacent card', () => {
    const area = renderWorkout(2)
    const card = slideCard()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 100)])
    })
    let peek = peekCard()
    expect(peek).toBeTruthy()
    act(() => fireEvent.touchEnd(area))
    expect(peekCard()).toBe(peek)
    expect(card.style.transform).toBe('translate3d(0, 0, 0)')
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px), 0, 0)`)
    settleSwipe()
    expect(peekCard()).toBeNull()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(60, 100)])
    })
    peek = peekCard()
    expect(peek.textContent).toContain('band squat')
    expect(peek.textContent).not.toContain('band squat row')
    act(() => fireEvent.touchEnd(area))
    expect(peekCard()).toBe(peek)
    expect(card.style.transform).toBe('translate3d(-100%, 0, 0)')
    expect(peek.style.transform).toBe('translate3d(0, 0, 0)')
    settleSwipe()
    expect(useStore.getState().S.active.cur).toBe(3)
    expect(card.style.transform).toBe('')
    expect(card.classList.contains('workout-swipe-transition')).toBe(false)
    expect(peekCard()).toBeNull()
  })

  it('slides the current and adjacent cards together for one 200ms navigation transition', () => {
    const area = renderWorkout()
    const card = slideCard()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(60, 105)])
    })
    const peek = peekCard()
    expect(card.style.transform).toBe('translate3d(-90px, 0, 0)')
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px - 90px), 0, 0)`)

    act(() => fireEvent.touchEnd(area))

    expect(useStore.getState().S.active.cur).toBe(0)
    expect(card.style.transform).toBe('translate3d(-100%, 0, 0)')
    expect(peekCard()).toBe(peek)
    expect(peek.style.transform).toBe('translate3d(0, 0, 0)')
    expect(card.classList.contains('workout-swipe-transition')).toBe(true)
    expect(peek.classList.contains('workout-swipe-transition')).toBe(true)
    expect(navButton('Next').disabled).toBe(true)

    advanceTimers(199)
    expect(useStore.getState().S.active.cur).toBe(0)
    expect(peekCard()).toBe(peek)
    advanceTimers(1)
    expect(useStore.getState().S.active.cur).toBe(2)
    expect(peekCard()).toBeNull()
    expect(card.style.transform).toBe('')
    expect(card.classList.contains('workout-swipe-transition')).toBe(false)
    expect(navButton('Next').disabled).toBe(false)
  })

  it('also completes synchronized navigation on transform transitionend without a second timer pass', () => {
    const area = renderWorkout()
    const card = slideCard()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(60, 100)])
      fireEvent.touchEnd(area)
    })
    expect(peekCard()).toBeTruthy()

    const unrelatedEnd = new Event('transitionend', { bubbles: true })
    Object.defineProperty(unrelatedEnd, 'propertyName', { value: 'opacity' })
    act(() => card.dispatchEvent(unrelatedEnd))
    expect(useStore.getState().S.active.cur).toBe(0)

    const transformEnd = new Event('transitionend', { bubbles: true })
    Object.defineProperty(transformEnd, 'propertyName', { value: 'transform' })
    act(() => card.dispatchEvent(transformEnd))
    expect(useStore.getState().S.active.cur).toBe(2)
    expect(card.style.transform).toBe('')
    expect(peekCard()).toBeNull()

    advanceTimers(200)
    expect(useStore.getState().S.active.cur).toBe(2)
  })

  it('springs both cards back on a short release or touch cancellation, then unmounts the adjacent card', () => {
    const area = renderWorkout(2)
    const card = slideCard()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 102)])
    })
    let peek = peekCard()
    act(() => fireEvent.touchEnd(area))

    expect(useStore.getState().S.active.cur).toBe(2)
    expect(card.style.transform).toBe('translate3d(0, 0, 0)')
    expect(peekCard()).toBe(peek)
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px), 0, 0)`)
    expect(card.classList.contains('workout-swipe-transition')).toBe(true)
    expect(peek.classList.contains('workout-swipe-transition')).toBe(true)
    advanceTimers(199)
    expect(card.style.transform).toBe('translate3d(0, 0, 0)')
    expect(peekCard()).toBe(peek)
    advanceTimers(1)
    expect(card.style.transform).toBe('')
    expect(card.classList.contains('workout-swipe-transition')).toBe(false)
    expect(peekCard()).toBeNull()

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(50, 100)])
    })
    peek = peekCard()
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px - 100px), 0, 0)`)
    act(() => fireEvent.touchCancel(area))
    expect(useStore.getState().S.active.cur).toBe(2)
    expect(card.style.transform).toBe('translate3d(0, 0, 0)')
    expect(peekCard()).toBe(peek)
    expect(peek.style.transform).toBe(`translate3d(calc(100% + ${SWIPE_GAP}px), 0, 0)`)
    settleSwipe()
    expect(card.style.transform).toBe('')
    expect(peekCard()).toBeNull()
  })

  it('applies resistance at a navigation edge and springs back without wrapping', () => {
    const area = renderWorkout()
    const card = slideCard()
    let move

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      move = fireEvent.touchMove(area, [point(250, 100)])
    })
    expect(move.defaultPrevented).toBe(true)
    expect(card.style.transform).toBe('translate3d(35px, 0, 0)')

    act(() => fireEvent.touchEnd(area))
    expect(useStore.getState().S.active.cur).toBe(0)
    expect(card.style.transform).toBe('translate3d(0, 0, 0)')
    advanceTimers(200)
    expect(card.style.transform).toBe('')
  })

  it('has no transform at rest and clears a live drag and peek on store or UI renders', () => {
    const area = renderWorkout()
    const card = slideCard()
    expect(card.style.transform).toBe('')

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 100)])
    })
    expect(card.style.transform).toBe('translate3d(-40px, 0, 0)')
    expect(peekCard()).toBeTruthy()

    act(() => {
      const S = clone(useStore.getState().S)
      S.active.entries[0].sets[0].done = true
      useStore.setState({ S })
    })
    expect(card.style.transform).toBe('')
    expect(card.classList.contains('workout-swipe-transition')).toBe(false)
    expect(peekCard()).toBeNull()
    act(() => fireEvent.touchEnd(area))
    expect(useStore.getState().S.active.cur).toBe(0)

    act(() => {
      fireEvent.touchStart(area, [point(150, 100)])
      fireEvent.touchMove(area, [point(110, 100)])
    })
    expect(peekCard()).toBeTruthy()
    act(() => useUI.setState({ timer: { left: 30, total: 30, endsAt: Date.now() + 30_000 } }))
    expect(card.style.transform).toBe('')
    expect(peekCard()).toBeNull()
  })
})
