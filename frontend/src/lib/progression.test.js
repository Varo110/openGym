import { describe, it, expect } from 'vitest'
import {
  readSession, sessionsFor, stallCount, nextPrescription, applyPrescription,
  policyFor, targetKindFor, defaultIncrement, POLICIES_FOR, DELOAD_AFTER, MAX_BW_SETS
} from './progression.js'
import { EXDB } from './exercises.js'
import { normalizeState } from './state.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id
const HEAVY = EXDB.find(e => e.bp === 'upper legs').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

// Build a state whose history is a list of sessions given as [weight, ...repsPerSet].
// A rep count of null means "the set was never checked off".
const hist = (id, rows, target) => ({
  unit: 'kg',
  workouts: rows.map((row, i) => ({
    d: '2026-01-0' + (i + 1),
    unit: 'kg',
    entries: [{
      id,
      unit: 'kg',
      target: target ? { ...target, unit: target.unit || 'kg' } : { sets: 3, reps: 5, weight: row[0], unit: 'kg' },
      sets: row.slice(1).map(r => (r === null ? { unit: 'kg', w: row[0], r: 0, done: false } : { unit: 'kg', w: row[0], r, done: true }))
    }]
  }))
})

describe('readSession', () => {
  const T = { sets: 3, reps: 5 }
  it('uses the selected progression row target rather than the entry target or another AMRAP row', () => {
    const session = readSession({
      id: LIFT,
      target: { mode: 'reps', kind: 'amrap', sets: 2, reps: 5, amrapMinReps: 5, prog: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: true, amrapRole: 'amrap', amrapTarget: 12 },
        { phase: 'work', mode: 'reps', w: 100, r: 7, done: true, amrapRole: 'progression', amrapTarget: 7 }
      ]
    })
    expect(session).toMatchObject({ kind: 'amrap', goal: 7, amrap: 7, ok: true, weight: 100 })
  })

  it('counts a session where every set made its reps as a hit', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 6, done: true }] })
    expect(s.ok).toBe(true)
    expect(s.weight).toBe(60)
    expect(s.amrap).toBe(6)
    expect(s.low).toBe(5)
  })

  it('counts short reps as a miss even when the set was checked off', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 3, done: true }] }).ok).toBe(false)
  })

  it('counts an unchecked set as a miss — it was not performed', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 0, done: false }] })
    expect(s.ok).toBe(false)
    expect(s.weight).toBe(60)       // the working weight is still known from the sets that counted
  })

  it('counts fewer sets than prescribed as a miss', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('refuses to call a session a hit when nothing was prescribed', () => {
    expect(readSession({ id: LIFT, target: {}, sets: [{ w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('reads a timed session by the hold, not by reps', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, w: 0, done: true }, { sec: 50, w: 0, done: true }] })
    expect(s.mode).toBe('time')
    expect(s.ok).toBe(true)
    expect(s.best).toBe(50)
    expect(readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, done: true }, { sec: 30, done: true }] }).ok).toBe(false)
  })

  it('fills incomplete recorded targets from the compatible current plan', () => {
    const fallback = { id: LIFT, mode: 'reps', sets: 3, reps: 5, weight: 60 }
    const s = readSession({ id: LIFT, target: { mode: 'reps' }, sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }
    ] }, fallback)
    expect(s).toMatchObject({ mode: 'reps', goal: 5, ok: true })
  })

  it('ignores completed warm-up sets when deciding whether work progressed', () => {
    const s = readSession({ id: LIFT, target: T, sets: [
      { phase: 'warmup', w: 20, r: 10, done: true },
      { phase: 'work', w: 60, r: 5, done: true },
      { phase: 'work', w: 60, r: 5, done: true },
      { phase: 'work', w: 60, r: 5, done: true }
    ] })
    expect(s.ok).toBe(true)
    expect(s.weight).toBe(60)
  })

  it('does not turn warm-up-only failures into a progression stall or deload', () => {
    const S = {
      unit: 'kg',
      workouts: [1, 2, 3].map(day => ({
        d: `2026-01-0${day}`,
        unit: 'kg',
        entries: [{ id: LIFT, target: { sets: 3, reps: 5, mode: 'reps' }, sets: [
          { phase: 'warmup', unit: 'kg', w: 20, r: 1, done: true },
          { phase: 'work', unit: 'kg', w: 60, r: 5, done: true },
          { phase: 'work', unit: 'kg', w: 5, r: 5, done: true },
          { phase: 'work', unit: 'kg', w: 5, r: 5, done: true }
        ] }]
      }))
    }
    const p = nextPrescription(S, { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' })
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('fails closed for a legacy entry whose work rows mix reps and time', () => {
    const s = readSession({ id: LIFT, sets: [
      { w: 60, r: 5, done: true },
      { w: 60, sec: 45, done: true }
    ] }, { id: LIFT, mode: 'reps', sets: 1, reps: 5 })
    expect(s.ok).toBe(false)
    expect(s.reps).toEqual([])
  })
})

describe('Programme partial progression outcomes', () => {
  const target = { id: LIFT, mode: 'reps', sets: 3, reps: 5, weight: 60, prog: 'linear', unit: 'kg' }

  it('holds an uncompleted exercise at its current prescription instead of advancing old history', () => {
    const S = hist(LIFT, [[60, 5, 5, 5]], target)
    S.workouts.push({
      d: '2026-01-02', unit: 'kg', partial: true, owed: false, schedule: 'advance',
      entries: [{ id: LIFT, unit: 'kg', target, progression: 'none', sets: [
        { unit: 'kg', w: 60, r: 0, done: false },
        { unit: 'kg', w: 60, r: 0, done: false },
        { unit: 'kg', w: 60, r: 0, done: false }
      ] }]
    })

    expect(sessionsFor(S, LIFT, target)).toHaveLength(2)
    expect(nextPrescription(S, target, null)).toMatchObject({ kind: 'hold', weight: 60 })
  })

  it('allows only an explicitly complete exercise to advance from a skipped partial session', () => {
    const S = hist(LIFT, [[60, 5, 5, 5]], target)
    S.workouts.push({
      d: '2026-01-02', unit: 'kg', partial: true, owed: false, schedule: 'advance',
      entries: [{ id: LIFT, unit: 'kg', target, progression: 'progress', sets: [
        { unit: 'kg', w: 60, r: 5, done: true },
        { unit: 'kg', w: 60, r: 5, done: true },
        { unit: 'kg', w: 60, r: 5, done: true }
      ] }]
    })

    expect(nextPrescription(S, target, null)).toMatchObject({ kind: 'up', weight: 62.5 })
  })
})

describe('Programme deload progression boundary', () => {
  it('holds the pre-deload target after a completed deload session', () => {
    const target = { id: LIFT, mode: 'reps', sets: 3, reps: 5, weight: 80, prog: 'linear', unit: 'kg' }
    const S = hist(LIFT, [[80, 5, 5, 5]], target)
    S.workouts.push({
      d: '2026-01-02', unit: 'kg', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:w7',
      entries: [{ id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg', target: {
        ...target, weight: 72.5, programmeWeekMode: 'deload', programmeHoldDisposition: 'deload', programmeHoldWeight: 80
      }, sets: [1, 2, 3].map(() => ({ unit: 'kg', w: 72.5, r: 5, done: true })) }]
    })

    expect(nextPrescription(S, target, null)).toMatchObject({ kind: 'hold', weight: 80 })

    const legacy = hist(LIFT, [[80, 5, 5, 5]], target)
    legacy.workouts.push({
      d: '2026-01-02', unit: 'kg', cycleId: 'cycle-1',
      entries: [{ id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg', target: {
        ...target, weight: 72.5, programmeWeekMode: 'deload'
      }, sets: [1, 2, 3].map(() => ({ unit: 'kg', w: 72.5, r: 5, done: true })) }]
    })
    expect(nextPrescription(legacy, target, null)).toMatchObject({ kind: 'hold', weight: 72.5 })
  })
})


describe('stallCount', () => {
  it('counts consecutive misses back from the most recent session', () => {
    expect(stallCount([{ ok: true }, { ok: true }])).toBe(0)
    expect(stallCount([{ ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([{ ok: false }, { ok: false }, { ok: false }])).toBe(3)
    expect(stallCount([{ ok: false }, { ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([])).toBe(0)
  })
})

describe('policyFor', () => {
  it('keeps the app\'s long-standing behaviour as the default for reps work', () => {
    expect(policyFor({ id: LIFT }, null, 'reps')).toBe('linear')
  })
  it('leaves timed and cardio work alone unless asked', () => {
    expect(policyFor({ id: LIFT, mode: 'time' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO }, null, 'cardio')).toBe('off')
  })
  it('lets the exercise override the routine, and the routine override the default', () => {
    expect(policyFor({ id: LIFT }, { prog: 'greyskull' }, 'reps')).toBe('greyskull')
    expect(policyFor({ id: LIFT, prog: 'double' }, { prog: 'greyskull' }, 'reps')).toBe('double')
  })
  it('refuses a policy that makes no sense for the mode', () => {
    expect(policyFor({ id: LIFT, mode: 'time', prog: 'greyskull' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO, prog: 'linear' }, null, 'cardio')).toBe('off')
    expect(POLICIES_FOR.cardio).toEqual(['off'])
  })
})

describe('defaultIncrement', () => {
  it('gives lower-body lifts the bigger jump', () => {
    expect(defaultIncrement(LIFT, 'kg')).toBe(2.5)
    expect(defaultIncrement(HEAVY, 'kg')).toBe(5)
  })
  it('scales to pounds', () => {
    expect(defaultIncrement(LIFT, 'lb')).toBe(5)
    expect(defaultIncrement(HEAVY, 'lb')).toBe(10)
  })
  it('falls back for an unknown exercise', () => {
    expect(defaultIncrement('nope', 'kg')).toBe(2.5)
  })
})

describe('linear progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('says nothing useful before there is any history', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, cfg)
    expect(p.kind).toBe('first')
    expect(p.weight).toBeUndefined()
  })

  it('adds the increment after a clean session', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('repeats the weight after a miss instead of advancing', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('does not advance when the last set was left unchecked', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, null]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('deloads after three misses in a row, onto a loadable weight', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 4, 4], [60, 5, 5, 4]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)             // 60 × 0.9 = 54 → nearest loadable 2.5 step
    expect(DELOAD_AFTER.linear).toBe(3)
  })

  it('a good session in between clears the stall', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 5, 5], [60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
  })

  it('never deloads below one increment, however light the lift already is', () => {
    const p = nextPrescription(hist(LIFT, [[2.5, 1, 1, 1], [2.5, 1, 1, 1], [2.5, 1, 1, 1]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(2.5)
  })

  it('always makes a deload actually lighter, even when rounding would not', () => {
    // 20 × 0.9 = 18 → nearest 2.5 step is 17.5, fine. 5 × 0.9 = 4.5 → nearest step is 5,
    // which is no deload at all, so it has to step down instead.
    const p = nextPrescription(hist(LIFT, [[5, 1, 1, 1], [5, 1, 1, 1], [5, 1, 1, 1]]), cfg)
    expect(p.weight).toBeLessThan(5)
  })

  it('uses the heavier step for a lower-body lift', () => {
    const p = nextPrescription(hist(HEAVY, [[100, 5, 5, 5]]), { id: HEAVY, sets: 3, reps: 5, prog: 'linear' })
    expect(p.weight).toBe(105)
  })

  it('honours a per-exercise increment override', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { ...cfg, inc: 1 })
    expect(p.weight).toBe(61)
  })

  it('treats ordinary AMRAP surplus as logging only and keeps the configured increment', () => {
    const entry = {
      id: LIFT, unit: 'kg',
      target: { mode: 'reps', kind: 'amrap', sets: 1, reps: 5, weight: 60, prog: 'linear', unit: 'kg' },
      sets: [{ phase: 'work', mode: 'reps', w: 60, r: 20, done: true, unit: 'kg', amrapRole: 'amrap' }]
    }
    const state = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [entry] }] }

    expect(readSession(entry, entry.target, 'kg', 'linear', 'kg')).toMatchObject({ kind: 'fixed', ok: true })
    expect(nextPrescription(state, { id: LIFT, sets: 1, reps: 5, weight: 60, inc: 2.5, prog: 'linear' }))
      .toMatchObject({ kind: 'up', weight: 62.5 })
  })

  it('works in pounds', () => {
    const base = hist(LIFT, [[135, 5, 5, 5]])
    const S = { ...base, unit: 'lb', workouts: base.workouts.map(w => ({
      ...w, unit: 'lb', entries: w.entries.map(e => ({
        ...e, unit: 'lb', target: { ...e.target, unit: 'lb' }, sets: e.sets.map(set => ({ ...set, unit: 'lb' }))
      }))
    })) }
    expect(nextPrescription(S, cfg).weight).toBe(140)
  })
})

describe('bodyweight exercises', () => {
  const cfg = { id: LIFT, sets: 3, reps: 10, weight: 0, prog: 'linear' }
  const bw = rows => hist(LIFT, rows, { sets: 3, reps: 10 })

  it('never invents a weight to deload to — there is nothing to take off a push-up', () => {
    const p = nextPrescription(bw([[0, 10, 10, 8], [0, 10, 10, 9], [0, 10, 10, 8]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(10)
  })

  it('progresses in reps instead of load after a clean session', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(11)
  })

  /* A ceiling turns "+1 rep forever" into a plan — issue #33. */
  it('climbs to the ceiling one rep at a time', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), { ...cfg, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.reps).toBe(11)
    expect(p.sets).toBeUndefined()
  })

  it('adds a set and restarts the range once the ceiling is reached', () => {
    const at15 = hist(LIFT, [[0, 15, 15, 15]], { sets: 3, reps: 15 })
    const p = nextPrescription(at15, { ...cfg, reps: 10, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.sets).toBe(4)
    expect(p.reps).toBe(10)
    expect(p.weight).toBe(0)
  })

  it('stops adding sets at the cap and says what to do instead', () => {
    const at15 = hist(LIFT, [[0, 15, 15, 15]], { sets: 3, reps: 15 })
    const p = nextPrescription(at15, { ...cfg, sets: MAX_BW_SETS, reps: 10, repsMax: 15 })
    expect(p.kind).toBe('hold')
    expect(p.sets).toBeUndefined()
    expect(p.why[0]).toMatch(/harder variation/)
  })

  it('leaves a belted set to the normal policies — there is a load to add now', () => {
    const belted = hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10 })
    const p = nextPrescription(belted, { ...cfg, bodyweight: true, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.weight).toBeGreaterThan(10)
    expect(p.sets).toBeUndefined()
  })

  it('steps a unilateral total by two, so it lands on 16, 18, 20 (issue #31)', () => {
    const at16 = hist(LIFT, [[0, 16, 16, 16]], { sets: 3, reps: 16 })
    expect(nextPrescription(at16, { ...cfg, reps: 16, side: true }).reps).toBe(18)
    // and by one when it is not
    expect(nextPrescription(at16, { ...cfg, reps: 16 }).reps).toBe(17)
  })

  it('keeps climbing reps forever when no ceiling was set — the old behaviour', () => {
    const at30 = hist(LIFT, [[0, 30, 30, 30]], { sets: 3, reps: 30 })
    const p = nextPrescription(at30, cfg)
    expect(p.kind).toBe('up')
    expect(p.reps).toBe(31)
    expect(p.sets).toBeUndefined()
  })

  it('applies to every policy, not just linear', () => {
    for (const prog of ['linear', 'greyskull', 'double']) {
      const p = nextPrescription(bw([[0, 10, 10, 4], [0, 10, 10, 4], [0, 10, 10, 4]]), { ...cfg, prog })
      expect(p.weight, prog).toBe(0)
      expect(p.kind, prog).toBe('hold')
    }
  })

  it('still adds load the moment the exercise is actually weighted', () => {
    const p = nextPrescription(hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(12.5)
  })
})

describe('Greyskull LP', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }

  it('lets an explicit fixed target disable the routine default AMRAP', () => {
    expect(targetKindFor({ kind: 'fixed' }, 'greyskull')).toBe('fixed')
    const target = { sets: 3, reps: 5, weight: 60, kind: 'fixed' }
    const session = readSession({ id: LIFT, target, sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 10, done: true }
    ] }, { ...cfg })
    expect(session.kind).toBe('fixed')
    expect(nextPrescription(hist(LIFT, [[60, 5, 5, 10]], target), { ...cfg, kind: 'fixed' }).weight).toBe(62.5)
  })

  it('advances when the final set makes the target', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('takes a double jump when the last set doubles the target reps', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(65)
    expect(p.why[0]).toContain('double')
  })

  it('resets 10 % on the very first failure, unlike plain linear', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)
    expect(DELOAD_AFTER.greyskull).toBe(1)
  })

  it('keeps resetting from the reduced weight, not the original', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [55, 5, 5, 2]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(50)            // 55 × 0.9 = 49.5 → nearest 2.5 step
  })

  it('exposes the final AMRAP result and uses it for a double jump', () => {
    const target = { sets: 3, reps: 5, weight: 60, kind: 'amrap' }
    const session = readSession({ id: LIFT, target, sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 12, done: true }
    ] })
    expect(session.kind).toBe('amrap')
    expect(session.amrap).toBe(12)
    expect(session.ok).toBe(true)
    expect(nextPrescription(hist(LIFT, [[60, 5, 5, 12]], target), { ...cfg, kind: 'amrap' }).weight).toBe(65)
  })

  it('marks a routine-policy Greyskull session as AMRAP when the old target had no kind', () => {
    const session = readSession({ id: LIFT, target: { sets: 3, reps: 5, weight: 60 }, sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 10, done: true }
    ] }, { id: LIFT, mode: 'reps', reps: 5, prog: 'greyskull' })
    expect(session.kind).toBe('amrap')
    expect(session.amrap).toBe(10)
  })

  it('passes a routine Greyskull policy into legacy targets with an omitted kind', () => {
    const S = hist(LIFT, [[60, 5, 5, 10]], { sets: 3, reps: 5, weight: 60 })
    const p = nextPrescription(S, { id: LIFT, sets: 3, reps: 5, weight: 60 }, { prog: 'greyskull' })
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(65)
  })

  it('uses the canonical AMRAP minimum and permits reps above it', () => {
    const target = { sets: 3, mode: 'reps', kind: 'amrap', amrapMinReps: 5, weight: 60 }
    const S = hist(LIFT, [[60, 5, 5, 7]], target)
    const session = readSession(S.workouts[0].entries[0], target, 'kg')
    expect(session).toMatchObject({ kind: 'amrap', goal: 5, amrap: 7, ok: true })
    expect(nextPrescription(S, { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }).weight).toBe(62.5)
  })

  it('uses the starred row rather than the array-final ordinary AMRAP for success, weight, and double increments', () => {
    const target = { sets: 3, mode: 'reps', kind: 'fixed', amrapMinReps: 5, weight: 60 }
    const entry = {
      id: LIFT, target,
      sets: [
        { phase: 'work', w: 60, r: 5, done: true, amrapRole: 'none' },
        { phase: 'work', w: 60, r: 10, done: true, amrapRole: 'progression' },
        { phase: 'work', w: 100, r: 20, done: true, amrapRole: 'amrap' }
      ]
    }
    expect(readSession(entry, target)).toMatchObject({ kind: 'amrap', goal: 5, amrap: 10, weight: 60, ok: true })

    const stamped = {
      unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{
        ...entry, unit: 'kg', target: { ...target, unit: 'kg' },
        sets: entry.sets.map(set => ({ ...set, unit: 'kg' }))
      }] }]
    }
    expect(nextPrescription(stamped, { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }))
      .toMatchObject({ kind: 'up', weight: 65 })
  })

  it('deloads an unchecked weighted progression driver from its prescribed load', () => {
    const target = { sets: 3, mode: 'reps', kind: 'amrap', amrapMinReps: 5, weight: 60 }
    const entry = {
      id: LIFT, unit: 'kg', target: { ...target, unit: 'kg' },
      sets: [
        { phase: 'work', w: 60, r: 5, done: true, unit: 'kg', amrapRole: 'none' },
        { phase: 'work', w: 60, r: 5, done: true, unit: 'kg', amrapRole: 'none' },
        { phase: 'work', w: 60, r: 0, done: false, unit: 'kg', amrapRole: 'progression' }
      ]
    }

    expect(readSession(entry, target)).toMatchObject({ weight: 60, amrap: 0, ok: false })
    expect(nextPrescription(
      { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [entry] }] },
      { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }
    )).toMatchObject({ kind: 'deload', weight: 55 })
  })

  it('holds an explicit no-driver AMRAP session instead of promoting another row or deloading', () => {
    const target = { sets: 3, mode: 'reps', kind: 'amrap', amrapMinReps: 5, weight: 60 }
    const entry = {
      id: LIFT, unit: 'kg', target: { ...target, unit: 'kg' },
      sets: [
        { phase: 'work', w: 60, r: 5, done: true, unit: 'kg', amrapRole: 'none' },
        { phase: 'work', w: 60, r: 10, done: true, unit: 'kg', amrapRole: 'amrap' },
        { phase: 'work', w: 60, r: 12, done: true, unit: 'kg', amrapRole: 'amrap' }
      ]
    }
    expect(readSession(entry, target)).toMatchObject({ kind: 'amrap', noAmrapDriver: true, amrap: 0, ok: false })
    expect(nextPrescription(
      { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [entry] }] },
      { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }
    )).toMatchObject({ kind: 'hold', weight: 60 })
  })

  it('deloads 10 percent when the final AMRAP misses its minimum', () => {
    const target = { sets: 3, mode: 'reps', kind: 'amrap', amrapMinReps: 5, weight: 60 }
    const S = hist(LIFT, [[60, 5, 5, 4]], target)
    expect(nextPrescription(S, { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }))
      .toMatchObject({ kind: 'deload', weight: 55 })
  })

  it('can maintain the same weight for an explicit AMRAP miss policy', () => {
    const target = { sets: 3, mode: 'reps', kind: 'amrap', amrapMinReps: 5, weight: 60 }
    const S = hist(LIFT, [[60, 5, 5, 4]], target)
    expect(nextPrescription(S, { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }, { prog: 'greyskull', amrapMissPolicy: 'maintain' }))
      .toMatchObject({ kind: 'hold', weight: 60 })
  })
})

describe('double progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }

  it('adds weight and drops back to the bottom of the range at the top of it', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 12]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(42.5)
    expect(p.reps).toBe(8)
  })

  it('keeps the weight and asks for one more rep while inside the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 10, 9, 9]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(40)
    expect(p.reps).toBe(10)             // worst set was 9 → aim for 10
  })

  it('never asks for more than the top of the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 11]], { sets: 3, reps: 12 }), cfg)
    expect(p.reps).toBeLessThanOrEqual(12)
  })

  it('deloads after a run of stalls and restarts at the bottom of the range', () => {
    const rows = [[40, 9, 9, 9], [40, 9, 9, 9], [40, 9, 9, 9]]
    const p = nextPrescription(hist(LIFT, rows, { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('deload')
    expect(p.reps).toBe(8)
    expect(p.weight).toBe(35)           // 40 × 0.9 = 36 → nearest loadable 2.5 step
  })
})

describe('timed progression', () => {
  const cfg = { id: LIFT, mode: 'time', sets: 2, sec: 45, prog: 'time' }
  const T = { sets: 2, sec: 45, mode: 'time' }
  const timeHist = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-02-0' + (i + 1),
      unit: 'kg',
      entries: [{ id: LIFT, target: T, sets: row.map(sec => ({ sec, w: 0, done: true })) }]
    }))
  })

  it('adds time when every set went the full duration', () => {
    const p = nextPrescription(timeHist([[45, 45]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.sec).toBe(50)
    expect(p.weight).toBeUndefined()
  })

  it('repeats the target when a hold came up short', () => {
    const p = nextPrescription(timeHist([[45, 38]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.sec).toBe(45)
  })

  it('backs the target off after a run of short sessions', () => {
    const p = nextPrescription(timeHist([[45, 30], [45, 32], [45, 31]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.sec).toBe(40)              // 45 × 0.9 = 40.5 → nearest 5 s step
  })

  it('ignores reps history when the exercise switched to time', () => {
    const S = hist(LIFT, [[60, 5, 5, 5]])
    const p = nextPrescription({ ...S, unit: 'kg' }, cfg)
    expect(p.kind).toBe('first')        // no timed session yet, so no opinion
  })

  it('ignores targetless reps history when the exercise switches to time', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-02-10', unit: 'kg', entries: [{ id: LIFT, sets: [{ unit: 'kg', w: 60, r: 5, done: true }] }] }] }
    expect(nextPrescription(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, prog: 'time' }).kind).toBe('first')
  })

  it('supports a routine-level time policy for a legacy duration-shaped exercise', () => {
    const p = nextPrescription(timeHist([[45, 45]]), { id: LIFT, sets: 2, sec: 45 }, { prog: 'time' })
    expect(p.policy).toBe('time')
    expect(p.kind).toBe('up')
    expect(p.sec).toBe(50)
  })

  it('returns only seconds, never stale reps, for routine-level time progression', () => {
    const S = {
      unit: 'kg',
      workouts: [{ d: '2026-02-11', unit: 'kg', entries: [{ id: LIFT, target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ mode: 'time', sec: 45, r: 99, done: true }] }] }]
    }
    const p = nextPrescription(S, { id: LIFT, mode: 'time', sets: 1, sec: 45 }, { prog: 'time' })
    expect(p).toMatchObject({ policy: 'time', kind: 'up', sec: 50 })
    expect(p.reps).toBeUndefined()
  })
})

describe('policy "off"', () => {
  it('has no opinion at all', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { id: LIFT, sets: 3, reps: 5, prog: 'off' })
    expect(p.kind).toBe('off')
    expect(p.weight).toBeUndefined()
  })
  it('is what cardio always gets', () => {
    expect(nextPrescription({ unit: 'kg', workouts: [] }, { id: CARDIO, sets: 1, min: 20 }).kind).toBe('off')
  })
})

describe('sessionsFor', () => {
  it('skips workouts where the exercise was never actually logged', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ unit: 'kg', w: 60, r: 5, done: true }] }] },
        { d: '2026-01-02', unit: 'kg', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ unit: 'kg', w: 60, r: 0, done: false }] }] },
        { d: '2026-01-03', unit: 'kg', entries: [{ id: 'other', target: {}, sets: [{ unit: 'kg', w: 20, r: 5, done: true }] }] }
      ]
    }
    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-01-01'])
  })

  it('reads a legacy entry that has no target without crashing', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, sets: [{ unit: 'kg', w: 60, r: 5, done: true }] }] }] }
    expect(sessionsFor(S, LIFT)).toHaveLength(1)
  })

  it('does not turn targetless timed history into a reps session after a mode switch', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, sets: [{ unit: 'kg', sec: 60, w: 20, done: true }] }] }] }
    expect(sessionsFor(S, LIFT, { id: LIFT, mode: 'reps', sets: 1, reps: 5 })).toEqual([])
  })

  it('does not count a target-conflicting timed row as a reps miss', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT,
      target: { mode: 'reps', sets: 1, reps: 5 }, sets: [{ unit: 'kg', sec: 60, w: 20, r: 5, done: true }]
    }] }] }
    expect(sessionsFor(S, LIFT, { id: LIFT, mode: 'reps', sets: 1, reps: 5 })).toEqual([])
  })

  it('does not count a target-conflicting reps row as a timed session', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT,
      target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ unit: 'kg', w: 60, r: 5, done: true }]
    }] }] }
    expect(sessionsFor(S, LIFT, { id: LIFT, mode: 'time', sets: 1, sec: 45 })).toEqual([])
  })

  it('does not count a timed target with rep-shaped rows as a reps session either', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT,
      target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ unit: 'kg', w: 60, r: 5, done: true }]
    }] }] }
    expect(sessionsFor(S, LIFT, { id: LIFT, mode: 'reps', sets: 1, reps: 5 })).toEqual([])
  })

  it('uses the current profile unit for legacy history and excludes explicit other-unit history', () => {
    const cfg = { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 60, prog: 'linear' }
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', unit: 'lb', entries: [{ id: LIFT, sets: [{ unit: 'lb', w: 200, r: 5, done: true }] }] },
        { d: '2026-01-02', unit: 'kg', entries: [{ id: LIFT, sets: [{ unit: 'kg', w: 60, r: 5, done: true }] }] }
      ]
    }
    expect(sessionsFor(S, LIFT, cfg).map(s => s.d)).toEqual(['2026-01-02'])
    expect(nextPrescription(S, cfg).weight).toBe(62.5)
  })

  it('drops a mixed-unit entry instead of using one set as a progression miss', () => {
    const cfg = { id: LIFT, mode: 'reps', sets: 2, reps: 5, weight: 60, prog: 'linear' }
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, target: cfg, sets: [
      { unit: 'kg', w: 60, r: 5, done: true }, { unit: 'lb', w: 130, r: 5, done: true }
    ] }] }] }
    expect(sessionsFor(S, LIFT, cfg)).toEqual([])
    expect(nextPrescription(S, cfg).kind).toBe('first')
  })

  it('preserves but excludes a unitless weighted legacy session from progression', () => {
    const cfg = { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 60, prog: 'linear' }
    const S = { unit: 'kg', workouts: [{ d: '2026-02-20', entries: [{ id: LIFT,
      sets: [{ w: 60, r: 5, done: true }]
    }] }] }
    expect(sessionsFor(S, LIFT, cfg)).toEqual([])
    expect(nextPrescription(S, cfg)).toMatchObject({ kind: 'first' })
  })

  it('keeps unitless bodyweight and timed rows usable when they carry no load', () => {
    const S = { unit: 'kg', workouts: [
      { d: '2026-02-21', entries: [{ id: LIFT, sets: [{ w: 0, r: 10, done: true }] }] },
      { d: '2026-02-22', entries: [{ id: LIFT, target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: true }] }] }
    ] }
    expect(sessionsFor(S, LIFT, { id: LIFT, mode: 'reps', sets: 1, reps: 10 })).toHaveLength(1)
    expect(sessionsFor(S, LIFT, { id: LIFT, mode: 'time', sets: 1, sec: 45, prog: 'time' })).toHaveLength(1)
  })

  it('skips normalized warm-up-only history in both legacy schemas', () => {
    const cfg = { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 60, prog: 'linear' }
    const normalizeHistory = sets => normalizeState({
      unit: 'kg',
      workouts: [{ d: '2026-02-23', unit: 'kg', entries: [{
        id: LIFT,
        target: { mode: 'reps', sets: 1, reps: 5, weight: 60, unit: 'kg' },
        sets
      }] }]
    })

    const legacyBoolean = normalizeHistory([{ unit: 'kg', w: 20, r: 5, done: true, warmup: true }])
    const explicitPhase = normalizeHistory([{ unit: 'kg', w: 20, r: 5, done: true, phase: 'warmup' }])

    expect(legacyBoolean.workouts[0].entries[0].sets[0]).toMatchObject({ phase: 'work', warmup: true })
    expect(explicitPhase.workouts[0].entries[0].sets[0]).toMatchObject({ phase: 'warmup' })
    expect(sessionsFor(legacyBoolean, LIFT, cfg)).toEqual([])
    expect(sessionsFor(explicitPhase, LIFT, cfg)).toEqual([])
    expect(nextPrescription(legacyBoolean, cfg)).toMatchObject({ kind: 'first' })
    expect(nextPrescription(explicitPhase, cfg)).toMatchObject({ kind: 'first' })
  })

  it('keeps a normalized session when legacy warm-up rows accompany completed work', () => {
    const cfg = { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 60, prog: 'linear' }
    const S = normalizeState({
      unit: 'kg',
      workouts: [{ d: '2026-02-24', unit: 'kg', entries: [{
        id: LIFT,
        target: { mode: 'reps', sets: 1, reps: 5, weight: 60, unit: 'kg' },
        sets: [
          { unit: 'kg', w: 20, r: 5, done: true, warmup: true },
          { unit: 'kg', w: 60, r: 5, done: true }
        ]
      }] }]
    })

    expect(sessionsFor(S, LIFT, cfg)).toHaveLength(1)
    expect(nextPrescription(S, cfg)).toMatchObject({ kind: 'up', weight: 62.5 })
  })
})

describe('stall and deload eligibility', () => {
  it('counts only work sessions in the requested mode and unit', () => {
    expect(stallCount([
      { phase: 'warmup', mode: 'reps', unit: 'kg', ok: false },
      { phase: 'work', mode: 'time', unit: 'kg', ok: false },
      { phase: 'work', mode: 'reps', unit: 'lb', ok: false },
      { phase: 'work', mode: 'reps', unit: 'kg', ok: false }
    ], { mode: 'reps', unit: 'kg' })).toBe(1)
  })

  it('does not deload from a run of misses recorded in another unit', () => {
    const cfg = { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 60, prog: 'linear' }
    const S = {
      unit: 'kg',
      workouts: [1, 2, 3].map(day => ({
        d: `2026-04-0${day}`, unit: 'lb',
        entries: [{ id: LIFT, target: cfg, sets: [{ w: 130, r: 2, done: true }] }]
      }))
    }
    expect(nextPrescription(S, cfg)).toMatchObject({ kind: 'first' })
  })
})

// Workouts only began storing their prescription in v1.2.2. Everything logged before that is
// targetless, and reading it as "missed" would tell every long-standing user to deload on
// their first session after updating — which is exactly what the demo history did.
describe('history logged before targets were recorded', () => {
  const legacy = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-03-' + String(i + 1).padStart(2, '0'),
      unit: 'kg',
      entries: [{ id: LIFT, sets: row.slice(1).map(r => ({ unit: 'kg', w: row[0], r, done: true })) }]   // no target
    }))
  })
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('judges a targetless session against the current plan instead of calling it a miss', () => {
    const p = nextPrescription(legacy([[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('does not manufacture a stall out of a long clean history', () => {
    const p = nextPrescription(legacy(Array.from({ length: 11 }, () => [60, 5, 5, 5])), cfg)
    expect(p.kind).toBe('up')
  })

  it('still spots a genuine miss in old data', () => {
    expect(nextPrescription(legacy([[60, 5, 5, 2]]), cfg).kind).toBe('hold')
  })

  it('matches the weight hint the app showed before this engine existed', () => {
    // Old rule: every set at or above the plan's reps, with a real weight → suggest a step up.
    expect(nextPrescription(legacy([[60, 5, 6, 5]]), cfg).weight).toBe(62.5)
    expect(nextPrescription(legacy([[60, 5, 4, 5]]), cfg).kind).toBe('hold')
  })
})

describe('applyPrescription', () => {
  const sets = [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }]

  it('rewrites only what the policy decided, and only unlogged sets', () => {
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5 })
    expect(out[0]).toEqual({ w: 60, r: 5, done: true })
    expect(out[1]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('sets reps too when the policy has an opinion about them', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 42.5, reps: 8 })[1]).toEqual({ w: 42.5, r: 8, done: false })
  })

  it('touches nothing for "off" or a first session', () => {
    expect(applyPrescription(sets, { kind: 'off' })).toBe(sets)
    expect(applyPrescription(sets, { kind: 'first' })).toBe(sets)
    expect(applyPrescription(sets, null)).toBe(sets)
  })

  it('adjusts a timed set without inventing a weight', () => {
    const timed = [{ sec: 45, w: 0, done: false }]
    expect(applyPrescription(timed, { kind: 'up', sec: 50 })).toEqual([{ sec: 50, w: 0, done: false }])
  })

  it('grows the list when the policy added a set (issue #33)', () => {
    const three = [{ w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }]
    const out = applyPrescription(three, { kind: 'up', weight: 0, reps: 10, sets: 4 })
    expect(out).toHaveLength(4)
    expect(out[3]).toEqual({ w: 0, r: 10, done: false })
  })

  it('leaves a policy-added row unmarked instead of duplicating the progression driver', () => {
    const out = applyPrescription([
      { phase: 'work', w: 0, r: 10, done: false, amrapRole: 'none' },
      { phase: 'work', w: 0, r: 10, done: false, amrapRole: 'progression' }
    ], { kind: 'up', weight: 0, reps: 10, sets: 3 })
    expect(out.map(set => set.amrapRole)).toEqual(['none', 'progression', 'none'])
  })

  it('never shrinks a session that has already logged sets', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 60, sets: 1 })).toHaveLength(sets.length)
  })

  it('falls back to the settings default before the built-in', () => {
    expect(policyFor({ id: LIFT }, null, 'reps', 'greyskull')).toBe('greyskull')
    expect(policyFor({ id: LIFT }, { prog: 'double' }, 'reps', 'greyskull')).toBe('double')
    expect(policyFor({ id: LIFT, prog: 'off' }, null, 'reps', 'greyskull')).toBe('off')
    expect(policyFor({ id: LIFT }, null, 'reps', null)).toBe('linear')
    expect(policyFor({ id: LIFT }, null, 'time', 'greyskull')).toBe('off')
  })
})


describe('warm-up rows in session reads (round 3)', () => {
  it('readSession ignores warm-up rows for reps, count, low and ok', () => {
    // An undone warm-up (r 0) must not poison `ok` forever; its lighter reps must not
    // drag `low`/`count` - the warm-up is prep, the session is the work rows.
    const s = readSession({ id: LIFT, target: { sets: 2, reps: 5, mode: 'reps' }, sets: [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 6, done: true },
    ] })
    expect(s.count).toBe(2)
    expect(s.low).toBe(5)
    expect(s.reps).toEqual([5, 6])
    expect(s.ok).toBe(true)
  })

  it('readSession keeps an undone warm-up out of held/ok in time mode', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [
      { sec: 45, done: true, warmup: true },
      { sec: 45, done: true },
      { sec: 30, done: true },
    ] })
    expect(s.held).toEqual([45, 30])
    expect(s.ok).toBe(false) // the 30s work row is the miss, not the warm-up
  })
})

describe('legacy and explicit warm-up schemas in progression (round 4)', () => {
  const target = { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0 }
  const makeState = warmup => normalizeState({ unit: 'kg', workouts: [{
    d: '2026-02-01', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { ...target, unit: 'kg' }, sets: [
      { unit: 'kg', w: 20, r: 8, mode: 'reps', done: true, ...warmup },
      { unit: 'kg', w: 0, sec: 45, mode: 'time', done: true }
    ] }]
  }] })

  it('ignores a legacy reps warm-up when inferring mode and checking raw results', () => {
    for (const warmup of [{ warmup: true }, { phase: 'warmup' }]) {
      const S = makeState(warmup)
      expect(nextPrescription(S, { ...target, prog: 'time' }, { prog: 'time' }))
        .toMatchObject({ kind: 'up', sec: 50 })
      expect(sessionsFor(S, LIFT, target)).toHaveLength(1)
    }
  })
})

describe('applyPrescription never touches warm-up rows (round 3)', () => {
  it('returns warm-up-only inputs unchanged instead of cloning a warm-up as work', () => {
    for (const sets of [
      [{ phase: 'work', warmup: true, w: 20, r: 8, done: true }],
      [{ phase: 'warmup', w: 20, r: 8, done: true }]
    ]) {
      expect(applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5, sets: 3 })).toEqual(sets)
    }
  })

  it('leaves a done warm-up exactly as logged', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 5, done: false },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5 })
    expect(out[0]).toEqual({ w: 20, r: 8, done: true, warmup: true })
    expect(out[1]).toEqual({ w: 60, r: 5, done: true })
    expect(out[2]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('grows the work rows, not the warm-up rows, when the policy adds sets', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 5, done: false },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5, sets: 4 })
    expect(out.filter(s => !s.warmup)).toHaveLength(4) // 2 existing + 2 grown
    expect(out.filter(s => s.warmup)).toHaveLength(1)  // warm-up untouched
    expect(out[0]).toEqual({ w: 20, r: 8, done: true, warmup: true })
  })
})


describe('warm-up rows in session reads (round 3)', () => {
  it('readSession ignores warm-up rows for reps, count, low and ok', () => {
    // An undone warm-up (r 0) must not poison `ok` forever; its lighter reps must not
    // drag `low`/`count` - the warm-up is prep, the session is the work rows.
    const s = readSession({ id: LIFT, target: { sets: 2, reps: 5, mode: 'reps' }, sets: [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 6, done: true },
    ] })
    expect(s.count).toBe(2)
    expect(s.low).toBe(5)
    expect(s.reps).toEqual([5, 6])
    expect(s.ok).toBe(true)
  })

  it('readSession keeps an undone warm-up out of held/ok in time mode', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [
      { sec: 45, done: true, warmup: true },
      { sec: 45, done: true },
      { sec: 30, done: true },
    ] })
    expect(s.held).toEqual([45, 30])
    expect(s.ok).toBe(false) // the 30s work row is the miss, not the warm-up
  })

  it('uses phase as authoritative and falls back to the legacy warm-up flag', () => {
    const s = readSession({ id: LIFT, target: { sets: 1, reps: 5 }, sets: [
      { phase: 'warmup', w: 120, r: 20, done: true },
      { phase: 'work', warmup: true, w: 60, r: 5, done: true },
    ] })
    expect(s.count).toBe(1)
    expect(s.weight).toBe(60)
    expect(s.low).toBe(5)
    expect(s.ok).toBe(true)
  })
})

describe('applyPrescription never touches warm-up rows (round 3)', () => {
  it('leaves a done warm-up exactly as logged', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 5, done: false },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5 })
    expect(out[0]).toEqual({ w: 20, r: 8, done: true, warmup: true })
    expect(out[1]).toEqual({ w: 60, r: 5, done: true })
    expect(out[2]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('grows the work rows, not the warm-up rows, when the policy adds sets', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 5, done: false },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5, sets: 4 })
    expect(out.filter(s => !s.warmup)).toHaveLength(4) // 2 existing + 2 grown
    expect(out.filter(s => s.warmup)).toHaveLength(1)  // warm-up untouched
    expect(out[0]).toEqual({ w: 20, r: 8, done: true, warmup: true })
  })

  it('an all-warm-up entry terminates and stays untouched', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 25, r: 6, done: true, warmup: true },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5, sets: 4 })
    expect(out).toEqual(sets) // no work row to seed growth from - nothing grows, no loop
  })
})
