import { describe, it, expect } from 'vitest'
import { modeOf, isTimed, fmtSec, setLabel, defaultConfig, buildSets, exLine, workoutVolume, volumeByPhase, setsByPhase, lastEntryFor, lastPerformancesFor, lastSetupFor, bestWeightFor, bestWeightForEntry, metricModeForEntry, metricRowsForEntry, workoutsForUnit, effortOf, stepEffort, capEffort, isBw, isPerSide, sideReps, repStep, activeWorkoutHistoryPolicy, activeWorkoutHistoryState, activeWorkoutLoadReference, pairAdjacent, unpairSuperset, supersetUnits, workSetsDone, cascadeWeight, completedRoutineIdsForDate, reconcileStartSessionChoice, weeklySessionStatus } from './history.js'
import { EXDB } from './exercises.js'
import { historyUnitCompatible } from './workout-model.js'
import { normalizeState } from './state.js'

// Real ids out of the shipped catalogue, so the body-part fallback is exercised for real.
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
// A *loaded* lift: the catalogue's first non-cardio entry is a sit-up, which since issue #32
// defaults to bodyweight and would quietly send every label test down the other path.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const OTHER_LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight' && e.id !== LIFT).id
const BW = EXDB.find(e => e.eq === 'body weight').id

describe('universal last performance history', () => {
  it('keeps exact occurrence, mode, unit, completion, ordering, and safe derived fields', () => {
    const entry = (occurrenceId, w, r, done = true) => ({
      id: LIFT, occurrenceId, target: { mode: 'reps', notes: 'private target note' },
      notes: 'private entry note', sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w, r, done }]
    })
    const state = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', unit: 'kg', entries: [entry('pair-a', 60, 5), entry('pair-b', 100, 5)] },
        { d: '2026-01-02', unit: 'lb', entries: [entry('pair-a', 90, 5)] },
        { d: '2026-01-03', unit: 'kg', entries: [entry('pair-a', 70, 5, false)] },
        { d: '2026-01-04', unit: 'kg', entries: [entry('pair-a', 65, 6)] },
        { d: '2026-01-05', unit: 'kg', entries: [entry('pair-a', 67.5, 6)] },
        { d: '2026-01-06', unit: 'kg', entries: [entry('pair-a', 70, 6)] },
        { d: '2026-01-07', unit: 'kg', entries: [entry('pair-a', 72.5, 6)] },
      ]
    }

    const performances = lastPerformancesFor(state, LIFT, 'reps', 'pair-a')

    expect(performances.map(item => item.date)).toEqual(['2026-01-07', '2026-01-06', '2026-01-05'])
    expect(performances.every(item => item.mode === 'reps' && item.sets.every(set => set.mode === 'reps' && set.unit === 'kg'))).toBe(true)
    expect(performances[0].sets).toEqual([{ phase: 'work', mode: 'reps', unit: 'kg', w: 72.5, r: 6, done: true }])
    expect(performances[0]).not.toHaveProperty('notes')
    expect(performances[0]).not.toHaveProperty('target')
  })

  it('does not mix timed or cardio rows into reps performance history', () => {
    const state = {
      unit: 'kg',
      workouts: [
        { d: '2026-02-01', unit: 'kg', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ mode: 'time', unit: 'kg', sec: 60, w: 20, done: true }] }] },
        { d: '2026-02-02', unit: 'kg', entries: [{ id: LIFT, target: { mode: 'reps' }, sets: [{ mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }] }] },
      ]
    }
    expect(lastPerformancesFor(state, LIFT, 'reps').map(item => item.date)).toEqual(['2026-02-02'])
    expect(lastPerformancesFor(state, LIFT, 'time').map(item => item.date)).toEqual(['2026-02-01'])
  })
})

describe('superset editing', () => {
  it('pairs adjacent entries without mutating the source and keeps the display units contiguous', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    const paired = pairAdjacent(entries, 1, 2, 'sg-new')

    expect(paired).toEqual([{ id: 'a' }, { id: 'b', sg: 'sg-new' }, { id: 'c', sg: 'sg-new' }])
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(supersetUnits(paired)).toEqual([[0], [1, 2]])
  })

  it('keeps native four- and five-component complexes as indivisible adjacent display units', () => {
    const entries = [
      { id: 'snatch-grip-rdl', sg: 'snatch' }, { id: 'snatch-high-pull', sg: 'snatch' },
      { id: 'muscle-snatch', sg: 'snatch' }, { id: 'overhead-squat', sg: 'snatch' },
      { id: 'between' },
      { id: 'clean-deadlift', sg: 'clean' }, { id: 'clean-high-pull', sg: 'clean' },
      { id: 'tall-clean', sg: 'clean' }, { id: 'front-squat', sg: 'clean' }, { id: 'push-press', sg: 'clean' },
    ]

    expect(supersetUnits(entries)).toEqual([[0, 1, 2, 3], [4], [5, 6, 7, 8, 9]])
  })

  it('merges both contiguous groups when their boundary entries are paired', () => {
    const entries = [
      { id: 'a', sg: 'left' }, { id: 'b', sg: 'left' },
      { id: 'c', sg: 'right' }, { id: 'd', sg: 'right' }
    ]

    const merged = pairAdjacent(entries, 1, 2)

    expect(merged.map(e => e.sg)).toEqual(['left', 'left', 'left', 'left'])
    expect(entries.map(e => e.sg)).toEqual(['left', 'left', 'right', 'right'])
  })

  it('unpairs one entry and removes sg values left without an adjacent partner', () => {
    const entries = [
      { id: 'a', sg: 'group' }, { id: 'b', sg: 'group' }, { id: 'c', sg: 'group' },
      { id: 'd', sg: 'orphan' }
    ]

    const unpaired = unpairSuperset(entries, 1)

    expect(unpaired).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    expect(entries.map(e => e.sg)).toEqual(['group', 'group', 'group', 'orphan'])
  })

  it('rejects a non-adjacent pairing request', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(() => pairAdjacent(entries, 0, 2, 'sg-invalid')).toThrow(/adjacent/)
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })
})


describe('modeOf', () => {
  it('falls back to the body part when a plan has no mode — every existing plan keeps working', () => {
    expect(modeOf({ id: CARDIO })).toBe('cardio')
    expect(modeOf({ id: LIFT })).toBe('reps')
    expect(modeOf({ id: 'no-such-exercise' })).toBe('reps')
    expect(modeOf({})).toBe('reps')
    expect(modeOf(null)).toBe('reps')
    expect(modeOf(undefined)).toBe('reps')
  })

  it('lets an explicit mode win over the body part', () => {
    expect(modeOf({ id: LIFT, mode: 'time' })).toBe('time')
    expect(modeOf({ id: CARDIO, mode: 'reps' })).toBe('reps')
    expect(modeOf({ id: CARDIO, mode: 'time' })).toBe('time')
  })

  it('ignores a mode it does not know rather than trusting a bad file', () => {
    expect(modeOf({ id: LIFT, mode: 'nonsense' })).toBe('reps')
    expect(modeOf({ id: CARDIO, mode: '' })).toBe('cardio')
  })

  it('recognises legacy timed/cardio fields when an explicit mode was not persisted', () => {
    expect(modeOf({ id: LIFT, sec: 60 })).toBe('time')
    expect(modeOf({ id: LIFT, min: 20, speed: 9 })).toBe('cardio')
  })

  it('exposes the timed check', () => {
    expect(isTimed({ id: LIFT, mode: 'time' })).toBe(true)
    expect(isTimed({ id: LIFT })).toBe(false)
  })
})

describe('fmtSec', () => {
  it('reads as a clock, not a pile of seconds', () => {
    expect(fmtSec(0)).toBe('0:00')
    expect(fmtSec(9)).toBe('0:09')
    expect(fmtSec(45)).toBe('0:45')
    expect(fmtSec(60)).toBe('1:00')
    expect(fmtSec(90)).toBe('1:30')
    expect(fmtSec(605)).toBe('10:05')
  })
  it('is defensive about junk input', () => {
    expect(fmtSec(-5)).toBe('0:00')
    expect(fmtSec(undefined)).toBe('0:00')
    expect(fmtSec(null)).toBe('0:00')
    expect(fmtSec(NaN)).toBe('0:00')
    expect(fmtSec(44.6)).toBe('0:45')
  })
})

describe('setLabel', () => {
  it('describes each mode in its own terms', () => {
    expect(setLabel(LIFT, { w: 60, r: 10 })).toBe('60×10')
    expect(setLabel(CARDIO, { min: 20, speed: 9 })).toBe('20 min @ 9 km/h')
    expect(setLabel(LIFT, { sec: 45, w: 0 }, { mode: 'time' })).toBe('0:45')
    expect(setLabel(LIFT, { sec: 90, w: 20 }, { mode: 'time' })).toBe('1:30 · 20')
  })

  it('reads a legacy set with no config exactly as before', () => {
    expect(setLabel(LIFT, { w: 0, r: 0 })).toBe('0×0')
    expect(setLabel(CARDIO, {})).toBe('0 min @ 0 km/h')
  })

  it('uses row-specific modes when warm-up and work modes are mixed', () => {
    expect(setLabel(LIFT, { phase: 'warmup', mode: 'reps', w: 20, r: 8 }, { mode: 'time', sec: 45 }))
      .toBe('20×8')
    expect(setLabel(LIFT, { phase: 'work', mode: 'time', sec: 45, w: 20 }, { mode: 'reps', reps: 5 }))
      .toBe('0:45 · 20')
  })
  it('appends RIR when present, including a valid 0', () => {
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2 })).toBe('60×10 (RIR 2)')
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 1.5 })).toBe('60×10 (RIR 1.5)')
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 0 })).toBe('60×10 (RIR 0)')
  })

  it('says nothing about RIR on a set that never logged one', () => {
    expect(setLabel(LIFT, { w: 60, r: 10 })).toBe('60×10')
    // cleared in the UI: the key is dropped, but a null must read the same as absent
    expect(setLabel(LIFT, { w: 60, r: 10, rir: null })).toBe('60×10')
  })

  it('appends RPE for a set logged on that scale', () => {
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: 8 })).toBe('60×10 (RPE 8)')
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: 9.5 })).toBe('60×10 (RPE 9.5)')
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: null })).toBe('60×10')
  })

  it('keeps each set on the scale it was logged with', () => {
    // switching the setting must not rewrite history: an old RIR set still reads as RIR
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2 })).toBe('60×10 (RIR 2)')
    // and a set that somehow carries both is described once, by the one it was logged with
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2, rpe: 8 })).toBe('60×10 (RIR 2)')
  })
})

describe('effortOf', () => {
  it('reads the scale a profile logs', () => {
    expect(effortOf({ effort: 'rpe' })).toBe('rpe')
    expect(effortOf({ effort: 'rir' })).toBe('rir')
    expect(effortOf({ effort: 'none' })).toBe('none')
    expect(effortOf({})).toBe('none')
  })

  it('keeps the column for a profile still carrying the old showRir flag', () => {
    expect(effortOf({ showRir: true })).toBe('rir')
    // what a stored profile actually looks like once it is overlaid on DEF
    expect(effortOf({ effort: null, showRir: true })).toBe('rir')
    expect(effortOf({ effort: null })).toBe('none')
    expect(effortOf({ showRir: false })).toBe('none')
    // once the new setting is chosen it wins, whatever the old flag said
    expect(effortOf({ showRir: true, effort: 'rpe' })).toBe('rpe')
    expect(effortOf({ showRir: true, effort: 'none' })).toBe('none')
  })

  // The store cannot be imported here (it reaches for `navigator` at module load), so the
  // overlay it performs is reproduced literally: stored profile spread over the defaults.
  // DEF.effort is null precisely so this lands on the showRir fallback rather than on 'none'.
  const overlay = stored => ({ unit: 'kg', effort: null, ...stored })

  it('survives the overlay every load path performs', () => {
    // upgrading with the column on: local state, a server pull and a restored backup all
    // arrive as a stored object spread over the defaults, and all must keep the column
    expect(effortOf(overlay({ showRir: true }))).toBe('rir')
    expect(effortOf(overlay({ showRir: false }))).toBe('none')
    // a profile predating the RIR feature entirely
    expect(effortOf(overlay({}))).toBe('none')
    // and one written by this version
    expect(effortOf(overlay({ effort: 'rpe' }))).toBe('rpe')
    // an old backup restored over a profile that had already chosen: the file wins, because
    // an import replaces state wholesale rather than merging
    expect(effortOf(overlay({ showRir: true, effort: undefined }))).toBe('rir')
  })

  it('is not fooled by a junk value', () => {
    expect(effortOf({ effort: 'rpe10' })).toBe('none')
    expect(effortOf({ effort: 'RIR' })).toBe('none')
    expect(effortOf({ effort: 'f' })).toBe('none')
    expect(effortOf(null)).toBe('none')
    expect(effortOf(undefined)).toBe('none')
    // a junk value with the old flag still set falls back rather than showing nothing
    expect(effortOf({ effort: 'nope', showRir: true })).toBe('rir')
  })
})

describe('stepEffort', () => {
  it('starts at the bottom of the scale and walks up', () => {
    // the first + on an empty cell lands on the lowest value, not on some "typical" middle:
    // the stepper counts up from the floor the way every other stepper in the app does
    expect(stepEffort('rir', null, 1)).toBe(0)
    expect(stepEffort('rpe', null, 1)).toBe(6)
    // and then in even steps
    expect(stepEffort('rir', 0, 1)).toBe(0.5)
    expect(stepEffort('rir', 0.5, 1)).toBe(1)
    expect(stepEffort('rpe', 6, 1)).toBe(6.5)
  })

  it('leaves an untouched cell unlogged when stepped down', () => {
    // one stray − on a fresh row must not stamp "(RIR 0)" — went to failure — on the set
    expect(stepEffort('rir', null, -1)).toBe(null)
    expect(stepEffort('rpe', null, -1)).toBe(null)
    expect(stepEffort('rir', undefined, -1)).toBe(null)
  })

  it('clears the cell again when stepped back off the floor', () => {
    // so a mistap is undoable rather than sticking at the floor for good
    expect(stepEffort('rir', 0, -1)).toBe(null)
    expect(stepEffort('rpe', 6, -1)).toBe(null)
    // but a step that stays inside the scale is an ordinary step
    expect(stepEffort('rir', 0.5, -1)).toBe(0)
    expect(stepEffort('rpe', 6.5, -1)).toBe(6)
  })

  it('stops at the top of the scale', () => {
    expect(stepEffort('rir', 9.5, 1)).toBe(10)
    expect(stepEffort('rir', 10, 1)).toBe(10)
    expect(stepEffort('rpe', 10, 1)).toBe(10)
  })

  it('keeps halves clean instead of drifting into float dust', () => {
    let v = null
    for (let i = 0; i < 6; i++) v = stepEffort('rpe', v, 1)
    expect(v).toBe(8.5)
    expect(stepEffort('rir', 0.1 + 0.2, 1)).toBe(0.8)
  })

  it('steps evenly from a value typed below the floor rather than snapping', () => {
    // nothing stops someone typing RPE 3; the stepper must not jump them to 6 on one tap
    expect(stepEffort('rpe', 3, 1)).toBe(3.5)
    // stepping down out of the scale from there just clears it
    expect(stepEffort('rpe', 3, -1)).toBe(null)
  })

  it('does nothing when the profile logs no effort at all', () => {
    expect(stepEffort('none', null, 1)).toBe(null)
    expect(stepEffort('none', 2, 1)).toBe(2)
    expect(stepEffort(undefined, 2, -1)).toBe(2)
  })
})

describe('capEffort', () => {
  it('caps a typed value at the top of the scale', () => {
    expect(capEffort('rir', 12)).toBe(10)
    expect(capEffort('rpe', 99)).toBe(10)
    expect(capEffort('rpe', 8)).toBe(8)
  })

  it('does not floor a typed value, so typing "10" survives its first keystroke', () => {
    // clamping up would turn the "1" of "10" into 6 and fight the input
    expect(capEffort('rpe', 1)).toBe(1)
    expect(capEffort('rir', 0)).toBe(0)
  })

  it('passes an emptied field through untouched', () => {
    expect(capEffort('rir', null)).toBe(null)
    expect(capEffort('rpe', undefined)).toBe(undefined)
    expect(capEffort('none', 12)).toBe(12)
  })
})

// End-to-end on the data, not the pixels: what a set carries after the taps a real session
// makes, and what it reads back as afterwards.
describe('logging effort across a session', () => {
  it('logs a working set on the chosen scale', () => {
    // four + taps from empty on an RPE profile: 6, 6.5, 7, 7.5
    let v = null
    for (let i = 0; i < 4; i++) v = stepEffort('rpe', v, 1)
    expect(setLabel(LIFT, { w: 80, r: 5, rpe: v })).toBe('80×5 (RPE 7.5)')
  })

  it('a set taken to failure is logged, not left blank', () => {
    const v = stepEffort('rir', null, 1)      // one + on an RIR profile
    expect(v).toBe(0)
    expect(setLabel(LIFT, { w: 100, r: 3, rir: v })).toBe('100×3 (RIR 0)')
  })

  it('switching the setting mid-history rewrites nothing', () => {
    const old = { w: 60, r: 10, rir: 2 }      // logged while the profile was on RIR
    const fresh = { w: 60, r: 10, rpe: 8 }    // logged after switching to RPE
    expect(effortOf({ effort: 'rpe' })).toBe('rpe')
    expect(setLabel(LIFT, old)).toBe('60×10 (RIR 2)')
    expect(setLabel(LIFT, fresh)).toBe('60×10 (RPE 8)')
    // turning the column off entirely hides the control but keeps both sets readable
    expect(effortOf({ effort: 'none' })).toBe('none')
    expect(setLabel(LIFT, old)).toBe('60×10 (RIR 2)')
  })

  it('never attaches effort to a mode that has no place for it', () => {
    // cardio and timed sets have no third stepper, and their labels ignore the field even
    // if an import or an old file put one there
    expect(setLabel(CARDIO, { min: 20, speed: 9, rpe: 8 })).toBe('20 min @ 9 km/h')
    expect(setLabel(LIFT, { sec: 45, rir: 2 }, { id: LIFT, mode: 'time' })).toBe('0:45')
  })
})

describe('defaultConfig', () => {
  it('gives each mode a sensible starting point', () => {
    expect(defaultConfig(LIFT)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps' })
    expect(defaultConfig(CARDIO)).toEqual({ sets: 1, min: 20, speed: 8 })
    expect(defaultConfig(LIFT, 'time')).toEqual({ sets: 3, sec: 45, weight: 0, mode: 'time' })
  })
  it('seeds the bodyweight flag from the catalogue, and only when it is true', () => {
    expect(defaultConfig(BW)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: true })
    expect(defaultConfig(BW, 'time')).toEqual({ sets: 3, sec: 45, weight: 0, mode: 'time', bodyweight: true })
    expect('bodyweight' in defaultConfig(LIFT)).toBe(false)
  })
})

/* ---------- bodyweight and per side (issues #31/#32/#33) ---------- */

describe('isBw', () => {
  it('defaults from the catalogue so an existing plan needs no flag', () => {
    expect(isBw({ id: BW })).toBe(true)
    expect(isBw({ id: LIFT })).toBe(false)
  })
  it('lets the config win in both directions — a belt on a dip, a flag on a machine', () => {
    expect(isBw({ id: BW, bodyweight: false })).toBe(false)
    expect(isBw({ id: LIFT, bodyweight: true })).toBe(true)
  })
})

describe('sideReps', () => {
  it('halves the logged total, because the total is what was logged', () => {
    expect(sideReps(16)).toBe(8)
    expect(sideReps(0)).toBe(0)
  })
  it('shows an odd total as it falls rather than rounding the imbalance away', () => {
    expect(sideReps(17)).toBe(8.5)
  })
})

describe('exLine — per side never reaches a timed hold', () => {
  it('ignores a stale side flag on a hold, which has no reps to split', () => {
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time', side: true }, 'kg')).toBe('3 × 0:45')
  })
})

describe('repStep', () => {
  it('steps unilateral work in twos so the total stays splittable', () => {
    expect(repStep({ side: true })).toBe(2)
    expect(repStep({})).toBe(1)
    expect(repStep(null)).toBe(1)
  })
})

describe('setLabel — bodyweight', () => {
  it('reads as reps alone, because "0×12" describes nothing', () => {
    expect(setLabel(BW, { w: 0, r: 12 }, { id: BW })).toBe('12')
  })
  it('spells out a belt as an addition', () => {
    expect(setLabel(BW, { w: 10, r: 8 }, { id: BW })).toBe('+10 × 8')
  })
  it('logs a per-side set as the plain total, like every other set in the app', () => {
    expect(setLabel(BW, { w: 0, r: 16 }, { id: BW, side: true })).toBe('16')
    expect(setLabel(LIFT, { w: 20, r: 16 }, { id: LIFT, side: true })).toBe('20×16')
  })
  it('keeps the effort tail', () => {
    expect(setLabel(BW, { w: 0, r: 12, rir: 2 }, { id: BW })).toBe('12 (RIR 2)')
  })
})

describe('exLine', () => {
  it('shows the split where there is room for it, next to the total you log', () => {
    expect(exLine({ id: LIFT, sets: 3, reps: 16, side: true }, 'kg')).toBe('3 × 16 · 8/side')
  })
  it('marks added weight as added', () => {
    expect(exLine({ id: BW, sets: 3, reps: 8, weight: 10 }, 'kg')).toBe('3 × 8 · +10 kg')
  })
  it('summarises a planned exercise per mode', () => {
    expect(exLine({ id: LIFT, sets: 3, reps: 10 }, 'kg')).toBe('3 × 10')
    expect(exLine({ id: LIFT, sets: 3, reps: 10, weight: 60 }, 'kg')).toBe('3 × 10 · 60 kg')
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time' }, 'kg')).toBe('3 × 0:45')
    expect(exLine({ id: LIFT, sets: 2, sec: 90, weight: 20, mode: 'time' }, 'kg')).toBe('2 × 1:30 · 20 kg')
    expect(exLine({ id: CARDIO, sets: 1, min: 20, speed: 8 }, 'kg')).toBe('1 × 20 min @ 8 km/h')
  })
})

const emptyS = { workouts: [], exWeights: {} }

describe('active workout history policy', () => {
  const selected = {
    id: 'selected-workout', d: '2026-01-01', unit: 'kg', entries: [{
      id: LIFT,
      target: { mode: 'reps', sets: 2, reps: 5, weight: 60, unit: 'kg' },
      sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true },
        { phase: 'work', mode: 'reps', unit: 'kg', w: 62.5, r: 4, done: true }
      ]
    }]
  }

  it('gives fresh freestyle no workout or exWeights history at all', () => {
    const state = {
      unit: 'kg',
      exWeights: { [LIFT]: { w: 100, unit: 'kg' } },
      workouts: [selected]
    }
    const scoped = activeWorkoutHistoryState(state, {
      routineId: null,
      historyPolicy: { kind: 'fresh-freestyle' }
    })

    expect(scoped.workouts).toEqual([])
    expect(scoped.exWeights).toEqual({})
    expect(lastEntryFor(scoped, LIFT, 'reps')).toBeNull()
    expect(buildSets(scoped, { id: LIFT, mode: 'reps', sets: 1, reps: 10, weight: 0 }))
      .toEqual([{ w: 0, r: 10, done: false }])
  })

  it('gives repeated freestyle the selected workout only, never newer global history', () => {
    const newer = {
      ...selected,
      id: 'newer-workout', d: '2026-01-02',
      entries: [{ ...selected.entries[0], target: { ...selected.entries[0].target, reps: 8, weight: 100 }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 8, done: true }
      ] }]
    }
    const state = {
      unit: 'kg',
      exWeights: { [LIFT]: { w: 120, unit: 'kg' } },
      workouts: [selected, newer]
    }
    const scoped = activeWorkoutHistoryState(state, {
      routineId: null,
      historyPolicy: { kind: 'selected-freestyle', workout: selected }
    })

    expect(scoped.workouts).toEqual([selected])
    expect(scoped.exWeights).toEqual({})
    expect(lastEntryFor(scoped, LIFT, 'reps')).toMatchObject({ d: '2026-01-01', sets: [{ w: 60 }, { w: 62.5 }] })
    expect(buildSets(scoped, { id: LIFT, mode: 'reps', sets: 2, reps: 5, weight: 0 }))
      .toEqual([{ w: 60, r: 5, done: false }, { w: 62.5, r: 4, done: false }])
  })

  it('leaves routine and programme sessions on the global history policy', () => {
    const state = { unit: 'kg', exWeights: { [LIFT]: { w: 100, unit: 'kg' } }, workouts: [selected] }
    expect(activeWorkoutHistoryPolicy({ routineId: 'push' })).toBe('global')
    expect(activeWorkoutHistoryPolicy({ routineId: null, sessionType: 'programme', programmeId: 'p' })).toBe('global')
    expect(activeWorkoutHistoryState(state, { routineId: 'push' })).toBe(state)
    expect(activeWorkoutHistoryState(state, { routineId: null, sessionType: 'programme', programmeId: 'p' })).toBe(state)
  })

  it.each([
    ['sessionType', { sessionType: 'programme' }],
    ['kind', { kind: 'programme' }],
    ['programmeSession', { programmeSession: true }],
    ['programmeId', { programmeId: 'programme-1' }],
    ['programme', { programme: { id: 'programme-1' } }],
    ['cycleId', { cycleId: 'cycle-1' }],
    ['cycle', { cycle: { id: 'cycle-1' } }]
  ])('classifies a legacy Programme marker (%s) as global even without a routine id', (_label, marker) => {
    expect(activeWorkoutHistoryPolicy({ routineId: null, ...marker })).toBe('global')
  })

  it('keeps an instance-marked legacy session global before the freestyle fallback', () => {
    expect(activeWorkoutHistoryPolicy({ routineId: null, instanceId: 'programme-instance' })).toBe('global')
  })

  it('classifies a marker-free legacy freestyle as fresh and strips all history', () => {
    const state = {
      unit: 'kg',
      exWeights: { [LIFT]: { w: 125, unit: 'kg' } },
      workouts: [selected]
    }
    const scoped = activeWorkoutHistoryState(state, { routineId: null })

    expect(activeWorkoutHistoryPolicy({ routineId: null })).toBe('fresh-freestyle')
    expect(scoped.workouts).toEqual([])
    expect(scoped.exWeights).toEqual({})
    expect(lastEntryFor(scoped, LIFT, 'reps')).toBeNull()
  })

  it('uses only the latest global eligible work entry for an explicit fresh-freestyle percentage', () => {
    const older = {
      d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }] }]
    }
    const newer = {
      d: '2026-01-02', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }] }]
    }
    const state = { unit: 'kg', exWeights: { [LIFT]: { w: 125, unit: 'kg' } }, workouts: [older, newer] }
    const active = { routineId: null, historyPolicy: { kind: 'fresh-freestyle' } }

    expect(activeWorkoutLoadReference(state, active,
      { weightPrescription: { kind: 'percentage', percent: 50 } }, LIFT, 'reps'))
      .toMatchObject({ d: '2026-01-02', sets: [{ w: 80, r: 3 }] })
    expect(activeWorkoutLoadReference(state, active, { weight: 70 }, LIFT, 'reps')).toBeNull()
  })

  it.each([
    ['zero-load reps row', { phase: 'work', mode: 'reps', unit: 'kg', w: 0, r: 10, done: true }],
    ['zero-reps row', { phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 0, done: true }],
    ['out-of-range reps row', { phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 13, done: true }],
    ['timed row with stale reps', { phase: 'work', mode: 'time', unit: 'kg', w: 200, r: 10, sec: 60, done: true }],
    ['incompatible-unit row', { phase: 'work', mode: 'reps', unit: 'lb', w: 80, r: 3, done: true }]
  ])('skips a newer %s and keeps the latest eligible reps reference', (_label, newerSet) => {
    const older = {
      d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true }] }]
    }
    const newerUnit = newerSet.unit === 'lb' ? 'lb' : 'kg'
    const newer = {
      d: '2026-01-02', unit: newerUnit, entries: [{ id: LIFT, unit: newerUnit, target: { mode: newerSet.mode },
        sets: [newerSet] }]
    }
    const state = { unit: 'kg', exWeights: {}, workouts: [older, newer] }
    const active = { routineId: null, historyPolicy: { kind: 'fresh-freestyle' } }

    expect(activeWorkoutLoadReference(state, active,
      { weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 10 } }, LIFT, 'reps'))
      .toMatchObject({ d: '2026-01-01', sets: [{ w: 100, r: 5 }] })
  })

  it('uses the newest eligible estimate rather than the all-time highest estimate', () => {
    const older = {
      d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true }] }]
    }
    const newer = {
      d: '2026-01-02', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }] }]
    }
    const state = { unit: 'kg', exWeights: {}, workouts: [older, newer] }
    const active = { routineId: null, historyPolicy: { kind: 'fresh-freestyle' } }

    expect(activeWorkoutLoadReference(state, active,
      { weightPrescription: { kind: 'percentage', percent: 50 } }, LIFT, 'reps'))
      .toMatchObject({ d: '2026-01-02', sets: [{ w: 80, r: 3 }] })
  })

  it('uses global exact-compatible history for explicit percentage references in selected Repeat', () => {
    const selected = {
      d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }] }]
    }
    const newer = {
      d: '2026-01-02', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }] }]
    }
    const state = { unit: 'kg', exWeights: {}, workouts: [selected, newer] }
    const active = { routineId: null, historyPolicy: { kind: 'selected-freestyle', workout: selected } }

    expect(activeWorkoutLoadReference(state, active,
      { weightPrescription: { kind: 'percentage', source: 'latest', percent: 50 } }, LIFT, 'reps'))
      .toMatchObject({ d: '2026-01-02', sets: [{ w: 80, r: 3 }] })
  })
})

describe('last setup reuse', () => {
  it('projects only a completed exact exercise, unit, and mode-compatible planned setup', () => {
    const state = {
      unit: 'kg',
      workouts: [{
        d: '2026-08-20', unit: 'kg', entries: [{
          id: LIFT, unit: 'kg',
          target: {
            mode: 'reps', sets: 3, reps: 5, kind: 'amrap', amrapMinReps: 6, unit: 'kg',
            weight: 60, resolvedWeight: 60,
            weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 45 },
            warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 30 }],
            warmupRestSec: 45, workRestSec: 90, prog: 'greyskull', inc: 2.5,
            amrapMissPolicy: 'maintain', bodyweight: false, side: true, notes: 'routine note', cues: 'private cue',
            done: true, results: { private: true }, historyId: 'history-forbidden', timerId: 'forbidden'
          },
          plan: { policy: 'greyskull', weight: 62.5 },
          sets: [
            { phase: 'warmup', mode: 'reps', unit: 'kg', w: 20, r: 8, done: true, restSec: 30, results: ['private'] },
            { phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 9, done: true, amrapRole: 'progression', effort: 9,
              timer: { started: 1 }, historyId: 'set-history-forbidden' }
          ]
        }]
      }]
    }

    const setup = lastSetupFor(state, LIFT, 'reps')
    expect(setup).toEqual({
      date: '2026-08-20', summary: '3 × 6 reps · AMRAP ≥ 6',
      config: {
        mode: 'reps', sets: 3, reps: 5, kind: 'amrap', amrapMinReps: 6,
        weight: 60,
        weightPrescription: { kind: 'percentage', source: 'adaptive', percent: 75, fallbackWeight: 45 },
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 30 }],
        warmupRestSec: 45, workRestSec: 90, prog: 'greyskull', inc: 2.5,
        amrapMissPolicy: 'maintain', bodyweight: false, side: true,
        amrapRoles: ['progression']
      }
    })
    expect(setup).not.toHaveProperty('occurrenceId')
    expect(setup.config).not.toHaveProperty('notes')
    expect(setup.config).not.toHaveProperty('cues')
    expect(setup.config).not.toHaveProperty('done')
    expect(setup.config).not.toHaveProperty('results')
    expect(setup.config).not.toHaveProperty('historyId')
  })

  const completedEntry = (id, weight, target = {}) => ({
    id, unit: 'kg', occurrenceId: `${id}-occurrence`,
    target: { mode: 'reps', sets: 1, reps: 5, weight, unit: 'kg', ...target },
    notes: 'private entry note', cues: 'private cue',
    sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: weight, r: 5, done: true }]
  })

  it('returns null when the only compatible row belongs to another exercise', () => {
    const state = {
      unit: 'kg',
      workouts: [{ d: '2026-08-20', unit: 'kg', entries: [completedEntry(OTHER_LIFT, 90)] }]
    }

    expect(lastSetupFor(state, LIFT, 'reps')).toBeNull()
  })

  it.each([
    ['other row before the exact row', (other, exact) => [other, exact]],
    ['other row after the exact row', (other, exact) => [exact, other]]
  ])('chooses the exact exercise when an %s exists', (_label, order) => {
    const exact = completedEntry(LIFT, 60)
    const other = completedEntry(OTHER_LIFT, 90)
    const state = {
      unit: 'kg',
      workouts: [{ d: '2026-08-20', unit: 'kg', entries: order(other, exact) }]
    }

    expect(lastSetupFor(state, LIFT, 'reps')?.config).toMatchObject({ weight: 60 })
  })

  it('skips a newer incomplete same-ID row and reuses the older valid setup', () => {
    const incomplete = completedEntry(LIFT, 90)
    incomplete.sets[0].done = false
    const state = {
      unit: 'kg',
      workouts: [
        { d: '2026-08-19', unit: 'kg', entries: [completedEntry(LIFT, 60)] },
        { d: '2026-08-20', unit: 'kg', entries: [incomplete] }
      ]
    }

    expect(lastSetupFor(state, LIFT, 'reps')?.config).toMatchObject({ weight: 60 })
  })

  it('skips newer same-ID rows with the wrong unit or mode', () => {
    const wrongMode = completedEntry(LIFT, 90, { mode: 'time', sec: 60 })
    wrongMode.sets = [{ phase: 'work', mode: 'time', unit: 'kg', sec: 60, done: true }]
    const wrongUnit = {
      ...completedEntry(LIFT, 100), unit: 'lb',
      target: { mode: 'reps', sets: 1, reps: 5, weight: 100, unit: 'lb' },
      sets: [{ phase: 'work', mode: 'reps', unit: 'lb', w: 100, r: 5, done: true }]
    }
    const state = {
      unit: 'kg',
      workouts: [{
        d: '2026-08-20', unit: 'kg', entries: [completedEntry(LIFT, 60), wrongMode]
      }, {
        d: '2026-08-21', unit: 'lb', entries: [wrongUnit]
      }]
    }

    expect(lastSetupFor(state, LIFT, 'reps')?.config).toMatchObject({ weight: 60 })
  })

  it('keeps custom and built-in exercise IDs isolated', () => {
    const customId = 'custom-last-setup'
    const state = {
      unit: 'kg',
      workouts: [{ d: '2026-08-20', unit: 'kg', entries: [
        completedEntry(LIFT, 60), completedEntry(customId, 80)
      ] }]
    }

    expect(lastSetupFor(state, LIFT, 'reps')?.config).toMatchObject({ weight: 60 })
    expect(lastSetupFor(state, customId, 'reps')?.config).toMatchObject({ weight: 80 })
    expect(lastSetupFor(state, 'custom-last-setup-missing', 'reps')).toBeNull()
  })

  it('fails closed for incompatible mode, unit, legacy target, and incomplete rows', () => {
    const base = {
      d: '2026-08-20', unit: 'kg', entries: [{
        id: LIFT, unit: 'kg', target: { mode: 'reps', sets: 1, reps: 5, weight: 60 },
        sets: [{ phase: 'work', mode: 'reps', w: 60, r: 5, done: true }]
      }]
    }
    expect(lastSetupFor({ unit: 'kg', workouts: [base] }, LIFT, 'time')).toBeNull()
    expect(lastSetupFor({ unit: 'lb', workouts: [base] }, LIFT, 'reps')).toBeNull()
    expect(lastSetupFor({ unit: 'kg', workouts: [{ ...base, entries: [{ ...base.entries[0], target: null }] }] }, LIFT, 'reps')).toBeNull()
    expect(lastSetupFor({ unit: 'kg', workouts: [{ ...base, entries: [{ ...base.entries[0], sets: [{ phase: 'work', mode: 'reps', w: 60, r: 5, done: false }] }] }] }, LIFT, 'reps')).toBeNull()
  })

  it('skips incomplete and incompatible duplicate occurrences to find the newest compatible setup', () => {
    const duplicate = (target, sets) => ({ id: LIFT, unit: 'kg', target, sets })
    const state = {
      unit: 'kg',
      workouts: [{
        d: '2026-08-20', unit: 'kg', entries: [
          duplicate({ mode: 'reps', sets: 1, reps: 5, weight: 40, unit: 'kg' }, [{ phase: 'work', mode: 'reps', unit: 'kg', w: 40, r: 5, done: false }]),
          duplicate({ mode: 'time', sets: 1, sec: 30, weight: 0, unit: 'kg' }, [{ phase: 'work', mode: 'time', unit: 'kg', sec: 30, done: true }]),
          duplicate({ mode: 'reps', sets: 2, reps: 6, weight: 50, unit: 'kg' }, [{ phase: 'work', mode: 'reps', unit: 'kg', w: 50, r: 6, done: true }]),
        ]
      }]
    }

    expect(lastSetupFor(state, LIFT, 'reps')?.config).toMatchObject({ mode: 'reps', sets: 2, reps: 6, weight: 50 })
  })

  it('does not reuse an explicitly partial or incomplete completed-history record', () => {
    const incomplete = {
      d: '2026-08-21', unit: 'kg', complete: false, entries: [{
        id: LIFT, target: { mode: 'reps', sets: 1, reps: 5, weight: 70 },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 70, r: 5, done: true }]
      }]
    }
    const partial = {
      d: '2026-08-20', unit: 'kg', partial: true, entries: [{
        id: LIFT, target: { mode: 'reps', sets: 1, reps: 5, weight: 60 },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }]
      }]
    }
    expect(lastSetupFor({ unit: 'kg', workouts: [partial, incomplete] }, LIFT, 'reps')).toBeNull()
  })
})

describe('history builders share the non-warm-up work boundary', () => {
  const makeState = warmup => normalizeState({ unit: 'kg', workouts: [{
    d: '2026-03-01', unit: 'kg', entries: [{
      id: LIFT, unit: 'kg', target: { mode: 'reps', sets: 2, reps: 5, weight: 60, unit: 'kg' },
      sets: [
        { unit: 'kg', w: 20, r: 8, mode: 'reps', done: true, ...warmup },
        { unit: 'kg', w: 60, r: 5, mode: 'reps', done: true },
        { unit: 'kg', w: 60, r: 5, mode: 'reps', done: true }
      ]
    }]
  }] })

  it.each([
    ['legacy boolean', { warmup: true }],
    ['explicit phase', { phase: 'warmup' }]
  ])('excludes the %s warm-up from lastEntryFor and buildSets', (_label, warmup) => {
    const S = makeState(warmup)
    expect(lastEntryFor(S, LIFT, 'reps').sets.map(set => set.w)).toEqual([60, 60])
    expect(buildSets(S, { id: LIFT, mode: 'reps', sets: 2, reps: 5, weight: 0 }))
      .toEqual([{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }])
  })

  it('does not treat a warm-up-only history row as a completed work session', () => {
    for (const warmup of [{ warmup: true }, { phase: 'warmup' }]) {
      const S = normalizeState({ unit: 'kg', workouts: [{
        d: '2026-03-02', unit: 'kg', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps', sets: 1, reps: 5, weight: 50, unit: 'kg' }, sets: [
          { unit: 'kg', w: 20, r: 8, mode: 'reps', done: true, ...warmup }
        ] }]
      }] })
      expect(lastEntryFor(S, LIFT, 'reps')).toBeNull()
    }
  })
})

describe('workSetsDone shares the non-warm-up work boundary', () => {
  it.each([
    ['legacy boolean', { phase: 'work', warmup: true }],
    ['explicit phase', { phase: 'warmup' }]
  ])('excludes a completed %s warm-up', (_label, marker) => {
    const workout = { entries: [{ sets: [
      { ...marker, done: true },
      { phase: 'work', done: true }
    ] }] }
    expect(workSetsDone(workout)).toBe(1)
  })
})

describe('cascadeWeight shares the canonical warm-up boundary', () => {
  it.each([
    ['legacy boolean', { phase: 'work', warmup: true }],
    ['explicit phase', { phase: 'warmup' }]
  ])('does not cascade a warm-up change into work rows for %s rows', (_label, marker) => {
    const rows = [
      { ...marker, w: 20, done: false },
      { ...marker, w: 22, done: false },
      { phase: 'work', w: 60, done: false },
      { phase: 'work', w: 70, done: true }
    ]
    expect(cascadeWeight(rows, 0, 30).map(row => row.w)).toEqual([20, 30, 60, 70])
  })
})

describe('buildSets', () => {
  it('builds reps sets from the plan when there is no history', () => {
    expect(buildSets(emptyS, { id: LIFT, sets: 3, reps: 8, weight: 50 }))
      .toEqual([{ w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }])
  })

  it('builds timed sets, carrying the planned duration and load', () => {
    expect(buildSets(emptyS, { id: LIFT, mode: 'time', sets: 2, sec: 60, weight: 20 }))
      .toEqual([{ sec: 60, w: 20, done: false }, { sec: 60, w: 20, done: false }])
  })

  it('builds cardio sets unchanged', () => {
    expect(buildSets(emptyS, { id: CARDIO, sets: 1, min: 25, speed: 9 }))
      .toEqual([{ min: 25, speed: 9, done: false }])
  })

  it('carries last time\'s numbers forward within the same mode', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 2, sec: 45, weight: 0 }))
      .toEqual([{ sec: 70, w: 10, done: false }, { sec: 70, w: 10, done: false }])
  })

  it('does not seed a duration from a rep count when an exercise switches to time', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0 }))
      .toEqual([{ sec: 45, w: 0, done: false }])
  })

  it('does not seed reps from a timed set when an exercise switches back', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'reps', sets: 1, reps: 8, weight: 40 }))
      .toEqual([{ w: 40, r: 8, done: false }])
  })

  it('still prefers an explicitly current confirmed working weight for reps sets', () => {
    const S = { unit: 'kg', exWeights: { [LIFT]: { w: 75, unit: 'kg' } }, workouts: [{ unit: 'kg', d: '2026-01-01', entries: [{ id: LIFT, sets: [{ unit: 'kg', w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 75, r: 10, done: false }])
  })

  it('does not reuse a cached pound weight while the profile is in kilograms', () => {
    const S = { unit: 'kg', exWeights: { [LIFT]: { w: 135, unit: 'lb', d: '2026-01-01' } }, workouts: [] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 60 })).toEqual([{ w: 60, r: 8, done: false }])
  })

  it('does not reuse an untagged legacy cache in either unit', () => {
    const S = { unit: 'lb', exWeights: { [LIFT]: { w: 135, d: '2026-01-01' } }, workouts: [] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 100 })).toEqual([{ w: 100, r: 8, done: false }])
  })

  it('honours a workout-start resolved load over a stale confirmed weight', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50, resolvedWeight: 35 }))
      .toEqual([{ w: 35, r: 8, done: false }])
  })

  it('keeps mode-specific history separate across a reps/time mode switch', () => {
    const S = { exWeights: {}, workouts: [
      { d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] },
      { d: '2026-01-02', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }
    ] }
    expect(buildSets(S, { id: LIFT, mode: 'reps', sets: 1, reps: 8, weight: 40 })).toEqual([{ w: 60, r: 10, done: false }])
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0 })).toEqual([{ sec: 70, w: 10, done: false }])
  })

  it('can preserve each last set weight for freestyle instead of using the working-weight hint', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [
      { w: 60, r: 10, done: true }, { w: 62.5, r: 8, done: true }
    ] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 2, reps: 8, weight: 50 }, { preferLast: true }))
      .toEqual([{ w: 60, r: 10, done: false }, { w: 62.5, r: 8, done: false }])
  })
})

describe('workoutVolume', () => {
  it('counts reps work and leaves timed/cardio sets out — there is no weight × reps for a hold', () => {
    const w = { entries: [
      { id: LIFT, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: false }] },
      { id: LIFT, target: { mode: 'time' }, sets: [{ sec: 60, w: 20, done: true }] },
      { id: CARDIO, sets: [{ min: 20, speed: 9, done: true }] }
    ] }
    expect(workoutVolume(w)).toBe(600)
  })

  it('attributes completed volume and completed sets by phase', () => {
    const w = { entries: [
      { id: LIFT, target: { mode: 'time' }, sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 10, done: true },
        { phase: 'work', mode: 'time', sec: 45, w: 20, done: true }
      ] },
      { id: LIFT, sets: [{ phase: 'work', w: 60, r: 5, done: true }] }
    ] }
    expect(volumeByPhase(w)).toEqual({ warmup: 200, work: 300 })
    expect(setsByPhase(w)).toEqual({ warmup: 1, work: 2 })
  })

  it('does not treat a targetless timed record as a best reps weight', () => {
    const S = { workouts: [
      { d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 200, r: 5, sec: 60, done: true }] }] },
      { d: '2026-01-02', entries: [{ id: LIFT, sets: [{ w: 70, r: 5, done: true }] }] }
    ] }
    expect(lastEntryFor(S, LIFT, 'reps').sets[0].w).toBe(70)
    expect(lastEntryFor(S, LIFT, 'time').sets[0].sec).toBe(60)
    // the timed record still contributes its completed load as a fallback (owner blocker: no 0)
    expect(bestWeightFor(S, LIFT)).toBe(200)
  })

  it('does not reuse rep-shaped rows from a persisted timed target', () => {
    const S = { workouts: [
      { d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time', sec: 45 }, topW: 999, sets: [{ w: 200, r: 5, done: true }] }] },
      { d: '2026-01-02', entries: [{ id: LIFT, target: { mode: 'reps', reps: 5 }, sets: [{ w: 70, r: 5, done: true }] }] }
    ] }
    expect(lastEntryFor(S, LIFT, 'reps').sets[0].w).toBe(70)
    // the timed-target record's completed load is the fallback (owner blocker: no 0)
    expect(bestWeightFor(S, LIFT)).toBe(200)
  })

  it('uses an explicit completed reps row under a timed target for strength state', () => {
    const S = { unit: 'kg', workouts: [
      { unit: 'kg', d: '2026-01-01', entries: [{ id: LIFT, unit: 'kg', target: { mode: 'time', sec: 45 }, topW: 200, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true },
        { phase: 'work', mode: 'time', unit: 'kg', w: 200, sec: 60, done: true }
      ] }] },
      { unit: 'kg', d: '2026-01-02', entries: [{ id: LIFT, target: { mode: 'reps', reps: 5 }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 90, r: 5, done: true }
      ] }] }
    ] }

    expect(bestWeightFor(S, LIFT)).toBe(100)
    expect(90 > bestWeightFor(S, LIFT)).toBe(false)
  })

  it('uses the explicit reps row under a timed parent and never trusts stale topW', () => {
    const entry = { id: LIFT, unit: 'kg', target: { mode: 'time', sec: 45 }, topW: 200, sets: [
      { phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true }
    ] }
    expect(metricModeForEntry(entry)).toBe('reps')
    expect(metricRowsForEntry(entry, 'reps')).toEqual([entry.sets[0]])
    expect(bestWeightForEntry(entry)).toBe(100)
    expect(bestWeightFor({ unit: 'kg', workouts: [{ unit: 'kg', entries: [entry] }] }, LIFT)).toBe(100)
  })

  it('uses topW only for an otherwise wholly reps-compatible entry', () => {
    const entry = { target: { mode: 'reps', reps: 5 }, topW: 80, sets: [
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
    ] }
    expect(bestWeightForEntry(entry)).toBe(80)
  })

  it('selects only completed rows for a mixed Stats metric and keeps non-reps rows separate', () => {
    const entry = { target: { mode: 'time', sec: 45 }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'work', mode: 'reps', w: 100, r: 5, done: true },
      { phase: 'work', mode: 'time', w: 200, sec: 60, done: true },
      { phase: 'work', mode: 'reps', w: 110, r: 5, done: false }
    ] }
    expect(metricModeForEntry(entry)).toBe('reps')
    expect(metricRowsForEntry(entry, 'reps')).toEqual([entry.sets[1]])
    expect(metricRowsForEntry(entry, 'time')).toEqual([entry.sets[2]])
    expect(metricRowsForEntry(entry, 'cardio')).toEqual([])
  })

  it('keeps explicit reps rows under a timed parent in the reps history cache', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT,
      target: { mode: 'time', sec: 45 }, sets: [
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: true },
        { phase: 'work', mode: 'time', w: 200, sec: 60, done: true }
      ]
    }] }] }
    expect(lastEntryFor(S, LIFT, 'reps').sets).toEqual([S.workouts[0].entries[0].sets[0]])
    expect(buildSets(S, { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 40 }))
      .toEqual([{ w: 100, r: 5, done: false }])
  })

  it('excludes an unannotated rep-shaped row under a timed parent from historical best weight', () => {
    const S = { unit: 'kg', workouts: [
      { unit: 'kg', d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time', sec: 45 }, topW: 200, sets: [
        { phase: 'work', unit: 'kg', w: 200, r: 12, done: true }
      ] }] },
      { unit: 'kg', d: '2026-01-02', entries: [{ id: LIFT, target: { mode: 'reps', reps: 5 }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true }
      ] }] }
    ] }

    expect(bestWeightFor(S, LIFT)).toBe(100)
  })

  it('uses authoritative reps work rows from a mixed entry for load PR comparison', () => {
    const S = { unit: 'kg', workouts: [
      { unit: 'kg', d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'reps', reps: 5 }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true },
        { phase: 'work', mode: 'time', unit: 'kg', w: 200, sec: 60, done: true }
      ] }] },
      { unit: 'kg', d: '2026-01-02', entries: [{ id: LIFT, target: { mode: 'reps', reps: 5 }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 90, r: 5, done: true }
      ] }] }
    ] }

    expect(bestWeightFor(S, LIFT)).toBe(100)
    expect(90 > bestWeightFor(S, LIFT)).toBe(false)
  })

  it('does not treat timed-only work as a strength weight', () => {
    const S = { unit: 'kg', workouts: [{
      unit: 'kg', d: '2026-01-03', entries: [{ id: LIFT, target: { mode: 'time', sec: 60 }, sets: [
        { phase: 'work', mode: 'time', unit: 'kg', w: 200, sec: 60, done: true }
      ] }]
    }] }

    // timed-only work contributes its completed load as the fallback (owner blocker: no 0)
    expect(bestWeightFor(S, LIFT)).toBe(200)
  })

  it('excludes unitless weighted legacy history while retaining no-load bodyweight and timed rows', () => {
    const S = { unit: 'kg', workouts: [
      { d: '2026-01-03', entries: [{ id: LIFT, sets: [{ w: 135, r: 5, done: true }] }] },
      { d: '2026-01-04', entries: [{ id: LIFT, sets: [{ w: 0, r: 10, done: true }] }] },
      { d: '2026-01-05', entries: [{ id: LIFT, target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: true }] }] }
    ] }
    expect(historyUnitCompatible(S.workouts[0], S.unit)).toBe(false)
    expect(historyUnitCompatible(S.workouts[1], S.unit)).toBe(true)
    expect(historyUnitCompatible(S.workouts[2], S.unit)).toBe(true)
    expect(workoutsForUnit(S)).toHaveLength(2)
    expect(lastEntryFor(S, LIFT, 'reps').sets[0]).toMatchObject({ w: 0, r: 10 })
    expect(bestWeightFor(S, LIFT)).toBe(0)
    expect(workoutVolume(S.workouts[0], S.unit)).toBe(0)
  })

  it('uses the profile unit for legacy rows but does not carry a different-unit row forward', () => {
    const S = { unit: 'kg', workouts: [
      { d: '2026-01-01', unit: 'lb', entries: [{ id: LIFT, sets: [{ unit: 'lb', w: 200, r: 5, done: true }] }] },
      { d: '2026-01-02', unit: 'kg', entries: [{ id: LIFT, sets: [{ unit: 'kg', w: 70, r: 5, done: true }] }] }
    ] }
    expect(lastEntryFor(S, LIFT, 'reps').sets[0].w).toBe(70)
    expect(bestWeightFor(S, LIFT)).toBe(70)
  })

  it('rejects a latest entry whose working sets mix weight units', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [
      { unit: 'kg', w: 70, r: 5, done: true }, { unit: 'lb', w: 200, r: 5, done: true }
    ] }] }] }
    expect(lastEntryFor(S, LIFT, 'reps')).toBeNull()
    expect(bestWeightFor(S, LIFT)).toBe(0)
  })

  it('uses one unit-compatible workout set for visible Home counts', () => {
    const S = { unit: 'kg', workouts: [
      { id: 'current', d: '2026-01-01', unit: 'kg', entries: [{ id: LIFT,
        sets: [{ unit: 'kg', w: 60, r: 5, done: true }] }] },
      { id: 'other-unit', d: '2026-01-02', unit: 'lb', entries: [{ id: LIFT,
        sets: [{ unit: 'lb', w: 135, r: 5, done: true }] }] },
      { id: 'mixed', d: '2026-01-03', unit: 'kg', entries: [{ id: LIFT, sets: [
        { unit: 'kg', w: 60, r: 5, done: true }, { unit: 'lb', w: 135, r: 5, done: true }
      ] }] },
      { id: 'legacy-weight', d: '2026-01-04', entries: [{ id: LIFT,
        sets: [{ w: 60, r: 5, done: true }] }] },
      { id: 'legacy-bodyweight', d: '2026-01-05', entries: [{ id: LIFT,
        sets: [{ w: 0, r: 10, done: true }] }] }
    ] }

    expect(workoutsForUnit(S).map(workout => workout.id)).toEqual(['current', 'legacy-bodyweight'])
  })
  it('needs no per-side case — the logged reps are already both sides (issue #31)', () => {
    const w = { entries: [{ id: LIFT, target: { side: true }, sets: [{ w: 20, r: 16, done: true }] }] }
    expect(workoutVolume(w)).toBe(320)
  })

  it('leaves an unloaded bodyweight set at zero volume rather than inventing a number', () => {
    const w = { entries: [{ id: BW, target: { bodyweight: true }, sets: [{ w: 0, r: 20, done: true }] }] }
    expect(workoutVolume(w)).toBe(0)
  })


  it('merges both contiguous groups when their boundary entries are paired', () => {
    const entries = [
      { id: 'a', sg: 'left' }, { id: 'b', sg: 'left' },
      { id: 'c', sg: 'right' }, { id: 'd', sg: 'right' }
    ]

    const merged = pairAdjacent(entries, 1, 2)

    expect(merged.map(e => e.sg)).toEqual(['left', 'left', 'left', 'left'])
    expect(entries.map(e => e.sg)).toEqual(['left', 'left', 'right', 'right'])
  })

  it('unpairs one entry and removes sg values left without an adjacent partner', () => {
    const entries = [
      { id: 'a', sg: 'group' }, { id: 'b', sg: 'group' }, { id: 'c', sg: 'group' },
      { id: 'd', sg: 'orphan' }
    ]

    const unpaired = unpairSuperset(entries, 1)

    expect(unpaired).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    expect(entries.map(e => e.sg)).toEqual(['group', 'group', 'group', 'orphan'])
  })

  it('rejects a non-adjacent pairing request', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(() => pairAdjacent(entries, 0, 2, 'sg-invalid')).toThrow(/adjacent/)
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })
})

describe('planned routine completion selection', () => {
  const plans = [{ id: 'push' }, { id: 'pull' }]
  const status = workouts => weeklySessionStatus({ workouts }, {
    source: 'classic', routineId: 'push', calendarDate: '2026-07-27'
  })

  it('deduplicates completed routine ids by the local workout date', () => {
    const S = { workouts: [
      { d: '2026-07-27T08:00:00.000Z', routineId: 'push' },
      { d: '2026-07-27', routineId: 'push' },
      { d: '2026-07-26T23:59:59.000Z', routineId: 'pull' },
      { d: '2026-07-27', routineId: null }
    ] }

    expect(completedRoutineIdsForDate(S, '2026-07-27')).toEqual(new Set(['push']))
  })

  it('does not let a Programme partial complete an unrelated classic plan', () => {
    const S = { workouts: [
      { d: '2026-07-27', routineId: 'push', sessionType: 'programme', programmeId: 'p', cycleId: 'c', partial: true },
      { d: '2026-07-27', routineId: 'pull' },
      { d: '2026-07-27', routineId: 'push', classicConversion: true, programmeId: 'p', programmeCreatedFromWeek: '2026-W30', classic: true }
    ] }

    expect(completedRoutineIdsForDate(S, '2026-07-27')).toEqual(new Set(['pull', 'push']))
  })

  it.each([
    ['classicConversion', { classicConversion: true }],
    ['convertedFromWeek', { convertedFromWeek: '2026-W30' }],
    ['programmeCreatedFromWeek plus classic', { programmeCreatedFromWeek: '2026-W30', classic: true }]
  ])('treats a Programme-marked %s record as a completed classic attempt', (_label, marker) => {
    const converted = {
      d: '2026-07-27', routineId: 'push', plannedComplete: true,
      programmeId: 'converted-programme', ...marker
    }

    expect(status([converted])).toBe('done')
    expect(completedRoutineIdsForDate({ workouts: [converted] }, '2026-07-27')).toEqual(new Set(['push']))
    expect(status([converted, {
      d: '2026-07-27', routineId: 'push', plannedComplete: false
    }])).toBe('done')
  })

  it('excludes a true completed Programme record from classic completion projections', () => {
    const programme = {
      d: '2026-07-27', routineId: 'push', plannedComplete: true,
      sessionType: 'programme', programmeId: 'programme', cycleId: 'cycle'
    }

    expect(status([programme])).toBe('start')
    expect(completedRoutineIdsForDate({ workouts: [programme] }, '2026-07-27')).toEqual(new Set())
  })

  it('does not count an explicitly early-finished classic routine as completed', () => {
    const S = { workouts: [
      { d: '2026-07-27', routineId: 'push', plannedComplete: false },
      { d: '2026-07-27', routineId: 'pull', plannedComplete: true }
    ] }

    expect(completedRoutineIdsForDate(S, '2026-07-27')).toEqual(new Set(['pull']))
  })

  it('keeps a completed classic slot done after a later Repeat finishes early', () => {
    const workouts = [
      { id: 'completed', d: '2026-07-27', routineId: 'push', plannedComplete: true },
      { id: 'repeat-early', d: '2026-07-27', routineId: 'push', plannedComplete: false }
    ]

    expect(status(workouts)).toBe('done')
    expect(completedRoutineIdsForDate({ workouts }, '2026-07-27')).toEqual(new Set(['push']))
  })

  it('uses active, completed, early-finished, and discarded precedence for repeated attempts', () => {
    const early = { d: '2026-07-27', routineId: 'push', plannedComplete: false }
    const complete = { d: '2026-07-27', routineId: 'push', plannedComplete: true }
    const session = { source: 'classic', routineId: 'push', calendarDate: '2026-07-27' }

    expect(status([early])).toBe('resume')
    expect(status([early, { ...early, id: 'second' }, complete])).toBe('done')
    expect(weeklySessionStatus({ workouts: [complete], active: {
      d: '2026-07-27', routineId: 'push'
    } }, session)).toBe('resume')
    expect(status([])).toBe('start')
    expect(weeklySessionStatus({ workouts: [complete], active: {
      d: '2026-07-28', routineId: 'push'
    } }, session)).toBe('done')
  })

  it('keeps only an uncompleted plan as the fast-path choice', () => {
    expect(reconcileStartSessionChoice(plans, new Set(), null)).toBe('push')
    expect(reconcileStartSessionChoice(plans, new Set(['push']), 'push')).toBe('pull')
    expect(reconcileStartSessionChoice(plans, new Set(['push', 'pull']), 'pull')).toBeNull()
  })
})