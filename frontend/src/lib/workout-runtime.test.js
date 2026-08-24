import { describe, it, expect, vi } from 'vitest'
import {
  normalizeRestSettings,
  restSecondsFor,
  prepSecondsFor,
  resolveTargetLoad,
  prependWarmupSets,
  timerDurationFor,
  timerDurationForSet,
  canApplyTimedResult,
  sessionConfigFor,
  sessionPlanFor,
  bestFullSetWeight,
  setTableColumnsForMode,
  tableModesForEntry,
  tableModesRequirePerRowHeaders,
  isAmrapEntry,
  amrapRoleForSet,
  cycleAmrapRole,
  effectiveAmrapPolicyForEntry,
  demoteProgressionRolesForPolicy,
  isAmrapResult,
  amrapCapFor,
  amrapResultFor,
  amrapTargetForSet,
  applyPersistedAmrapTargets,
  workRowsForMode,
  shouldConfirmWorkingWeight,
  warmupDraftForEditor,
  warmupConfigForEntry,
  applyWarmupConfigToEntry,
  applyWorkConfigToEntry,
  addSetForEntry,
  appendSetForEntry,
  removeActiveSet,
  navigateActiveExercise,
  REST_PRESETS
} from './workout-runtime.js'
import { buildSets } from './history.js'
import { normalizeState } from './state.js'
import { stampCompletedWorkout, workoutVolumeFromEntries, isProgressionEligible, is1RMEligible, isAmrapRoleEligibleSet } from './workout-model.js'

const STATE_DEF = {
  schemaVersion: 2, unit: 'kg', routines: [], workouts: [], active: null,
  customEx: [], programmes: [], reminder: { on: false }
}

describe('per-set AMRAP roles', () => {
  it('resolves each row target independently without reusing actual logged results', () => {
    const entry = {
      target: { mode: 'reps', kind: 'amrap', reps: 5, amrapMinReps: 5, prog: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: true, amrapRole: 'amrap', amrapTarget: 12 },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false, amrapRole: 'progression', amrapTarget: 5 }
      ]
    }

    expect(amrapTargetForSet(entry, 0)).toBe(12)
    expect(amrapTargetForSet(entry, 1)).toBe(5)
    expect(amrapTargetForSet({ ...entry, sets: [{ ...entry.sets[0], amrapTarget: undefined }] }, 0)).toBe(5)
  })

  it('seeds a newly selected AMRAP row from its prescribed row value', () => {
    const entry = {
      target: { mode: 'reps', kind: 'amrap', reps: 5, amrapMinReps: 5, prog: 'greyskull' },
      sets: [{ phase: 'work', mode: 'reps', w: 20, r: 12, done: false, amrapRole: 'none' }]
    }
    const selected = cycleAmrapRole(entry, 0)
    expect(selected.sets[0]).toMatchObject({ amrapRole: 'amrap', amrapTarget: 12, r: 12 })
  })

  it('restores saved row targets without overwriting the logged result fields', () => {
    const entry = {
      target: { mode: 'reps', kind: 'amrap', reps: 5, prog: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: true, amrapRole: 'amrap' },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false, amrapRole: 'progression' }
      ]
    }
    const restored = applyPersistedAmrapTargets(entry, [12, 5])
    expect(restored.sets.map(set => [set.r, set.amrapTarget])).toEqual([[12, 12], [5, 5]])
  })

  it('preserves an explicit row target when materializing a repeated AMRAP entry', () => {
    const sets = prependWarmupSets(
      { mode: 'reps', kind: 'amrap', reps: 5, prog: 'greyskull' },
      [{ phase: 'work', mode: 'reps', w: 100, r: 20, done: false, amrapRole: 'progression', amrapTarget: 5 }]
    )
    expect(sets[0]).toMatchObject({ r: 20, amrapRole: 'progression', amrapTarget: 5 })
  })
  it('lets one Greyskull work set become the progression driver without a set-count minimum', () => {
    const entry = {
      target: { mode: 'reps', kind: 'amrap', reps: 5, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [{ phase: 'work', mode: 'reps', w: 60, r: 5, amrapRole: 'amrap' }]
    }

    expect(effectiveAmrapPolicyForEntry(entry)).toBe('greyskull')
    expect(cycleAmrapRole(entry, 0).sets[0].amrapRole).toBe('progression')
  })

  it.each(['linear', 'double', 'off'])(
    'demotes a progression driver to ordinary AMRAP under %s without losing AMRAP intent',
    policy => {
      const entry = {
        target: { mode: 'reps', kind: 'amrap', reps: 5, prog: policy },
        plan: { policy },
        sets: [
          { phase: 'work', mode: 'reps', amrapRole: 'progression' },
          { phase: 'work', mode: 'reps', amrapRole: 'amrap' }
        ]
      }

      expect(demoteProgressionRolesForPolicy(entry).sets.map(set => set.amrapRole))
        .toEqual(['amrap', 'amrap'])
      expect(cycleAmrapRole(entry, 0).sets[0].amrapRole).toBe('none')
    }
  )

  it('demotes restored active state at the persistence boundary while preserving completed history', () => {
    const entry = {
      id: 'lift',
      target: { mode: 'reps', reps: 5, prog: 'linear' },
      plan: { policy: 'linear' },
      sets: [{ phase: 'work', mode: 'reps', w: 60, r: 8, done: true, amrapRole: 'progression' }]
    }
    const normalized = normalizeState({
      ...STATE_DEF,
      active: { id: 'active', entries: [entry] },
      workouts: [{ id: 'done', entries: [entry] }],
      lastFinishedSession: { id: 'last-done', entries: [entry] }
    }, STATE_DEF)

    expect(normalized.active.entries[0].sets[0].amrapRole).toBe('amrap')
    expect(normalized.workouts[0].entries[0].sets[0].amrapRole).toBe('progression')
    expect(normalized.lastFinishedSession.entries[0].sets[0].amrapRole).toBe('progression')
  })

  it('uses the final work row only as a legacy fallback and treats any explicit roles as authoritative', () => {
    const legacy = {
      target: { mode: 'reps', kind: 'amrap', reps: 5 },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8 },
        { phase: 'work', mode: 'reps', w: 60, r: 5 },
        { phase: 'work', mode: 'reps', w: 60, r: 5 }
      ]
    }
    expect(legacy.sets.map((_, index) => amrapRoleForSet(legacy, index)))
      .toEqual([null, 'none', 'progression'])

    const explicitNoDriver = {
      ...legacy,
      sets: legacy.sets.map((set, index) => index === 0 ? set : { ...set, amrapRole: 'none' })
    }
    expect(explicitNoDriver.sets.map((_, index) => amrapRoleForSet(explicitNoDriver, index)))
      .toEqual([null, 'none', 'none'])

    const rowEnabled = {
      target: { mode: 'reps', kind: 'fixed', reps: 5 },
      sets: [{ phase: 'work', mode: 'reps', amrapRole: 'amrap' }]
    }
    expect(isAmrapEntry(rowEnabled)).toBe(true)
    expect(isAmrapResult(rowEnabled, 0)).toBe(true)
  })

  it('cycles none to AMRAP to the sole progression driver to none while preserving other AMRAP rows', () => {
    const legacy = {
      target: { mode: 'reps', kind: 'amrap', reps: 5, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8 },
        { phase: 'work', mode: 'reps', w: 60, r: 5 },
        { phase: 'work', mode: 'reps', w: 60, r: 5 }
      ]
    }
    const ordinary = cycleAmrapRole(legacy, 1)
    expect(ordinary.sets.map(set => set.amrapRole ?? null)).toEqual([null, 'amrap', 'progression'])

    const promoted = cycleAmrapRole(ordinary, 1)
    expect(promoted.sets.map(set => set.amrapRole ?? null)).toEqual([null, 'progression', 'amrap'])

    const removed = cycleAmrapRole(promoted, 1)
    expect(removed.sets.map(set => set.amrapRole ?? null)).toEqual([null, 'none', 'amrap'])
    expect(removed.sets.filter(set => set.amrapRole === 'progression')).toHaveLength(0)
  })

  it('materializes a starred final row for new AMRAP sessions and appends an unmarked work row without moving it', () => {
    const sets = prependWarmupSets({ mode: 'reps', kind: 'amrap' }, [
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: false },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: false }
    ])
    expect(sets.map(set => set.amrapRole)).toEqual(['none', 'progression'])

    const appended = appendSetForEntry({
      target: { mode: 'reps', kind: 'amrap', reps: 5 },
      sets: [
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 60, r: 8, done: false }
      ]
    })
    expect(appended.sets.map(set => set.amrapRole)).toEqual(['none', 'progression', 'none'])
    expect(appended.sets[2]).toMatchObject({ phase: 'work', w: 60, r: 8, done: false })
  })

  it('preserves row roles through Work-settings rebuilds and leaves added rows or driver removal unmarked', () => {
    const completedDriver = { phase: 'work', mode: 'reps', w: 60, r: 8, done: true, amrapRole: 'progression' }
    const source = {
      target: { mode: 'reps', kind: 'amrap', sets: 3, reps: 5, weight: 60, prog: 'greyskull' },
      plan: { policy: 'greyskull' },
      sets: [
        completedDriver,
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false, amrapRole: 'amrap' },
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false, amrapRole: 'none' }
      ]
    }
    const unchanged = applyWorkConfigToEntry(source, { sets: 3, reps: 6 })
    expect(unchanged.sets[0]).toBe(completedDriver)
    expect(unchanged.sets.map(set => set.amrapRole)).toEqual(['progression', 'amrap', 'none'])

    const increased = applyWorkConfigToEntry(source, { sets: 4, reps: 6 })
    expect(increased.sets.map(set => set.amrapRole)).toEqual(['progression', 'amrap', 'none', 'none'])

    const removedDriver = applyWorkConfigToEntry({
      ...source,
      sets: source.sets.map((set, index) => ({ ...set, done: false,
        amrapRole: index === 2 ? 'progression' : 'none' }))
    }, { sets: 2, reps: 6 })
    expect(removedDriver.sets.map(set => set.amrapRole)).toEqual(['none', 'none'])

    const legacyIncreased = applyWorkConfigToEntry({
      target: { mode: 'reps', kind: 'amrap', sets: 3, reps: 5, weight: 60 },
      sets: source.sets.map(set => ({ ...set, done: false, amrapRole: undefined }))
        .map(({ amrapRole: _role, ...set }) => set)
    }, { sets: 4, reps: 6 })
    expect(legacyIncreased.sets.map(set => set.amrapRole)).toEqual(['none', 'none', 'progression', 'none'])
  })

  it('preserves explicit row-owned targets across reps Work-settings rebuilds and independent count changes', () => {
    const source = {
      target: { mode: 'reps', kind: 'amrap', sets: 3, reps: 5, weight: 100, prog: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: false, amrapRole: 'amrap', amrapTarget: 12 },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false, amrapRole: 'progression', amrapTarget: 5 },
        { phase: 'work', mode: 'reps', w: 100, r: 8, done: false, amrapRole: 'amrap', amrapTarget: 8 }
      ]
    }

    const stable = applyWorkConfigToEntry(source, { mode: 'reps', sets: 3, reps: 6, weight: 100 })
    expect(stable.sets.map(set => [set.r, set.amrapTarget])).toEqual([[6, 12], [6, 5], [6, 8]])

    const added = applyWorkConfigToEntry(source, { mode: 'reps', sets: 4, reps: 6, weight: 100 })
    expect(added.sets.map(set => set.amrapTarget)).toEqual([12, 5, 8, undefined])
    expect(added.sets[3]).toMatchObject({ r: 6, amrapRole: 'none' })

    const removed = applyWorkConfigToEntry(source, { mode: 'reps', sets: 2, reps: 6, weight: 100 })
    expect(removed.sets.map(set => set.amrapTarget)).toEqual([12, 5])
  })

  it('keeps completed rows immutable while preserving only compatible unfinished targets', () => {
    const completed = {
      phase: 'work', mode: 'reps', w: 20, r: 12, done: true,
      amrapRole: 'amrap', amrapTarget: 12, effort: 9, note: 'logged result'
    }
    const source = {
      target: { mode: 'reps', kind: 'amrap', sets: 2, reps: 5, weight: 100, prog: 'greyskull' },
      sets: [completed, {
        phase: 'work', mode: 'reps', w: 100, r: 5, done: false,
        amrapRole: 'progression', amrapTarget: 5
      }]
    }

    const updated = applyWorkConfigToEntry(source, { mode: 'reps', sets: 2, reps: 6, weight: 100 })
    expect(updated.sets[0]).toBe(completed)
    expect(updated.sets[0]).toMatchObject({ r: 12, amrapTarget: 12, effort: 9, note: 'logged result' })
    expect(updated.sets[1]).toMatchObject({ r: 6, amrapTarget: 5, amrapRole: 'progression' })
  })

  it('reseeds incompatible timed rows from seconds and keeps distinct timed targets independent', () => {
    const source = {
      target: { mode: 'reps', kind: 'amrap', sets: 2, reps: 5, weight: 20, prog: 'greyskull' },
      sets: [
        { phase: 'work', mode: 'reps', w: 20, r: 12, done: false, amrapRole: 'amrap', amrapTarget: 12 },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false, amrapRole: 'progression', amrapTarget: 5 }
      ]
    }

    const timed = applyWorkConfigToEntry(source, { mode: 'time', sets: 2, sec: 30, weight: 20 })
    expect(timed.sets.map(set => [set.mode, set.sec, set.amrapTarget])).toEqual([
      ['time', 30, 30], ['time', 30, 30]
    ])

    const distinct = applyWorkConfigToEntry({
      ...timed,
      sets: timed.sets.map((set, index) => ({ ...set, sec: index === 0 ? 35 : 50, amrapTarget: index === 0 ? 35 : 50 }))
    }, { mode: 'time', sets: 2, sec: 60, weight: 20 })
    expect(distinct.sets.map(set => [set.sec, set.amrapTarget])).toEqual([[60, 35], [60, 50]])
  })

  it('uses each unfinished row prescription for legacy AMRAP target fallback', () => {
    const source = {
      target: { mode: 'reps', kind: 'amrap', sets: 2, reps: 5, weight: 60 },
      sets: [
        { phase: 'work', mode: 'reps', w: 60, r: 12, done: false, amrapRole: 'amrap' },
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false, amrapRole: 'progression' }
      ]
    }
    const updated = applyWorkConfigToEntry({
      ...source,
      sets: source.sets.map(({ amrapRole: _role, ...set }) => set)
    }, { mode: 'reps', sets: 2, reps: 6, weight: 60 })

    expect(updated.sets.map(set => set.amrapTarget)).toEqual([undefined, 6])
    expect(updated.sets.map((_, index) => amrapTargetForSet(updated, index))).toEqual([6, 6])

    const explicitLegacy = applyWorkConfigToEntry({
      ...source,
      sets: source.sets.map(({ amrapRole: _role, ...set }, index) => ({
        ...set,
        ...(index === 1 ? { amrapTarget: 5 } : {})
      }))
    }, { mode: 'reps', sets: 2, reps: 6, weight: 60 })
    expect(explicitLegacy.sets.map(set => set.amrapTarget)).toEqual([undefined, 5])
  })

  it('treats ordinary and starred rows as AMRAP while reporting the starred result', () => {
    const entry = {
      target: { mode: 'reps', kind: 'amrap', reps: 5 },
      sets: [
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: true, amrapRole: 'none' },
        { phase: 'work', mode: 'reps', w: 60, r: 10, done: true, amrapRole: 'progression' },
        { phase: 'work', mode: 'reps', w: 60, r: 12, done: true, amrapRole: 'amrap' }
      ]
    }
    expect(entry.sets.map((_, index) => isAmrapResult(entry, index))).toEqual([false, true, true])
    expect(amrapResultFor(entry)).toMatchObject({ index: 1, actual: 10, target: 5 })
  })

  it('does not promote another row when the progression driver is removed', () => {
    const active = { cur: 0, entries: [{ sets: [
      { phase: 'work', amrapRole: 'none' },
      { phase: 'work', amrapRole: 'progression' },
      { phase: 'work', amrapRole: 'amrap' }
    ] }] }
    expect(removeActiveSet(active, 0, 1)).toEqual({ removed: true, removedExercise: false })
    expect(active.entries[0].sets.map(set => set.amrapRole)).toEqual(['none', 'amrap'])
  })

  it('rejects cardio role cycling and recognition while retaining reps and timed AMRAP support', () => {
    const cardio = {
      target: { mode: 'cardio', kind: 'amrap', min: 20, speed: 9 },
      sets: [{ phase: 'work', mode: 'cardio', min: 20, speed: 9, amrapRole: 'progression' }]
    }
    const cycled = cycleAmrapRole(cardio, 0)
    expect(cycled).toEqual(cardio)
    expect(cycled).not.toBe(cardio)
    expect(cycled.sets[0]).not.toBe(cardio.sets[0])
    expect(isAmrapEntry(cardio)).toBe(false)
    expect(amrapRoleForSet(cardio, 0)).toBeNull()
    expect(isAmrapResult(cardio, 0)).toBe(false)

    for (const mode of ['reps', 'time']) {
      const entry = {
        target: { mode, kind: 'amrap', prog: 'greyskull', ...(mode === 'time' ? { sec: 45 } : { reps: 5 }) },
        plan: { policy: 'greyskull' },
        sets: [{ phase: 'work', mode, amrapRole: 'amrap' }]
      }
      expect(isAmrapEntry(entry)).toBe(true)
      expect(cycleAmrapRole(entry, 0).sets[0].amrapRole).toBe('progression')
    }
  })

  it('strips malformed cardio roles across add-set and Work-settings rebuild paths', () => {
    const completed = {
      phase: 'work', mode: 'cardio', min: 20, speed: 9, done: true,
      note: 'preserve result', amrapRole: 'progression'
    }
    const cardio = {
      target: { mode: 'cardio', sets: 1, min: 20, speed: 9 },
      sets: [completed]
    }

    const appended = appendSetForEntry(cardio)
    expect(appended.sets).toEqual([
      { phase: 'work', mode: 'cardio', min: 20, speed: 9, done: true, note: 'preserve result' },
      { phase: 'work', min: 20, speed: 9, done: false }
    ])

    const rebuilt = applyWorkConfigToEntry(cardio, { sets: 2, min: 25, speed: 10 })
    expect(rebuilt.sets[0]).toEqual({
      phase: 'work', mode: 'cardio', min: 20, speed: 9, done: true, note: 'preserve result'
    })
    expect(rebuilt.sets[1]).not.toHaveProperty('amrapRole')
    expect(completed.amrapRole).toBe('progression')
  })

  it('keeps fresh cardio rows AMRAP-ineligible through prepend, cycle, normalize, and persist', () => {
    const target = { id: 'run', mode: 'cardio', sets: 1, min: 20, speed: 9 }
    const sets = prependWarmupSets(target, buildSets({ workouts: [] }, target))
    expect(sets).toEqual([
      { min: 20, speed: 9, done: false, phase: 'work', mode: 'cardio' }
    ])
    expect(prependWarmupSets({}, [{ min: 12, speed: 8, done: false }])[0].mode).toBe('cardio')

    const entry = { id: 'run', target, sets }
    const cycled = cycleAmrapRole(entry, 0)
    const normalized = normalizeState({ active: { entries: [cycled] } }, STATE_DEF)
    const persisted = JSON.parse(JSON.stringify(normalized))

    for (const stage of [entry, cycled, normalized.active.entries[0], persisted.active.entries[0]]) {
      expect(stage.sets[0].mode).toBe('cardio')
      expect(stage.sets[0]).not.toHaveProperty('amrapRole')
      expect(isAmrapRoleEligibleSet(stage, 0)).toBe(false)
      expect(isAmrapEntry(stage)).toBe(false)
      expect(amrapRoleForSet(stage, 0)).toBeNull()
    }
  })
})

describe('independent rest settings', () => {
  it('publishes an exact zero-second global rest preset', () => {
    expect(REST_PRESETS).toContain(0)
  })

  it('uses set, exercise, routine, then global precedence for each phase', () => {
    const routine = normalizeRestSettings({ warmupRestSec: 35, workRestSec: 95 })
    const exercise = normalizeRestSettings({ warmupRestSec: 40 })
    expect(restSecondsFor({ phase: 'warmup', restSec: 12 }, exercise, routine, 90)).toBe(12)
    expect(restSecondsFor({ phase: 'warmup' }, exercise, routine, 90)).toBe(40)
    expect(restSecondsFor({ phase: 'work' }, exercise, routine, 90)).toBe(95)
    expect(restSecondsFor({ phase: 'warmup' }, {}, {}, 90)).toBe(90)
    expect(restSecondsFor({ phase: 'warmup' }, { warmupRestSec: 0 }, routine, 90)).toBe(0)
  })

  it.each([
    ['legacy boolean', { phase: 'work', warmup: true }],
    ['explicit phase', { phase: 'warmup' }]
  ])('uses the warm-up rest cascade for a %s warm-up row', (_label, set) => {
    expect(restSecondsFor(set, { warmupRestSec: 40, workRestSec: 95 }, {}, 90)).toBe(40)
  })

  it('resolves timed preparation independently and allows it to be disabled', () => {
    expect(prepSecondsFor({}, { prepSec: 3 }, { prepSec: 8 }, 5)).toBe(3)
    expect(prepSecondsFor({ prepSec: 0 }, { prepSec: 3 }, {}, 5)).toBe(0)
  })
})

describe('percentage load resolution and warm-up sets', () => {
  it('resolves Adaptive e1RM per exercise and freezes the explicit fallback', () => {
    const now = Date.parse('2026-08-20T12:00:00Z')
    const state = { workouts: [{
      id: 'done', d: '2026-08-20', entries: [
        { id: 'squat', sets: [{ phase: 'work', mode: 'reps', done: true, unit: 'kg', w: 60, r: 5 }] },
        { id: 'bench', sets: [{ phase: 'work', mode: 'reps', done: true, unit: 'kg', w: 100, r: 5 }] }
      ]
    }] }
    const target = { weightPrescription: {
      kind: 'current_1rm_percentage', currentPercent: 85, fallbackWeight: 20
    } }

    expect(resolveTargetLoad(target, [], 2.5, { state, exerciseId: 'squat', now })).toBe(60)
    expect(resolveTargetLoad(target, [{ phase: 'work', done: true, w: 200, r: 1 }], 2.5,
      { state, exerciseId: 'unknown', now })).toBe(20)
  })

  it('returns Adaptive loads only for the exact compatible profile unit and rejects unitless history', () => {
    const now = Date.parse('2026-08-20T12:00:00Z')
    const target = { weightPrescription: {
      kind: 'current_1rm_percentage', currentPercent: 85, fallbackWeight: 45
    } }
    const pounds = { unit: 'lb', workouts: [{
      id: 'lb-history', d: '2026-08-20', unit: 'lb', entries: [
        { id: 'bench', unit: 'lb', sets: [{ phase: 'work', mode: 'reps', done: true, unit: 'lb', w: 100, r: 5 }] }
      ]
    }] }
    const unitless = { unit: 'lb', workouts: [{
      id: 'legacy-history', d: '2026-08-20', entries: [
        { id: 'bench', sets: [{ phase: 'work', mode: 'reps', done: true, w: 100, r: 5 }] }
      ]
    }] }

    expect(resolveTargetLoad(target, [], 2.5, { state: pounds, exerciseId: 'bench', now })).toBe(100)
    expect(resolveTargetLoad(target, [], 2.5, {
      state: { ...pounds, unit: 'kg' }, exerciseId: 'bench', now, unit: 'lb'
    })).toBe(45)
    expect(resolveTargetLoad(target, [], 2.5, { state: unitless, exerciseId: 'bench', now })).toBe(45)
  })

  it('resolves Adaptive loads through warm-up and active-editor helper boundaries', () => {
    const now = Date.parse('2026-08-20T12:00:00Z')
    const state = { unit: 'kg', workouts: [{
      id: 'history', d: '2026-08-20', unit: 'kg', entries: [
        { id: 'bench', unit: 'kg', sets: [{ phase: 'work', mode: 'reps', done: true, unit: 'kg', w: 100, r: 5 }] }
      ]
    }] }
    const resolveContext = { state, exerciseId: 'bench', now }
    const prescription = { kind: 'current_1rm_percentage', currentPercent: 50, fallbackWeight: 20 }
    const entry = {
      id: 'bench',
      target: { mode: 'reps', sets: 1, reps: 5, weight: 20 },
      sets: [{ phase: 'work', mode: 'reps', w: 20, r: 5, done: false }]
    }

    const warmups = prependWarmupSets({
      warmup: [{ mode: 'reps', reps: 5, weightPrescription: prescription }]
    }, entry.sets, [], 2.5, resolveContext)
    expect(warmups[0].w).toBe(57.5)

    const work = applyWorkConfigToEntry(entry, {
      loadMode: 'current_percentage', loadPercent: 50, loadFallback: 20, sets: 1, reps: 5
    }, [], 2.5, resolveContext)
    expect(work.target.resolvedWeight).toBe(57.5)
    expect(work.sets[0].w).toBe(57.5)

    const editedWarmups = applyWarmupConfigToEntry({ ...entry, target: { ...entry.target, warmup: [] } }, {
      warmup: [{ mode: 'reps', reps: 5, weightPrescription: prescription }]
    }, [], 2.5, resolveContext)
    expect(editedWarmups.sets[0].w).toBe(57.5)
  })

  it('does not use a legacy-boolean warm-up as a percentage work-set source', () => {
    const legacyWarmup = { phase: 'work', warmup: true, mode: 'reps', unit: 'kg', w: 100, r: 5, done: true }
    const target = { mode: 'reps', weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } }
    expect(resolveTargetLoad(target, [], 1, { workSets: [legacyWarmup] })).toBe(10)
  })

  it('resolves Adaptive and Latest-session percentage sources from full state', () => {
    const state = { unit: 'kg', workouts: [
      { d: '2026-01-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 5, done: true }] }] },
      { d: '2026-02-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 90, r: 5, done: true }] }] },
      { d: '2026-03-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 5, done: true }] }] },
    ] }
    const context = { state, exerciseId: 'bench', now: Date.parse('2026-03-02T12:00:00Z') }
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', source: 'adaptive', percent: 50 } }, [], 2.5, context)).toBe(52.5)
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', source: 'latest', percent: 50 } }, [], 2.5, context)).toBe(57.5)
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', source: 'highest', percent: 50 } }, [], 2.5, context)).toBe(52.5)
  })

  it('uses the explicit canonical percentage state instead of falling back to a scoped latest entry', () => {
    const canonicalState = { unit: 'kg', workouts: [
      { d: '2026-01-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 120, r: 5, done: true }] }] },
      { d: '2026-02-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }] }] },
      { d: '2026-03-01', unit: 'kg', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 5, done: true }] }] },
    ] }
    const scopedState = { unit: 'kg', workouts: [] }
    const latestScopedEntry = { phase: 'work', mode: 'reps', unit: 'kg', w: 200, r: 1, done: true }
    const context = {
      state: scopedState,
      percentageState: canonicalState,
      exerciseId: 'bench',
      now: Date.parse('2026-03-02T12:00:00Z')
    }

    // Adaptive median is 93.3, which snaps to 92.5; the scoped latest row would incorrectly resolve to 200.
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', source: 'adaptive', percent: 100 } }, [latestScopedEntry], 2.5, context)).toBe(92.5)
  })

  it('falls back to the configured weight when no compatible percentage history exists', () => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', source: 'latest', percent: 70, fallbackWeight: 22 } }, [], 2.5, {
      state: { unit: 'kg', workouts: [] }, exerciseId: 'bench'
    })).toBe(22.5)
  })

  it.each([
    [12, 70],
    [13, 10],
    [20, 10]
  ])('uses the canonical 1RM cap for %s-rep history instead of clamping it', (reps, expected) => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 10 } }, [
      { phase: 'work', mode: 'reps', done: true, w: 100, r: reps }
    ], 2.5)).toBe(expected)
  })

  it('does not resolve a percentage load from a timed set with stale reps', () => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50 } }, [
      { mode: 'time', phase: 'work', done: true, sec: 60, w: 200, r: 12 }
    ], 2.5)).toBe(0)
  })

  it('does not resolve a percentage load from an unannotated row under a timed parent', () => {
    expect(resolveTargetLoad({ mode: 'time', weightPrescription: { kind: 'percentage', percent: 50 } }, [
      { phase: 'work', done: true, w: 200, r: 12 }
    ], 2.5)).toBe(0)
  })

  it('freezes a safe explicit fallback when no eligible history exists', () => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 15 } }, [
      { phase: 'warmup', done: true, w: 20, r: 10 }
    ], 2.5)).toBe(15)
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50 } }, [], 2.5)).toBe(0)
  })

  it.each([
    ['canonical weightPrescription', { weightPrescription: { kind: 'percentage', percent: 50 } }],
    ['load percent shorthand', { load: { percent: 50 } }],
    ['case-normalized percentage marker', { prescription: { kind: 'PeRcEnTaGe', percentage: 50 } }],
    ['legacy prescription type marker', { prescription: { type: 'PERCENTAGE', percentage: 50 } }],
    ['editor load markers', { loadMode: 'percentage', loadPercent: 50 }]
  ])('resolves supported theoretical percentage prescription shape: %s', (_label, target) => {
    expect(resolveTargetLoad(target, [
      { phase: 'work', mode: 'reps', done: true, w: 80, r: 3 }
    ], 2.5)).toBe(45)
  })

  it('uses a reps reference for a timed theoretical percentage target', () => {
    expect(resolveTargetLoad({ mode: 'time', weightPrescription: { kind: 'percentage', percent: 50 } }, [
      { phase: 'work', mode: 'reps', done: true, w: 80, r: 3 }
    ], 2.5)).toBe(45)
  })

  it('resolves a work-set percentage from explicit session context, otherwise history, then config', () => {
    const target = { weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } }
    expect(resolveTargetLoad(target, [{ phase: 'work', w: 80 }], 2.5, {
      workSets: [{ phase: 'work', w: 100 }, { phase: 'work', w: 90 }]
    })).toBe(50)
    expect(resolveTargetLoad(target, [{ phase: 'warmup', w: 20 }, { phase: 'work', w: 80 }], 2.5, { workSets: [] }))
      .toBe(10)
    expect(resolveTargetLoad(target, { sets: [{ phase: 'warmup', w: 20 }, { phase: 'work', w: 80 }] }, 2.5))
      .toBe(40)
    expect(resolveTargetLoad(target, [{ phase: 'warmup', w: 20 }], 2.5, { workSets: [] })).toBe(10)
  })

  it('resolves a 50% work-set warm-up against the current work rows', () => {
    const sets = prependWarmupSets({
      warmup: [{ mode: 'reps', reps: 8, weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 } }]
    }, [{ phase: 'work', mode: 'reps', r: 5, w: 100, done: false }], [], 2.5)
    expect(sets[0]).toMatchObject({ phase: 'warmup', mode: 'reps', w: 50, r: 8, done: false })
  })

  it('does not leak a theoretical history reference into a work-set warm-up without Work rows', () => {
    const sets = prependWarmupSets({ phases: ['warmup'], warmup: [
      { mode: 'reps', reps: 8, weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 10 } },
      { mode: 'reps', reps: 5, weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 } }
    ] }, [], {
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'reps', done: true, w: 80, r: 3 }]
    }, 2.5)
    expect(sets.map(set => set.w)).toEqual([45, 5])
  })

  it('uses an explicit zero-weight work row instead of falling back to older load', () => {
    const target = { weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } }
    expect(resolveTargetLoad(target, [{ phase: 'work', w: 80 }], 2.5, {
      workSets: [{ phase: 'work', w: 0 }]
    })).toBe(0)
  })

  it('prepends explicit warm-up sets and keeps their phase and resolved load', () => {
    const sets = prependWarmupSets({
      warmup: [
        { mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 } },
        { mode: 'time', sec: 30, weight: 0 }
      ]
    }, [{ mode: 'reps', r: 5, w: 60, done: false }], [{ phase: 'work', done: true, w: 60, r: 5 }], 2.5)
    expect(sets).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
      { phase: 'warmup', mode: 'time', w: 0, sec: 30, done: false },
      { phase: 'work', mode: 'reps', r: 5, w: 60, done: false }
    ])
  })

  it('uses persisted grouped legacy warm-up values instead of work-entry values', () => {
    const sets = prependWarmupSets({
      phases: ['warmup', 'work'], mode: 'time', sec: 45, weight: 100,
      warmupSets: 2, warmupMode: 'reps', warmupReps: 8, warmupWeight: 20,
      warmupRestSec: 0
    }, [{ phase: 'work', mode: 'time', sec: 45, w: 100, done: false }])
    expect(sets.slice(0, 2)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 0 },
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 0 }
    ])
  })

  it('preserves an independently configured fixed warm-up load through editor migration', () => {
    expect(warmupDraftForEditor({ mode: 'reps', reps: 8, weight: 20 }, { mode: 'time', sec: 45, weight: 100 }))
      .toMatchObject({ mode: 'reps', reps: 8, weight: 20, loadMode: 'fixed' })
  })

  it('keeps a work-set percentage prescription in the editor shape', () => {
    expect(warmupDraftForEditor({ mode: 'reps', reps: 8,
      weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } },
    { mode: 'reps', reps: 8, weight: 100 })).toMatchObject({
      mode: 'reps', reps: 8, loadMode: 'workset', loadPercent: 50, loadFallback: 10
    })
  })

  it('derives warm-up editor rows from active sets when the target has no warm-up config', () => {
    const target = warmupConfigForEntry({
      target: { mode: 'reps', weight: 100 },
      sets: [{ phase: 'warmup', mode: 'reps', w: 25, r: 8, restSec: 30 }, { phase: 'work', w: 100, r: 5 }]
    })
    expect(target.warmup).toEqual([{
      phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 25 }, restSec: 30
    }])
  })

  it('uses the last configured warm-up prescription for an added active row', () => {
    const target = warmupConfigForEntry({
      target: { mode: 'reps', warmup: [{ mode: 'reps', reps: 8,
        weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 } }] },
      sets: [{ phase: 'warmup', mode: 'reps', w: 50, r: 8 }, { phase: 'warmup', mode: 'reps', w: 50, r: 8 }]
    })
    expect(target.warmup).toHaveLength(2)
    expect(target.warmup[1].weightPrescription).toEqual({ kind: 'workset_percent', percent: 50, fallbackWeight: 5 })
  })

  it('applies phase settings to an active entry without changing work rows', () => {
    const entry = {
      target: { mode: 'reps', weight: 100, warmup: [{ mode: 'reps', reps: 8,
        weightPrescription: { kind: 'fixed', weight: 20 } }] },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false }
      ]
    }
    const updated = applyWarmupConfigToEntry(entry, {
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8,
        weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 }, restSec: 30 }]
    }, [], 2.5)
    expect(updated.sets).toEqual([
      { phase: 'warmup', mode: 'reps', w: 50, r: 8, done: false, restSec: 30 },
      { phase: 'work', mode: 'reps', w: 100, r: 5, done: false }
    ])
    expect(updated.target).toMatchObject({ mode: 'reps', weight: 100, warmup: [{ restSec: 30 }] })
  })

  it('keeps a completed warm-up row while rebuilding pending rows from phase settings', () => {
    const updated = applyWarmupConfigToEntry({
      target: { mode: 'reps', weight: 100 },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false }
      ]
    }, {
      warmup: [{ mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 30 } },
        { mode: 'reps', reps: 10, weightPrescription: { kind: 'fixed', weight: 40 } }]
    })
    expect(updated.sets.slice(0, 2)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'warmup', mode: 'reps', w: 40, r: 10, done: false }
    ])
  })

  it('switches a percentage work target to fixed and removes stale load metadata', () => {
    const completed = { phase: 'work', mode: 'reps', w: 45, r: 5, done: true, effort: 'keep' }
    const updated = applyWorkConfigToEntry({
      target: {
        mode: 'reps', sets: 3, reps: 5, weight: 45, resolvedWeight: 45,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 },
        load: { kind: 'percentage', percent: 50 }, prescription: { kind: 'percentage', percent: 50 },
        loadMode: 'percentage', loadType: 'percentage', loadPercent: 50, loadPercentage: 50, loadFallback: 0,
        workWeight: 45, workResolvedWeight: 45, workLoadMode: 'percentage'
      },
      sets: [completed,
        { phase: 'work', mode: 'reps', w: 45, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 45, r: 5, done: false }]
    }, { loadMode: 'fixed', sets: 3, mode: 'reps', reps: 5, weight: 70 }, [], 2.5)

    expect(updated.target).toMatchObject({ sets: 3, reps: 5, weight: 70 })
    for (const key of [
      'weightPrescription', 'resolvedWeight', 'load', 'prescription', 'loadMode', 'loadType',
      'loadPercent', 'loadPercentage', 'loadFallback',
      'workW', 'workWeight', 'workResolvedWeight', 'workWeightPrescription', 'workLoad',
      'workLoadMode', 'workLoadPercent', 'workLoadFallback'
    ]) expect(updated.target).not.toHaveProperty(key)
    expect(updated.sets[0]).toBe(completed)
    expect(updated.sets.slice(1).map(set => set.w)).toEqual([70, 70])
  })

  it('preserves a frozen percentage load for partial work config updates', () => {
    const updated = applyWorkConfigToEntry({
      target: {
        mode: 'reps', sets: 2, reps: 5, weight: 45, resolvedWeight: 45,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 }
      },
      sets: [
        { phase: 'work', mode: 'reps', w: 45, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 45, r: 5, done: false }
      ]
    }, { sets: 2, reps: 6 }, [], 2.5)

    expect(updated.target).toMatchObject({ weight: 45, resolvedWeight: 45,
      weightPrescription: { kind: 'percentage', percent: 50 } })
    expect(updated.sets.map(set => set.w)).toEqual([45, 45])
    expect(updated.sets.map(set => set.r)).toEqual([6, 6])
  })

  it('keeps prescribed Programme row identities through Work settings replacements while leaving added rows untagged', () => {
    const source = {
      target: { mode: 'reps', sets: 2, reps: 5, weight: 60 },
      sets: [
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false, programmeRowId: 'press:work:1' },
        { phase: 'work', mode: 'reps', w: 60, r: 5, done: false, programmeRowId: 'press:work:2' }
      ]
    }

    const countChanged = applyWorkConfigToEntry(source, { mode: 'reps', sets: 3, reps: 6, weight: 65 })
    expect(countChanged.sets.map(set => set.programmeRowId)).toEqual(['press:work:1', 'press:work:2', undefined])

    const modeChanged = applyWorkConfigToEntry(source, { mode: 'time', sets: 2, sec: 45, weight: 65 })
    expect(modeChanged.sets.map(set => set.programmeRowId)).toEqual(['press:work:1', 'press:work:2'])

    const legacy = applyWorkConfigToEntry({
      ...source,
      sets: source.sets.map(({ programmeRowId: _programmeRowId, ...set }) => set)
    }, { mode: 'reps', sets: 2, reps: 6, weight: 65 })
    expect(legacy.sets.map(set => set.programmeRowId)).toEqual([undefined, undefined])
  })

  it('keeps every completed Work row when the requested count is below it', () => {
    const completedBefore = { phase: 'work', mode: 'reps', w: 60, r: 5, done: true, effort: 'keep-before' }
    const unfinished = { phase: 'work', mode: 'reps', w: 60, r: 5, done: false }
    const completedAfter = { phase: 'work', mode: 'reps', w: 65, r: 5, done: true, effort: 'keep-after' }
    const updated = applyWorkConfigToEntry({
      target: { mode: 'reps', sets: 3, reps: 5, weight: 60 },
      sets: [completedBefore, unfinished, completedAfter]
    }, { loadMode: 'fixed', sets: 1, mode: 'reps', reps: 6, weight: 70 }, [], 2.5)

    expect(updated.sets).toEqual([completedBefore, completedAfter])
    expect(updated.sets[0]).toBe(completedBefore)
    expect(updated.sets[1]).toBe(completedAfter)
    expect(updated.target).toMatchObject({ sets: 1, reps: 6, weight: 70 })
  })

  it('keeps completed Work rows after unfinished rows during a fixed-to-percentage transition', () => {
    const completedBefore = { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
    const unfinished = { phase: 'work', mode: 'reps', w: 60, r: 5, done: false }
    const completedAfter = { phase: 'work', mode: 'reps', w: 65, r: 5, done: true }
    const updated = applyWorkConfigToEntry({
      target: { mode: 'reps', sets: 3, reps: 5, weight: 60 },
      sets: [completedBefore, unfinished, completedAfter]
    }, {
      loadMode: 'percentage', sets: 2, mode: 'reps', reps: 6,
      weight: 0, weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 10 }
    }, [{ phase: 'work', mode: 'reps', w: 80, r: 3, done: true }], 2.5)

    expect(updated.sets).toEqual([completedBefore, completedAfter])
    expect(updated.sets[0]).toBe(completedBefore)
    expect(updated.sets[1]).toBe(completedAfter)
    expect(updated.target).toMatchObject({ sets: 2, reps: 6, weight: 45, resolvedWeight: 45,
      weightPrescription: { kind: 'percentage', percent: 50 } })
  })

  it('uses one canonical work-row predicate for legacy and explicit warm-up markers', () => {
    expect(workRowsForMode({ target: { mode: 'reps' }, sets: [
      { phase: 'work', warmup: true, mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
    ] }, 'reps').map(set => set.w)).toEqual([60])
    expect(workRowsForMode({ target: { mode: 'reps' }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
    ] }, 'reps').map(set => set.w)).toEqual([60])
  })

  it('does not ask for a working-weight confirmation for a warm-up-only session', () => {
    expect(shouldConfirmWorkingWeight({ target: { mode: 'reps' }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true }
    ] })).toBe(false)
    expect(shouldConfirmWorkingWeight({ target: { mode: 'reps' }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
    ] })).toBe(true)
  })

  it('keeps timed work loads out of reps working-weight state in mixed entries', () => {
    const entry = {
      target: { mode: 'reps', weight: 60 },
      sets: [
        { phase: 'work', mode: 'time', sec: 60, w: 200, done: true },
        { phase: 'work', mode: 'reps', r: 5, w: 60, done: true }
      ]
    }
    expect(workRowsForMode(entry, 'time')).toEqual([entry.sets[0]])
    expect(workRowsForMode(entry, 'reps')).toEqual([entry.sets[1]])
    expect(Math.max(...workRowsForMode(entry, 'reps').filter(set => set.done).map(set => set.w))).toBe(60)
    expect(shouldConfirmWorkingWeight(entry, 'reps')).toBe(true)
    expect(shouldConfirmWorkingWeight({
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'time', sec: 60, w: 200, done: true }]
    }, 'reps')).toBe(false)
  })

  it('does not let an unannotated rep-shaped row under a timed parent enter strength state', () => {
    const entry = {
      target: { mode: 'time', sec: 60 },
      sets: [{ phase: 'work', w: 200, r: 12, done: true }]
    }
    expect(workRowsForMode(entry, 'time')).toEqual([entry.sets[0]])
    expect(workRowsForMode(entry, 'reps')).toEqual([])
    expect(shouldConfirmWorkingWeight(entry, 'reps')).toBe(false)
  })

  it('keeps each warm-up row independent, including zero rest and an explicit phase', () => {
    const sets = prependWarmupSets({
      warmup: [
        { phase: 'warmup', mode: 'reps', reps: 10, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 },
        { phase: 'work', mode: 'time', sec: 30, weight: 5, restSec: 25 }
      ]
    }, [{ mode: 'reps', r: 5, w: 60, done: false }], [], 2.5)
    expect(sets.slice(0, 2)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 10, done: false, restSec: 0 },
      { phase: 'work', mode: 'time', w: 5, sec: 30, done: false, restSec: 25 }
    ])
  })

  it('honours an explicit work-only routine phase selector without deleting the saved warm-up plan', () => {
    const sets = prependWarmupSets({ phases: ['work'], warmup: [{ mode: 'reps', reps: 8, restSec: 0 }] },
      [{ phase: 'work', mode: 'reps', r: 5, w: 60, done: false }])
    expect(sets).toHaveLength(1)
    expect(sets[0].phase).toBe('work')
  })

  it('keeps a resolved percentage load authoritative over a progression weight', () => {
    const target = { mode: 'reps', weight: 50, resolvedWeight: 50, weightPrescription: { kind: 'percentage', percent: 75 } }
    const plan = { kind: 'up', weight: 55, reps: 6 }
    expect(sessionConfigFor(target, plan)).toMatchObject({ weight: 50, resolvedWeight: 50, reps: 6 })
    expect(sessionPlanFor(target, plan)).toMatchObject({ kind: 'up', reps: 6 })
    expect(sessionPlanFor(target, plan).weight).toBeUndefined()
  })

  it('still applies progression weight to fixed-load targets', () => {
    expect(sessionConfigFor({ mode: 'reps', weight: 50 }, { kind: 'up', weight: 55 })).toMatchObject({ weight: 55 })
    expect(sessionPlanFor({ mode: 'reps', weight: 50 }, { kind: 'up', weight: 55 }).weight).toBe(55)
  })

  it('does not carry work load fields into a warm-up-only session target', () => {
    const target = sessionConfigFor({
      phases: ['warmup'], mode: 'reps', sets: 3, reps: 5, weight: 60,
      resolvedWeight: 60,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 }]
    }, { kind: 'up', weight: 65, resolvedWeight: 65 })
    expect(target).not.toHaveProperty('weight')
    expect(target).not.toHaveProperty('weightPrescription')
    expect(target).not.toHaveProperty('resolvedWeight')
    expect(sessionPlanFor({ phases: ['warmup'] }, { kind: 'up', weight: 65 })).not.toHaveProperty('weight')
    expect(prependWarmupSets(target, [], [], 2.5)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 0 }
    ])
  })

  it('keeps the work prescription and row-specific warm-up load in mixed sessions', () => {
    const target = sessionConfigFor({
      phases: ['warmup', 'work'], mode: 'reps', sets: 1, reps: 5, weight: 60,
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 15 }]
    }, { kind: 'up', weight: 65 })
    expect(target.weight).toBe(65)
    expect(prependWarmupSets(target, [{ phase: 'work', mode: 'reps', w: 65, r: 5, done: false }])).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 15 },
      { phase: 'work', mode: 'reps', w: 65, r: 5, done: false }
    ])
    expect(addSetForEntry({ target, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, restSec: 15, done: true },
      { phase: 'work', mode: 'reps', w: 65, r: 5, done: true }
    ] })).toMatchObject({ phase: 'work', w: 65, r: 5, done: false })
  })

  it('removes nested work loads while retaining nested warm-up row loads', () => {
    const target = sessionConfigFor({
      phases: ['warmup'], mode: 'reps', sets: 1, reps: 8, weight: 60,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      work: {
        mode: 'reps', weight: 60, resolvedWeight: 60,
        weightPrescription: { kind: 'fixed', weight: 60 },
        nested: { weight: 61, load: { weight: 62 } }
      },
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20,
        weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 15 }]
    }, { kind: 'up', weight: 65 })

    expect(target).not.toHaveProperty('weight')
    expect(target).not.toHaveProperty('weightPrescription')
    expect(target.work?.weight).toBeUndefined()
    expect(target.work?.resolvedWeight).toBeUndefined()
    expect(target.work?.weightPrescription).toBeUndefined()
    expect(target.work?.nested?.weight).toBeUndefined()
    expect(target.warmup[0]).toMatchObject({ weight: 20, restSec: 15,
      weightPrescription: { kind: 'fixed', weight: 20 } })
  })

  it('adds another warm-up row from the last row without borrowing the work target', () => {
    const entry = {
      target: {
        phases: ['warmup'], mode: 'reps', reps: 8, weight: 60,
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20, restSec: 15 }]
      },
      sets: [{ phase: 'warmup', mode: 'time', sec: 30, w: 15, restSec: 10, done: true }]
    }

    expect(addSetForEntry(entry)).toEqual({
      phase: 'warmup', mode: 'time', sec: 30, w: 15, restSec: 10, done: false
    })
  })

  it('keeps a warm-up-only session work-free through normalization, Add Set, and history', () => {
    const sessionTarget = sessionConfigFor({
      phases: ['warmup'], mode: 'reps', sets: 1, reps: 8, weight: 60,
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8,
        weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 15 }]
    }, { kind: 'up', weight: 65 })
    const sourceSets = prependWarmupSets(sessionTarget, [])
    const normalized = normalizeState({
      unit: 'kg',
      active: { id: 'active', unit: 'kg', entries: [{
        id: 'squat', target: { ...sessionTarget, unit: 'kg' }, sets: sourceSets
      }] }
    }, STATE_DEF)
    const entry = normalized.active.entries[0]

    expect(entry.target).not.toHaveProperty('weight')
    const added = addSetForEntry(entry)
    entry.sets.push(added)
    expect(entry.sets).toHaveLength(2)
    expect(entry.sets.every(set => set.phase === 'warmup')).toBe(true)
    expect(added).toMatchObject({ phase: 'warmup', w: 20, r: 8, restSec: 15, done: false })

    const completed = stampCompletedWorkout({
      unit: 'kg',
      entries: [{ ...entry, sets: entry.sets.map(set => ({ ...set, done: true })) }]
    }, 'kg')
    expect(completed.entries[0].target).not.toHaveProperty('weight')
    expect(completed.entries[0].sets.every(set => set.phase === 'warmup')).toBe(true)
    expect(workoutVolumeFromEntries(completed, 'kg')).toBe(320)
    expect(isProgressionEligible(completed.entries[0].sets[0], completed.entries[0].target, 'kg')).toBe(false)
    expect(is1RMEligible(completed.entries[0].sets[0], completed.entries[0].target, 'kg')).toBe(false)
  })
})

describe('row-specific workout table headings', () => {
  it('describes each row mode rather than borrowing the entry mode', () => {
    const entry = {
      target: { mode: 'time' },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8 },
        { phase: 'work', mode: 'time', w: 0, sec: 45 }
      ]
    }
    expect(tableModesForEntry(entry)).toEqual(['reps', 'time'])
    expect(tableModesRequirePerRowHeaders(entry)).toBe(true)
    expect(setTableColumnsForMode('reps', 'kg')).toMatchObject({
      primary: { field: 'w', label: 'Weight' }, secondary: { field: 'r', label: 'Reps' }, timed: false
    })
    expect(setTableColumnsForMode('time', 'kg')).toMatchObject({
      primary: { field: 'sec', label: 'Seconds' }, secondary: { field: 'w', label: 'Weight' }, timed: true
    })
  })

  it('requires row headings for an explicit reps row under a timed parent', () => {
    expect(tableModesRequirePerRowHeaders({
      target: { mode: 'time' },
      sets: [{ phase: 'work', mode: 'reps', w: 40, r: 8 }]
    })).toBe(true)
  })

  it('requires row headings for an explicit time row under a reps parent', () => {
    expect(tableModesRequirePerRowHeaders({
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'time', w: 0, sec: 45 }]
    })).toBe(true)
  })

  it('keeps the shared heading for an ordinary single-mode entry', () => {
    expect(tableModesRequirePerRowHeaders({
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'reps', w: 40, r: 8 }]
    })).toBe(false)
  })
})

describe('AMRAP result boundaries', () => {
  const entry = {
    target: { mode: 'reps', kind: 'amrap', amrapMinReps: 5, cap: 12 },
    sets: [
      { phase: 'warmup', w: 20, r: 20, done: false },
      { phase: 'work', w: 40, r: 5, done: false },
      { phase: 'work', w: 40, r: 12, done: false }
    ]
  }

  it('identifies only the final work row as the AMRAP result', () => {
    expect(isAmrapEntry(entry)).toBe(true)
    expect(isAmrapResult(entry, 0)).toBe(false)
    expect(isAmrapResult(entry, 1)).toBe(false)
    expect(isAmrapResult(entry, 2)).toBe(true)
    expect(amrapCapFor(entry, 0)).toBeNull()
    expect(amrapCapFor(entry, 2)).toBeNull()
  })

  it('returns the completed final AMRAP actual without losing phase or target metadata', () => {
    const entry = {
      target: { phase: 'work', mode: 'reps', kind: 'amrap', amrapMinReps: 5, cap: 12 },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: true },
        { phase: 'work', mode: 'reps', w: 40, r: 11, done: true }
      ]
    }
    expect(amrapResultFor(entry)).toEqual({
      index: 2, phase: 'work', mode: 'reps', actual: 11, target: 5, amrapMinReps: 5
    })
  })

  it('does not treat a legacy rep cap as a maximum and only marks the final work row timed AMRAP', () => {
    const reps = {
      target: { mode: 'reps', kind: 'amrap', amrapMinReps: 5, cap: 6 },
      sets: [{ phase: 'work', mode: 'reps', r: 10, w: 40, done: true }]
    }
    expect(amrapCapFor(reps, 0)).toBeNull()
    expect(amrapResultFor(reps)).toMatchObject({ actual: 10, amrapMinReps: 5 })

    const timed = {
      target: { mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 90 },
      sets: [
        { phase: 'warmup', mode: 'time', sec: 30, done: false },
        { phase: 'work', mode: 'time', sec: 30, done: false },
        { phase: 'work', mode: 'time', sec: 30, done: false }
      ]
    }
    expect(isAmrapResult(timed, 0)).toBe(false)
    expect(isAmrapResult(timed, 1)).toBe(false)
    expect(isAmrapResult(timed, 2)).toBe(true)
    expect(timerDurationForSet(timed, 1)).toBe(30)
    expect(timerDurationForSet(timed, 2)).toBe(90)
  })

  it('does not report an unchecked AMRAP prescription as an actual result', () => {
    expect(amrapResultFor({
      target: { mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 90 },
      sets: [{ phase: 'work', mode: 'time', sec: 30, done: false }]
    })).toBeNull()
  })

  it('canonicalizes a routine Greyskull policy as an AMRAP session target unless fixed is explicit', () => {
    expect(sessionConfigFor({ phase: 'work', mode: 'reps', reps: 5 }, { policy: 'greyskull' }))
      .toMatchObject({ phase: 'work', mode: 'reps', kind: 'amrap' })
    expect(sessionConfigFor({ phase: 'work', mode: 'reps', reps: 5, kind: 'fixed' }, { policy: 'greyskull' }).kind)
      .toBe('fixed')
  })
})

describe('time AMRAP runtime', () => {
  it('uses only the optional timed duration and never caps reps', () => {
    expect(timerDurationFor({ mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 90 })).toBe(90)
    expect(timerDurationFor({ mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 20 })).toBe(30)
    expect(timerDurationFor({ mode: 'time', kind: 'fixed', sec: 30, amrapMaxSec: 90 })).toBe(30)
  })
})

describe('stale timed callbacks', () => {
  it('does not apply a callback after the active workout or set was deleted', () => {
    const active = { id: 'w1', entries: [{ sets: [{ done: false }] }] }
    expect(canApplyTimedResult(active, 'w1', 0, 0)).toBe(true)
    expect(canApplyTimedResult(null, 'w1', 0, 0)).toBe(false)
    expect(canApplyTimedResult(active, 'w2', 0, 0)).toBe(false)
    expect(canApplyTimedResult(active, 'w1', 1, 0)).toBe(false)
    expect(canApplyTimedResult(active, 'w1', 0, 1)).toBe(false)
  })

  it('invokes the real removal helper before removing the final set/exercise', () => {
    const active = { id: 'w1', cur: 0, entries: [{ id: 'lift', sets: [{ done: false }] }] }
    const stop = vi.fn(() => expect(active.entries).toHaveLength(1))
    expect(removeActiveSet(active, 0, 0, stop)).toMatchObject({ removed: true, removedExercise: true })
    expect(active.entries).toEqual([])
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops timer lifecycle before navigating while preserving the active exercise state', () => {
    const entries = [
      { id: 'first', sets: [{ w: 20, r: 8, done: false }] },
      { id: 'second', sets: [{ w: 40, r: 5, done: false }] }
    ]
    const active = { id: 'w1', cur: 0, entries }
    const stopTimers = vi.fn(() => expect(active.cur).toBe(0))

    expect(navigateActiveExercise(active, 1, stopTimers)).toBe(true)
    expect(stopTimers).toHaveBeenCalledTimes(1)
    expect(active.cur).toBe(1)
    expect(active.entries).toBe(entries)
    expect(active.entries[0].sets[0]).toMatchObject({ w: 20, r: 8, done: false })
  })
})

describe('bestFullSetWeight', () => {
  const mk = rows => ({ target: { sets: rows.length, reps: 5 }, sets: rows.map(([w, r, done]) => ({ w, r, done, phase: 'work' })) })
  it('uses the heaviest set lifted to the full target', () => {
    const e = mk([[60, 5, true], [70, 5, true], [75, 4, true]])
    expect(bestFullSetWeight(e)).toBe(70)
  })
  it('ignores a missed final set (below target reps)', () => {
    const e = mk([[60, 5, true], [75, 3, true]])
    expect(bestFullSetWeight(e)).toBe(60)
  })
  it('falls back to all done sets when nothing hit the target', () => {
    const e = mk([[60, 3, true], [75, 4, true]])
    expect(bestFullSetWeight(e)).toBe(75)
  })
  it('ignores unchecked sets', () => {
    const e = mk([[60, 5, true], [90, 5, false]])
    expect(bestFullSetWeight(e)).toBe(60)
  })
})
