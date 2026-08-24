import { describe, it, expect } from 'vitest'
import { buildPlanBundle, parsePlan, mergePlan, preparePlanForDestination, PLAN_UNIT_ERROR_KEYS, planErrorMessage } from './plan-share.js'
import { EXDB } from './exercises.js'
import { applyWorkConfigToEntry, resolveTargetLoad } from './workout-runtime.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio').id

const routine = {
  id: 'r1', name: 'Phase test', emoji: 'dumbbell', phases: ['warmup', 'work'], warmupRestSec: 0, workRestSec: 0,
  ex: [{
    id: LIFT, sets: 3, mode: 'time', sec: 30, weight: 0, prepSec: 3,
    kind: 'amrap', amrapMaxSec: 90,
    warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 }]
  }]
}

describe('plan-share phase and timer migration', () => {
  it('keeps personal cues account-private by default while round-tripping current-1RM prescriptions without converting percentages', () => {
    const source = {
      unit: 'lb', week: {},
      routines: [{ id: 'current', name: 'Current', ex: [{ id: 'custom-current', sets: 1, reps: 5, weight: 135,
        weightPrescription: { kind: 'current_1rm_percentage', currentPercent: 85, fallbackWeight: 45 } }] }],
      customEx: [{ id: 'custom-current', n: 'Current lift', bp: 'back', cues: 'brace exactly this way', desc: 'General setup.' }]
    }
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(destination, parsePlan(buildPlanBundle(source)))
    expect(destination.routines[0].ex[0].weightPrescription).toEqual({
      kind: 'percentage', source: 'adaptive', percent: 85, fallbackWeight: 20.4
    })
    expect(destination.customEx[0].cues).toBeUndefined()
    expect(destination.exerciseAnnotations).toEqual({})
  })

  it('keeps unsafe unit failures as localized translation errors with parameters', () => {
    const unknownBundle = (() => {
      try { parsePlan({ opengym_plan: 1, unit: 'stones', routines: [], week: {}, customEx: [] }) } catch (error) { return error }
    })()
    expect(unknownBundle.code).toBe('OPEN_GYM_PLAN_UNIT_ERROR')
    expect(unknownBundle.translationKey).toBe(PLAN_UNIT_ERROR_KEYS.unknownBundle)
    expect(planErrorMessage(unknownBundle)).toBe(unknownBundle.message)
    expect(unknownBundle.message).not.toContain('Cannot safely import')

    const descendant = parsePlan({
      opengym_plan: '1', unit: 'kg',
      routines: [{ id: 'r1', ex: [{ id: LIFT, unit: 'stones' }] }], week: {}, customEx: []
    })
    const unknownDescendant = (() => {
      try { preparePlanForDestination(descendant, 'kg') } catch (error) { return error }
    })()
    expect(unknownDescendant.translationKey).toBe(PLAN_UNIT_ERROR_KEYS.unknownDescendant)
    expect(unknownDescendant.translationArgs).toEqual(['bundle.routines[0].ex[0].unit'])
    expect(planErrorMessage(unknownDescendant)).toContain('bundle.routines[0].ex[0].unit')

    const legacyWeighted = parsePlan({
      opengym_plan: 1,
      routines: [{ id: 'legacy', ex: [{ id: LIFT, reps: 5, weight: 20 }] }], week: {}, customEx: []
    })
    const missingBundle = (() => {
      try { preparePlanForDestination(legacyWeighted, 'kg') } catch (error) { return error }
    })()
    expect(missingBundle.translationKey).toBe(PLAN_UNIT_ERROR_KEYS.missingBundle)
    expect(planErrorMessage(missingBundle)).not.toContain('Cannot safely import')
    expect(planErrorMessage(new Error('legacy parser failure'))).toBe('legacy parser failure')

    const conflict = parsePlan({
      opengym_plan: 1, unit: 'kg',
      routines: [{ id: 'r1', ex: [{ id: LIFT, unit: 'lb' }] }], week: {}, customEx: []
    })
    const conflictingDescendant = (() => {
      try { preparePlanForDestination(conflict, 'kg') } catch (error) { return error }
    })()
    expect(conflictingDescendant.translationKey).toBe(PLAN_UNIT_ERROR_KEYS.conflictingDescendant)
    expect(conflictingDescendant.translationArgs).toEqual(['bundle.routines[0].ex[0].unit', 'kg'])
    expect(planErrorMessage(conflictingDescendant)).toContain('(kg)')
  })

  it('exports and imports the plan weight unit without changing it', () => {
    const bundle = buildPlanBundle({ unit: 'lb', routines: [routine], week: {}, customEx: [] }, 'Pounds')
    expect(bundle.unit).toBe('lb')
    expect(parsePlan(JSON.stringify(bundle)).unit).toBe('lb')
  })

  it('does not reactivate a percentage target after fixed conversion through plan export/import', () => {
    const converted = applyWorkConfigToEntry({
      target: {
        mode: 'reps', sets: 1, reps: 5, weight: 45, resolvedWeight: 45,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 },
        load: { kind: 'percentage', percent: 50 },
        prescription: { kind: 'percentage', percent: 50 },
        loadMode: 'percentage', loadType: 'percentage', loadPercent: 50, loadPercentage: 50, loadFallback: 0,
        workWeight: 45, workResolvedWeight: 45, workLoadMode: 'percentage'
      },
      sets: [{ phase: 'work', mode: 'reps', w: 45, r: 5, done: false }]
    }, { loadMode: 'fixed', sets: 1, mode: 'reps', reps: 5, weight: 70 }, [], 2.5)
    const source = {
      unit: 'kg', routines: [{ id: 'fixed-round-trip', name: 'Fixed', ex: [{ id: LIFT, ...converted.target }] }],
      week: {}, customEx: []
    }

    const parsed = parsePlan(JSON.stringify(buildPlanBundle(source)))
    const imported = parsed.routines[0].ex[0]
    expect(imported).not.toHaveProperty('weightPrescription')
    expect(imported).not.toHaveProperty('prescription')
    expect(resolveTargetLoad(imported, [{ phase: 'work', mode: 'reps', w: 80, r: 3, done: true }], 2.5)).toBe(70)

    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(destination, parsed)
    expect(destination.routines[0].ex[0]).not.toHaveProperty('weightPrescription')
    expect(destination.routines[0].ex[0]).not.toHaveProperty('prescription')
  })

  it('converts plan weights when importing a pound bundle into a kilogram profile', () => {
    const source = { unit: 'lb', routines: [{ ...routine, ex: [{ ...routine.ex[0], mode: 'reps', sets: 1, reps: 5, weight: 135, warmup: [{ mode: 'reps', reps: 8, weight: 45 }] }] }], week: {}, customEx: [] }
    const parsed = parsePlan(buildPlanBundle(source))
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }
    const result = mergePlan(destination, parsed)
    expect(result).toMatchObject({ converted: true, sourceUnit: 'lb', destinationUnit: 'kg' })
    expect(destination.routines[0].ex[0].weight).toBe(61.2)
    expect(destination.routines[0].ex[0].warmup[0].weight).toBe(20.4)
    expect(parsed.routines[0].ex[0].weight).toBe(135)
  })

  it('rejects a weighted legacy plan whose unit is missing instead of guessing', () => {
    const parsed = parsePlan({ opengym_plan: 1, routines: [{ id: 'r1', name: 'Legacy', ex: [{ id: LIFT, sets: 1, reps: 5, weight: 135 }] }], week: {}, customEx: [] })
    expect(parsed.unit).toBeNull()
    expect(() => mergePlan({ unit: 'kg', routines: [], customEx: [], week: {} }, parsed)).toThrow(/unit/i)
  })

  it('converts a per-exercise progression increment with the plan weight unit', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      unit: 'lb',
      routines: [{ id: 'r-inc', name: 'Increment', ex: [{ id: LIFT, sets: 3, reps: 5, weight: 0, inc: 5 }] }],
      week: {}, customEx: []
    })
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }

    mergePlan(destination, parsed)

    expect(destination.routines[0].ex[0].inc).toBe(2.3)
  })

  it('rejects a unitless weighted progression increment instead of guessing', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      routines: [{ id: 'r-inc', name: 'Increment', ex: [{ id: LIFT, sets: 3, reps: 5, weight: 0, inc: 5 }] }],
      week: {}, customEx: []
    })
    expect(parsed.unit).toBeNull()
    expect(() => mergePlan({ unit: 'kg', routines: [], customEx: [], week: {} }, parsed)).toThrow(/unit/i)
  })

  it('converts weighted reps increments but preserves timed increments as seconds', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      unit: 'lb',
      routines: [{ id: 'mixed-inc', name: 'Mixed increments', ex: [
        { id: LIFT, mode: 'reps', sets: 3, reps: 5, weight: 135, inc: 5 },
        { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0, inc: 30 }
      ] }],
      week: {}, customEx: []
    })
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }

    mergePlan(destination, parsed)

    expect(destination.routines[0].ex[0].inc).toBe(2.3)
    expect(destination.routines[0].ex[1].inc).toBe(30)
  })

  it('does not require a plan weight unit for a timed-only increment', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      routines: [{ id: 'timed-inc', name: 'Timed increment', ex: [
        { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0, inc: 30 }
      ] }],
      week: {}, customEx: []
    })
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }

    expect(() => mergePlan(destination, parsed)).not.toThrow()
    expect(destination.routines[0].ex[0].inc).toBe(30)
  })

  it('converts reps increments but leaves timed increments in seconds', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      unit: 'lb',
      routines: [{ id: 'increments', name: 'Increments', ex: [
        { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 135, inc: 5, unit: 'lb' },
        { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0, inc: 30, weightUnit: 'lb' }
      ] }],
      week: {}, customEx: []
    })
    const prepared = preparePlanForDestination(parsed, 'kg')
    const [reps, timed] = prepared.bundle.routines[0].ex

    expect(reps.inc).toBe(2.3)
    expect(timed.inc).toBe(30)
    expect(timed.weightUnit).toBe('kg')
  })

  it('rejects a conflicting descendant unit even when the bundle has a source unit', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'conflict', name: 'Conflict', ex: [{
        id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 20,
        target: { mode: 'reps', weight: 20, weightUnit: 'lb' }
      }] }],
      week: {}, customEx: []
    })

    expect(() => preparePlanForDestination(parsed, 'kg')).toThrow(/conflict|unit/i)
  })

  it('rejects an unknown descendant unit during same-unit preparation', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'unknown', name: 'Unknown', ex: [{
        id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 20,
        warmup: [{ mode: 'reps', reps: 5, weight: 10, unit: 'stones' }]
      }] }],
      week: {}, customEx: []
    })

    expect(() => preparePlanForDestination(parsed, 'kg')).toThrow(/unknown|unit/i)
  })

  it('rejects unknown or conflicting routine-level unit markers even for same-unit imports', () => {
    const unknown = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'routine-unknown', name: 'Unknown routine marker', unit: 'stones', ex: [{ id: LIFT }] }],
      week: {}, customEx: []
    })
    expect(() => preparePlanForDestination(unknown, 'kg')).toThrow(/unknown|unit/i)

    const conflict = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'routine-conflict', name: 'Conflicting routine marker', weightUnit: 'lb', ex: [{ id: LIFT }] }],
      week: {}, customEx: []
    })
    expect(() => preparePlanForDestination(conflict, 'kg')).toThrow(/conflict|unit/i)
  })

  it('preserves root metadata while replacing raw routine and custom branches with cleaned versions', () => {
    const raw = {
      opengym_plan: 1,
      exported: '2026-07-29',
      unit: 'KG',
      weightUnit: 'kg',
      loadUnit: 'kg',
      extra: { source: 'senior-review', nested: { keep: true } },
      routines: [
        { id: 'drop-me', name: 'Invalid', ex: 'not-an-array' },
        { id: 'kept', name: 'Kept', ex: [{ id: LIFT, reps: 5 }] }
      ],
      week: { 1: 'kept' },
      customEx: [
        { n: 'Missing id', bp: 'chest' },
        { id: 'custom-kept', n: 'Custom', bp: 'chest' }
      ]
    }
    const before = JSON.parse(JSON.stringify(raw))

    const parsed = parsePlan(raw)

    expect(parsed).toMatchObject({
      opengym_plan: 1,
      exported: '2026-07-29',
      unit: 'kg',
      weightUnit: 'kg',
      loadUnit: 'kg',
      extra: { source: 'senior-review', nested: { keep: true } },
      week: { 1: 'kept' },
      routineCount: 1,
      exerciseCount: 1,
      scheduledDays: 1
    })
    expect(parsed.extra).not.toBe(raw.extra)
    expect(parsed.routines).toHaveLength(1)
    expect(parsed.routines[0].id).toBe('kept')
    expect(parsed.customEx).toEqual([{ id: 'custom-kept', n: 'Custom', bp: 'chest' }])

    const prepared = preparePlanForDestination(parsed, 'kg')
    expect(prepared.bundle).toMatchObject({ weightUnit: 'kg', loadUnit: 'kg', extra: raw.extra })
    expect(raw).toEqual(before)
    expect(parsed.unit).toBe('kg')
  })

  it('rejects unknown and conflicting root weight unit markers', () => {
    for (const key of ['weightUnit', 'loadUnit']) {
      const unknown = parsePlan({
        opengym_plan: 1, unit: 'kg', [key]: 'stones',
        routines: [{ id: 'root-unknown', ex: [{ id: LIFT }] }], week: {}, customEx: []
      })
      expect(() => preparePlanForDestination(unknown, 'kg')).toThrow(/unknown|unit/i)

      const conflict = parsePlan({
        opengym_plan: 1, unit: 'kg', [key]: 'lb',
        routines: [{ id: 'root-conflict', ex: [{ id: LIFT }] }], week: {}, customEx: []
      })
      expect(() => preparePlanForDestination(conflict, 'kg')).toThrow(/conflict|unit/i)
    }
  })

  it('converts nested reps increments under a timed parent while preserving timed increments', () => {
    const raw = {
      opengym_plan: 1,
      unit: 'lb',
      routines: [{ id: 'timed-parent', name: 'Timed parent', mode: 'time', ex: [{
        id: LIFT,
        mode: 'time',
        sec: 45,
        inc: 30,
        nestedPlan: { reps: 5, inc: 5 }
      }] }],
      week: {},
      customEx: []
    }
    const before = JSON.parse(JSON.stringify(raw))
    const parsed = parsePlan(raw)
    const prepared = preparePlanForDestination(parsed, 'kg')
    const ex = prepared.bundle.routines[0].ex[0]

    expect(ex.inc).toBe(30)
    expect(ex.nestedPlan).toMatchObject({ reps: 5, inc: 2.3 })
    expect(parsed.routines[0].ex[0].inc).toBe(30)
    expect(parsed.routines[0].ex[0].nestedPlan.inc).toBe(5)
    expect(raw).toEqual(before)
  })

  it('rejects unknown or conflicting custom exercise markers during same-unit preparation', () => {
    const unknown = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'routine-custom-unknown', name: 'Custom marker', ex: [{ id: 'custom-unknown' }] }],
      week: {},
      customEx: [{ id: 'custom-unknown', n: 'Custom unknown', bp: 'chest', loadUnit: 'stones' }]
    })
    expect(() => preparePlanForDestination(unknown, 'kg')).toThrow(/unknown|unit/i)

    const conflict = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'routine-custom-conflict', name: 'Custom marker', ex: [{ id: 'custom-conflict' }] }],
      week: {},
      customEx: [{ id: 'custom-conflict', n: 'Custom conflict', bp: 'chest', unit: 'lb' }]
    })
    expect(() => preparePlanForDestination(conflict, 'kg')).toThrow(/conflict|unit/i)
  })

  it('converts and canonicalizes retained routine and custom branches without dropping fields', () => {
    const raw = {
      opengym_plan: 1,
      unit: 'lb',
      routines: [{
        id: 'routine-branches', name: 'Branch conversion', unit: 'pounds', weight: 100,
        other: { load: { weight: 20, unit: 'lb' }, inc: 30, keep: 'routine' },
        ex: [{ id: 'custom-branches' }]
      }],
      week: {},
      customEx: [{
        id: 'custom-branches', n: 'Custom branches', bp: 'chest', weightUnit: 'lb', weight: 50,
        prescription: { weight: 25, loadUnit: 'lb' },
        other: { weight: 10, keep: 'custom' }
      }]
    }
    const before = JSON.parse(JSON.stringify(raw))
    const parsed = parsePlan(raw)
    const prepared = preparePlanForDestination(parsed, 'kg')
    const routine = prepared.bundle.routines[0]
    const custom = prepared.bundle.customEx[0]

    expect(routine).toMatchObject({
      unit: 'kg', weight: 45.4,
      other: { load: { weight: 9.1, unit: 'kg' }, inc: 13.6, keep: 'routine' }
    })
    expect(routine.ex[0]).toEqual({ id: 'custom-branches' })
    expect(custom).toMatchObject({
      weightUnit: 'kg', weight: 22.7,
      prescription: { weight: 11.3, loadUnit: 'kg' },
      other: { weight: 4.5, keep: 'custom' }
    })
    expect(prepared.bundle.unit).toBe('kg')
    expect(raw).toEqual(before)
    expect(parsed.unit).toBe('lb')
    expect(parsed.routines[0].unit).toBe('pounds')
    expect(parsed.customEx[0].weight).toBe(50)
  })

  it('converts matching descendant units recursively and canonicalizes their markers', () => {
    const raw = {
      opengym_plan: 1,
      unit: 'lb',
      routines: [{ id: 'nested', name: 'Nested units', ex: [{
        id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 135, unit: 'lb', inc: 5,
        target: { mode: 'reps', weight: 45, weightUnit: 'pounds' },
        load: { weight: 25, unit: 'lbs' },
        weightPrescription: { kind: 'fixed', weight: 10, weightUnit: 'lb' },
        warmup: [{ mode: 'reps', reps: 5, weight: 20, unit: 'lb' }]
      }] }],
      week: {}, customEx: []
    }
    const before = JSON.parse(JSON.stringify(raw))
    const parsed = parsePlan(raw)
    const prepared = preparePlanForDestination(parsed, 'kg')
    const ex = prepared.bundle.routines[0].ex[0]

    expect(ex.weight).toBe(61.2)
    expect(ex.inc).toBe(2.3)
    expect(ex.unit).toBe('kg')
    expect(ex.target).toMatchObject({ weight: 20.4, weightUnit: 'kg' })
    expect(ex.load).toMatchObject({ weight: 11.3, unit: 'kg' })
    expect(ex.weightPrescription).toMatchObject({ weight: 4.5, weightUnit: 'kg' })
    expect(ex.warmup[0]).toMatchObject({ weight: 9.1, unit: 'kg' })
    expect(prepared.bundle.unit).toBe('kg')
    expect(raw).toEqual(before)
    expect(parsed.unit).toBe('lb')
    expect(parsed.routines[0].ex[0].weight).toBe(135)
  })

  it('exports timed preparation, AMRAP, zero rest and explicit warm-up phase', () => {
    const bundle = buildPlanBundle({ routines: [routine], week: { 1: 'r1' }, customEx: [], unit: 'kg' }, 'Phase test')
    const ex = bundle.routines[0].ex[0]
    expect(bundle.routines[0]).toMatchObject({ phases: ['warmup', 'work'], warmupRestSec: 0, workRestSec: 0 })
    expect(ex).toMatchObject({ mode: 'time', prepSec: 3, kind: 'amrap', amrapMaxSec: 90 })
    expect(ex.warmup[0]).toMatchObject({ phase: 'warmup', restSec: 0 })
  })

  it('imports legacy and new plan data without mutating the source state', () => {
    const bundle = parsePlan({ opengym_plan: 1, unit: 'kg', routines: [routine], week: { 1: 'r1' }, customEx: [] })
    const state = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(state, bundle, { schedule: true })
    expect(state.routines).toHaveLength(1)
    expect(state.routines[0].ex[0]).toMatchObject({ mode: 'time', prepSec: 3, kind: 'amrap', warmup: [{ phase: 'warmup' }] })
    expect(state.routines[0].warmupRestSec).toBe(0)
    expect(state.routines[0].workRestSec).toBe(0)
    expect(state.routines[0].phases).toEqual(['warmup', 'work'])
    expect(state.week[1]).toBe(state.routines[0].id)
  })

  it('round-trips multi-muscle custom metadata while keeping legacy body-part data valid', () => {
    const state = {
      routines: [{ id: 'r1', name: 'Custom', ex: [{ id: 'c1', sets: 1, reps: 5 }] }],
      week: {},
      customEx: [{ id: 'c1', n: 'Press', bp: 'chest', muscleGroups: ['chest', 'triceps'] }]
    }
    const bundle = buildPlanBundle(state)
    expect(bundle.customEx[0].muscleGroups).toEqual(['chest', 'triceps'])
    const parsed = parsePlan({ ...bundle, customEx: [{ id: 'legacy', n: 'Old', bp: 'back' }, ...bundle.customEx] })
    const merged = { routines: [], customEx: [], week: {} }
    mergePlan(merged, parsed)
    expect(merged.customEx.find(x => x.n === 'Press').muscleGroups).toEqual(['chest', 'triceps'])
    expect(merged.customEx.find(x => x.n === 'Old')).toMatchObject({ bp: 'back' })
  })

  it('keeps legacy primary and secondary muscle fields available to older consumers', () => {
    const bundle = buildPlanBundle({
      routines: [{ id: 'r1', name: 'Legacy custom', ex: [{ id: 'c1', sets: 1 }] }],
      week: {},
      customEx: [{ id: 'c1', n: 'Press', bp: 'chest', tg: 'pectorals', sm: 'triceps' }]
    })
    expect(bundle.customEx[0]).toMatchObject({
      tg: 'chest', sm: ['triceps'], muscleGroups: ['chest', 'triceps']
    })

    const parsed = parsePlan(bundle)
    const merged = { routines: [], customEx: [], week: {} }
    mergePlan(merged, parsed)
    expect(merged.customEx[0]).toMatchObject({
      tg: 'chest', sm: ['triceps'], muscleGroups: ['chest', 'triceps']
    })
  })

  it('exports nested target data and prescriptions without dropping explicit phase values', () => {
    const nested = {
      id: LIFT,
      target: {
        phase: 'work', mode: 'reps', kind: 'amrap', sets: 3, reps: 5, weight: 40, cap: 12,
        weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 }
      },
      warmup: [{ target: { phase: 'warmup', mode: 'reps', reps: 8, weight: 20 }, restSec: 30 }]
    }
    const bundle = buildPlanBundle({ routines: [{ id: 'r1', name: 'Nested', ex: [nested] }], week: {}, customEx: [] })
    expect(bundle.routines[0].ex[0]).toMatchObject({
      id: LIFT, phase: 'work', mode: 'reps', kind: 'amrap', sets: 3, amrapMinReps: 5, weight: 40,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20, restSec: 30 }]
    })
  })

  it('keeps old plans readable and deep-clones phase data during merge', () => {
    const old = parsePlan({ opengym_plan: 1, routines: [{ id: 'old', name: 'Old', ex: [{ id: LIFT, sets: 3, reps: 5, weight: 0 }] }], week: {}, customEx: [] })
    const state = { routines: [], customEx: [], week: {} }
    mergePlan(state, old)
    expect(state.routines[0].ex[0]).toMatchObject({ id: LIFT, sets: 3, reps: 5, weight: 0 })
    state.routines[0].ex[0].reps = 8
    expect(old.routines[0].ex[0].reps).toBe(5)
  })

  it('migrates legacy grouped warm-up settings into independently serializable rows', () => {
    const old = parsePlan({
      opengym_plan: 1,
      routines: [{ id: 'old-warmup', name: 'Old warm-up', ex: [{
        id: LIFT, sets: 3, reps: 5, weight: 40,
        warmupSets: 2, warmupMode: 'reps', warmupReps: 8, warmupWeight: 20, warmupRestSec: 0
      }] }],
      week: {}, customEx: []
    })
    expect(old.routines[0].ex[0].warmup).toEqual([
      { phase: 'warmup', mode: 'reps', reps: 8, weight: 20, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 },
      { phase: 'warmup', mode: 'reps', reps: 8, weight: 20, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 }
    ])
  })

  it('normalizes legacy timed AMRAP, prescription, phase, and rest aliases', () => {
    const old = parsePlan({
      opengym_plan: 1,
      unit: 'lb',
      week: { 1: 'legacy-time' },
      routines: [{
        id: 'legacy-time', name: 'Legacy time', phases: 'warm-up,work', prog: 'time',
        warmupRest: '0', workRest: '75', ex: [{
          id: LIFT, mode: 'time', sets: 2, durationSec: 45, weight: 10, prepSec: 0,
          targetKind: 'amrap', maxSec: 90,
          load: { percent: 75, fallback: 20 },
          warmup: [{ phase: 'warm-up', mode: 'time', seconds: 30, load: { percent: 50, fallback: 10 }, restSec: 0 }]
        }]
      }],
      customEx: []
    })
    const routine = old.routines[0]
    const ex = routine.ex[0]
    expect(old.unit).toBe('lb')
    expect(old.week).toEqual({ 1: 'legacy-time' })
    expect(routine).toMatchObject({
      phases: ['warmup', 'work'], prog: 'time', warmupRestSec: 0, workRestSec: 75
    })
    expect(ex).toMatchObject({
      mode: 'time', sec: 45, prepSec: 0, kind: 'amrap', amrapMaxSec: 90,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      warmup: [{
        phase: 'warmup', mode: 'time', sec: 30, restSec: 0,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 10 }
      }]
    })

    const state = { unit: 'lb', routines: [], customEx: [], week: {} }
    mergePlan(state, old, { schedule: true })
    expect(state.routines[0]).toMatchObject({
      phases: ['warmup', 'work'], prog: 'time', warmupRestSec: 0, workRestSec: 75
    })
    expect(state.routines[0].ex[0]).toMatchObject({
      mode: 'time', sec: 45, kind: 'amrap', amrapMaxSec: 90,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      warmup: [{ phase: 'warmup', mode: 'time', sec: 30, restSec: 0 }]
    })
    expect(state.week[1]).toBe(state.routines[0].id)
  })

  it('round-trips a work-set percentage warm-up prescription', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      unit: 'kg',
      routines: [{ id: 'workset-load', name: 'Work-set load', ex: [{
        id: LIFT, mode: 'reps', sets: 2, reps: 5, weight: 100,
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8,
          weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } }]
      }] }],
      week: {}, customEx: []
    })
    expect(parsed.routines[0].ex[0].warmup[0].weightPrescription).toEqual({
      kind: 'workset_percent', percent: 50, fallbackWeight: 10
    })
  })

  it('preserves the explicit Latest session percentage source through share and import', () => {
    const source = {
      unit: 'kg', week: {}, routines: [{ id: 'latest', name: 'Latest', ex: [{ id: LIFT, sets: 3, reps: 5,
        weightPrescription: { kind: 'percentage', source: 'latest', percent: 70, fallbackWeight: 40 } }] }], customEx: []
    }
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(destination, parsePlan(buildPlanBundle(source)))
    expect(destination.routines[0].ex[0].weightPrescription).toEqual({
      kind: 'percentage', source: 'latest', percent: 70, fallbackWeight: 40
    })
  })
})
