import { describe, expect, it } from 'vitest'
import { current1RMForExercise, strengthOf, sessionEstimates } from '../lib/recovery.js'

const NOW = Date.parse('2026-08-11T12:00:00Z')
const DAY = 86400000
const w = (daysAgo, entries, bw = 74) => {
  const start = NOW - daysAgo * DAY
  return { d: new Date(start).toISOString().slice(0, 10), start, unit: 'kg', bw, entries }
}
const set = (wgt, reps, done = true) => ({ w: wgt, r: reps, done })
const squat = (sets, id = '0852') => ({ id, sets })
const pullup = (sets) => ({ id: '1429', sets })

describe('intensity-aware strength', () => {
  it('a heavy session this week keeps the muscle gold (ratio 1)', () => {
    const s = strengthOf([w(2, [squat([set(100, 5)])])], NOW)
    expect(s.quadriceps).toBe(1)
    expect(s.gluteal).toBe(1)
  })

  it('a light session this week does NOT inflate: the old heavy PR still dominates', () => {
    const s = strengthOf([w(30, [squat([set(120, 3)])]), w(1, [squat([set(40, 10)])])], NOW)
    expect(s.quadriceps).toBeGreaterThan(0.85)
    expect(s.quadriceps).toBeLessThan(1)
  })

  it('months of light work fade the muscle well below gold', () => {
    const workouts = [w(90, [squat([set(120, 3)])])]
    for (const days of [83, 76, 69, 62, 55, 48, 41, 34, 27, 20, 13, 6, 2]) workouts.push(w(days, [squat([set(40, 10)])]))
    const s = strengthOf(workouts, NOW)
    expect(s.quadriceps).toBeGreaterThanOrEqual(0.5)
    expect(s.quadriceps).toBeLessThan(0.65)
  })

  it('bodyweight exercises estimate with bodyweight + added weight', () => {
    const s = strengthOf([w(2, [pullup([set(0, 8)])])], NOW)
    expect(s['upper-back']).toBe(1)
    const ests = sessionEstimates([w(2, [pullup([set(0, 8)])])], NOW)
    expect(ests.get('1429').best).toBeCloseTo(74 * (1 + 8 / 30), 6)
  })

  it('warm-ups are excluded from the estimate', () => {
    const warmup = { w: 60, r: 5, done: true, phase: 'warmup' }
    const ests = sessionEstimates([w(2, [squat([warmup, set(100, 5)])])], NOW)
    expect(ests.get('0852').best).toBeCloseTo(116.66666666666667, 6)
  })

  it('high-rep sets are capped at REP_CAP so they cannot inflate the estimate', () => {
    const ests = sessionEstimates([w(2, [squat([set(60, 25)])])], NOW)
    expect(ests.get('0852').best).toBeCloseTo(84, 6)
  })

  it('rejects a timed row carrying stale repetitions from current 1RM history', () => {
    const timed = { w: 200, r: 12, sec: 60, mode: 'time', done: true }
    const workout = w(2, [squat([timed], '0042')])
    const state = { unit: 'kg', workouts: [workout] }
    expect(sessionEstimates([workout], NOW).has('0042')).toBe(false)
    expect(current1RMForExercise(state, '0042', NOW)).toBeNull()
  })

  it('timed-hold-only muscles keep the time-based fallback', () => {
    const s = strengthOf([w(2, [{ id: '1429', sets: [{ sec: 90, done: true }] }])], NOW)
    expect(typeof s['upper-back']).toBe('number')
    expect(s['upper-back']).toBeGreaterThanOrEqual(0.5)
  })
})
