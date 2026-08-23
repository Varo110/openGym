import { describe, it, expect } from 'vitest'
import { estimate1RM, bestSetOf, e1rmSeries, best1RM, is1RMRecord, REP_CAP, FORMULAS, percentage1RMForExercise, percentage1RMDetailsForExercise, normalizePercentageSource, PERCENTAGE_SOURCES, E1RM_FULL_RETENTION_MS, E1RM_HALF_LIFE_MS, E1RM_FLOOR } from './onerm.js'

describe('estimate1RM', () => {
  it('returns the load unchanged for a single rep', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(62.5, 1)).toBe(62.5)
  })

  it('matches Epley by hand across the usual rep ranges', () => {
    expect(estimate1RM(100, 5)).toBe(116.7)   // 100 · (1 + 5/30)
    expect(estimate1RM(100, 10)).toBe(133.3)
    expect(estimate1RM(80, 8)).toBe(101.3)
    expect(estimate1RM(60, 3)).toBe(66)
  })

  it('rounds to one decimal', () => {
    expect(estimate1RM(101.25, 7)).toBe(124.9)
    expect(Number.isInteger(estimate1RM(100, 3) * 10)).toBe(true)
  })

  it('refuses reps beyond the cap rather than guessing', () => {
    expect(estimate1RM(100, REP_CAP)).not.toBeNull()
    expect(estimate1RM(100, REP_CAP + 1)).toBeNull()
    expect(estimate1RM(60, 30)).toBeNull()
  })

  it('rejects invalid, zero and negative input', () => {
    expect(estimate1RM(0, 5)).toBeNull()
    expect(estimate1RM(-100, 5)).toBeNull()
    expect(estimate1RM(100, 0)).toBeNull()
    expect(estimate1RM(100, -3)).toBeNull()
    expect(estimate1RM(undefined, 5)).toBeNull()
    expect(estimate1RM(100, undefined)).toBeNull()
    expect(estimate1RM(NaN, 5)).toBeNull()
    expect(estimate1RM(Infinity, 5)).toBeNull()
    expect(estimate1RM('', '')).toBeNull()
  })

  it('accepts numeric strings, the shape number inputs arrive in', () => {
    expect(estimate1RM('100', '5')).toBe(116.7)
  })

  it('offers the other documented formulas and agrees with them at low reps', () => {
    expect(estimate1RM(100, 5, 'brzycki')).toBe(112.5)
    expect(estimate1RM(100, 5, 'lombardi')).toBe(117.5)
    expect(Object.keys(FORMULAS)).toContain('epley')
  })

  it('keeps the formulas within a few percent up to 8 reps, and diverges most at the cap', () => {
    const spread = r => Math.max(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
      - Math.min(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
    expect(spread(1)).toBe(0)                       // one rep is measured, not estimated
    for (let r = 2; r <= 8; r++) expect(spread(r)).toBeLessThan(6)
    const upTo = []
    for (let r = 1; r < REP_CAP; r++) upTo.push(spread(r))
    expect(spread(REP_CAP)).toBeGreaterThan(Math.max(...upTo))   // why REP_CAP exists
  })

  it('falls back to the default for an unknown formula name', () => {
    expect(estimate1RM(100, 5, 'nope')).toBe(estimate1RM(100, 5))
  })
})

describe('bestSetOf', () => {
  it('picks the highest estimate, not the heaviest set', () => {
    const entry = { id: 'x', sets: [
      { w: 100, r: 5, done: true },   // 116.7
      { w: 110, r: 3, done: true },   // 121.0
      { w: 120, r: 1, done: true }    // 120.0
    ] }
    expect(bestSetOf(entry)).toEqual({ est: 121, w: 110, r: 3 })
  })

  it('ignores sets that were never checked off', () => {
    const entry = { id: 'x', sets: [{ w: 100, r: 5, done: true }, { w: 200, r: 5, done: false }] }
    expect(bestSetOf(entry).w).toBe(100)
  })

  it('ignores topW, which carries no rep count', () => {
    const entry = { id: 'x', topW: 200, sets: [{ w: 100, r: 5, done: true }] }
    expect(bestSetOf(entry).est).toBe(116.7)
  })

  it('returns null for cardio and timed entries', () => {
    expect(bestSetOf({ id: 'c', sets: [{ min: 20, speed: 9, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 0, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 20, done: true }] })).toBeNull()
  })

  it('survives a missing or empty entry', () => {
    expect(bestSetOf(null)).toBeNull()
    expect(bestSetOf({ sets: [] })).toBeNull()
  })
})

const S = {
  workouts: [
    { d: '2026-01-01', start: 1, entries: [{ id: 'bench', sets: [{ w: 80, r: 5, done: true }] }] },
    { d: '2026-01-08', start: 2, entries: [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }] },
    { d: '2026-01-15', start: 3, entries: [{ id: 'bench', sets: [{ w: 90, r: 5, done: true }, { w: 90, r: 3, done: false }] }] },
    { d: '2026-01-22', start: 4, entries: [{ id: 'bench', sets: [{ w: 85, r: 5, done: true }] }] },
    { d: '2026-01-29', start: 5, entries: [{ id: 'run', sets: [{ min: 30, speed: 10, done: true }] }] }
  ]
}

describe('e1rmSeries / best1RM', () => {
  it('yields one chronological point per workout that produced an estimate', () => {
    const pts = e1rmSeries(S, 'bench')
    expect(pts.map(p => p.d)).toEqual(['2026-01-01', '2026-01-15', '2026-01-22'])
    expect(pts.map(p => p.y)).toEqual([93.3, 105, 99.2])
  })

  it('reports the all-time best with the set behind it', () => {
    expect(best1RM(S, 'bench')).toEqual({ est: 105, w: 90, r: 5, d: '2026-01-15', t: 3 })
  })

  it('has nothing to say about cardio or an unknown exercise', () => {
    expect(e1rmSeries(S, 'run')).toEqual([])
    expect(best1RM(S, 'run')).toBeNull()
    expect(best1RM(S, 'nope')).toBeNull()
    expect(best1RM({ workouts: [] }, 'bench')).toBeNull()
    expect(best1RM({}, 'bench')).toBeNull()
  })
})

describe('is1RMRecord', () => {
  it('flags a session that beats every previous estimate', () => {
    const rec = is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 95, r: 5, done: true }] })
    expect(rec).toEqual({ est: 110.8, w: 95, r: 5, prev: 105 })
  })

  it('stays quiet when the session does not beat the record', () => {
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 90, r: 5, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 80, r: 5, done: true }] })).toBeNull()
  })

  it('counts the first ever estimate as a record', () => {
    const rec = is1RMRecord(S, 'deadlift', { id: 'deadlift', sets: [{ w: 140, r: 3, done: true }] })
    expect(rec.prev).toBe(0)
    expect(rec.est).toBe(154)
  })

  it('says nothing for a timed or unfinished entry', () => {
    expect(is1RMRecord(S, 'plank', { id: 'plank', sets: [{ sec: 90, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 200, r: 5, done: false }] })).toBeNull()
  })
})


describe('warm-up sets and 1RM', () => {
  const ENTRY = { id: 'warm-test', sets: [
    { w: 20, r: 8, done: true, warmup: true },
    { w: 80, r: 5, done: true },
  ] }

  it('does not let a ticked-off warm-up set set or raise the estimated 1RM', () => {
    const working = { id: 'warm-test', sets: [{ w: 80, r: 5, done: true }] }
    expect(bestSetOf(ENTRY)).toEqual(bestSetOf(working))
    expect(best1RM({ workouts: [{ entries: [ENTRY] }] }, 'warm-test')).toEqual(
      best1RM({ workouts: [{ entries: [working] }] }, 'warm-test'),
    )
  })
})

describe('percentage 1RM sources', () => {
  const state = {
    unit: 'kg',
    workouts: [
      { d: '2026-01-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 120, r: 5, done: true }] }] },
      { d: '2026-02-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }] }] },
      { d: '2026-03-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 70, r: 5, done: true }] }] },
      { d: '2026-03-15', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 5, done: true }] }] },
    ]
  }
  const now = Date.parse('2026-04-02T12:00:00Z')

  it('offers exactly Adaptive and Latest session, with legacy values mapping to Adaptive', () => {
    expect(PERCENTAGE_SOURCES).toEqual(['adaptive', 'latest'])
    expect(normalizePercentageSource()).toBe('adaptive')
    expect(normalizePercentageSource('adaptive')).toBe('adaptive')
    expect(normalizePercentageSource('latest-session')).toBe('latest')
    expect(normalizePercentageSource('current_1rm_percentage')).toBe('adaptive')
    expect(normalizePercentageSource('highest')).toBe('adaptive')
    expect(normalizePercentageSource('average3')).toBe('adaptive')
  })

  it('uses the median of the latest three session-best estimates for Adaptive', () => {
    const adaptive = percentage1RMDetailsForExercise(state, 'bench', 'adaptive', { now })
    expect(adaptive.sessions.map(session => session.est)).toEqual([93.3, 81.7, 70])
    expect(adaptive.median).toBe(81.7)
    expect(adaptive.latestDate).toBe('2026-03-15')
    expect(adaptive.retention).toBe(1)
    expect(adaptive.estimate).toBe(81.7)
    expect(percentage1RMForExercise(state, 'bench', 'adaptive', { now })).toBe(81.7)
  })

  it('uses the latest compatible session without retention decay for Latest session', () => {
    const latest = percentage1RMDetailsForExercise(state, 'bench', 'latest', { now })
    expect(latest.estimate).toBe(93.3)
    expect(latest.sessions).toHaveLength(1)
    expect(latest.latestDate).toBe('2026-03-15')
    expect(latest.retention).toBe(1)
  })

  it('uses the arithmetic midpoint with two sessions and decays Adaptive from the latest date', () => {
    const twoSessions = {
      unit: 'kg',
      workouts: [
        state.workouts[2],
        { d: '2026-02-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }] }] }
      ]
    }
    const details = percentage1RMDetailsForExercise(twoSessions, 'bench', 'adaptive', { now: Date.parse('2026-04-02T12:00:00Z') })
    expect(details.median).toBe(75.9)
    expect(details.retention).toBeCloseTo(0.5 ** ((11 * 24 * 60 * 60 * 1000) / E1RM_HALF_LIFE_MS), 10)
    expect(details.estimate).toBe(Math.round(details.median * details.retention * 10) / 10)
    expect(E1RM_FULL_RETENTION_MS).toBe(21 * 24 * 60 * 60 * 1000)
    expect(E1RM_FLOOR).toBe(0.5)
  })

  it('selects the newest compatible session by workout date rather than array position', () => {
    const reversed = { unit: 'kg', workouts: [state.workouts[3], state.workouts[2]] }
    const latest = percentage1RMDetailsForExercise(reversed, 'bench', 'latest', { now })
    expect(latest.latestDate).toBe('2026-03-15')
    expect(latest.estimate).toBe(93.3)
  })

  it('excludes warm-ups, incomplete, timed, high-rep, wrong-id, and wrong-unit rows', () => {
    const invalid = {
      unit: 'kg',
      workouts: [{ d: '2026-04-01', unit: 'kg', entries: [
        { id: 'other', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', w: 200, r: 5, done: true }] },
        { id: 'bench', target: { mode: 'time' }, sets: [{ phase: 'work', mode: 'time', w: 200, r: 5, sec: 60, done: true }] },
        { id: 'bench', target: { mode: 'reps' }, sets: [
          { phase: 'warmup', mode: 'reps', w: 200, r: 5, done: true },
          { phase: 'work', mode: 'reps', w: 200, r: 13, done: true },
          { phase: 'work', mode: 'reps', w: 200, r: 5, done: false },
          { phase: 'work', mode: 'reps', unit: 'lb', w: 200, r: 5, done: true }
        ]}
      ]}]
    }
    expect(percentage1RMForExercise(invalid, 'bench', 'adaptive', { now })).toBeNull()
    expect(percentage1RMForExercise({ unit: 'kg', workouts: [] }, 'bench', 'adaptive', { now })).toBeNull()
  })
})
