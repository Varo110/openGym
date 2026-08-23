import { describe, expect, it } from 'vitest'
import { strengthOf } from '../lib/recovery.js'

const now = Date.parse('2026-08-11T12:00:00Z')

function workout(daysAgo, entries, startOverride = null) {
  const d = new Date(now - daysAgo * 86400000).toISOString().slice(0, 10)
  const start = startOverride ?? (now - daysAgo * 86400000)
  return { d, start, unit: 'kg', entries }
}

describe('strengthOf decay (real exercise ids)', () => {
  it('recent squat keeps its muscles at full strength', () => {
    const s = strengthOf([workout(2, [{ id: '0852', sets: [{ w: 100, r: 5, done: true }] }])], now)
    console.log('RECENT:', JSON.stringify(Object.entries(s).filter(([, v]) => v > 0.5).map(([k, v]) => [k, v])))
    expect(s.quadriceps).toBe(1)
  })

  it('60-day-old squat decays its muscles', () => {
    const s = strengthOf([workout(60, [{ id: '0852', sets: [{ w: 100, r: 5, done: true }] }])], now)
    console.log('OLD:', JSON.stringify(Object.entries(s).filter(([, v]) => v > 0.5).map(([k, v]) => [k, v])))
    expect(s.quadriceps).toBeLessThan(0.875)
  })

  it('import artifact: recent start, old training day -> still decayed', () => {
    const s = strengthOf([workout(60, [{ id: '0852', sets: [{ w: 100, r: 5, done: true }] }], now - 2 * 86400000)], now)
    expect(s.quadriceps).toBeLessThan(0.875)
  })

  it('late log: old start, recent training day -> full strength', () => {
    const s = strengthOf([workout(2, [{ id: '0852', sets: [{ w: 100, r: 5, done: true }] }], now - 90 * 86400000)], now)
    expect(s.quadriceps).toBe(1)
  })
})
