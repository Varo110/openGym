import { describe, expect, it } from 'vitest'
import { resistedSwipeOffset, SWIPE_GAP, swipeDecision } from './swipe.js'

describe('SWIPE_GAP', () => {
  it('keeps adjacent workout screens 12px apart', () => {
    expect(SWIPE_GAP).toBe(12)
  })
})

describe('swipeDecision', () => {
  it('accepts the exact default threshold and a configured threshold', () => {
    expect(swipeDecision(70, 0)).toBe('prev')
    expect(swipeDecision(40, 0, { threshold: 40 })).toBe('prev')
  })

  it('rejects horizontal movement below the threshold', () => {
    expect(swipeDecision(69, 0)).toBeNull()
  })

  it('rejects a diagonal gesture with too much vertical movement', () => {
    expect(swipeDecision(100, 80)).toBeNull()
  })

  it('rejects a gesture at the exact horizontal-to-vertical ratio', () => {
    expect(swipeDecision(75, 50)).toBeNull()
  })

  it('maps negative horizontal movement to next', () => {
    expect(swipeDecision(-70, 0)).toBe('next')
  })
})

describe('resistedSwipeOffset', () => {
  it('resists outward movement at the first and last unit', () => {
    expect(resistedSwipeOffset(100, { atStart: true })).toBe(35)
    expect(resistedSwipeOffset(-100, { atEnd: true })).toBe(-35)
  })

  it('leaves movement toward an available unit unchanged', () => {
    expect(resistedSwipeOffset(-100, { atStart: true })).toBe(-100)
    expect(resistedSwipeOffset(100, { atEnd: true })).toBe(100)
  })

  it('supports a custom resistance and rejects non-finite input', () => {
    expect(resistedSwipeOffset(80, { atStart: true, resistance: 0.5 })).toBe(40)
    expect(resistedSwipeOffset(Infinity, { atStart: true })).toBe(0)
  })
})
