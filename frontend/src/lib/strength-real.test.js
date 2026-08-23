import { describe, expect, it } from 'vitest'
import { strengthOf } from '../lib/recovery.js'

const now = Date.parse('2026-08-11T12:00:00Z')

// realistic: a back day old enough to be in the 21-day / 60-day-half-life decay band
const w = (daysAgo, entries) => {
  const start = now - daysAgo * 86400000
  return { d: new Date(start).toISOString().slice(0, 10), start, unit: 'kg', entries }
}

describe('strengthOf realistic long-range', () => {
  it('shows graduated values across muscles trained at different times', () => {
    const workouts = [w(40, [{ id: '1429', sets: [{ w: 0, r: 8, done: true }] }])]
    const s = strengthOf(workouts, now)
    console.log('VALUES:', JSON.stringify(Object.entries(s).map(([k, v]) => [k, v.toFixed(3)])))
    const gold = Object.entries(s).filter(([, v]) => v >= 0.875).length
    const mid = Object.entries(s).filter(([, v]) => v >= 0.55 && v < 0.875).length
    console.log('GOLD(>=.875):', gold, 'MID:', mid, 'FLOOR:', Object.entries(s).filter(([, v]) => v < 0.55).length)
    expect(mid).toBeGreaterThan(0)
  })
})
