import { describe, it, expect } from 'vitest'
import { normalizeState } from './state.js'
import { nextPrescription } from './progression.js'
import { historyUnitCompatible, canChangeWeightUnit } from './workout-model.js'
import { normalizeDayPlan } from './history.js'

const DEF = {
  schemaVersion: 2,
  unit: 'kg',
  restSec: 90,
  prepSec: 5,
  routines: [],
  workouts: [],
  active: null,
  customEx: [],
  programmes: [],
  reminder: { on: false }
}

describe('state boundary normalisation', () => {
  it.each([
    ['missing', {}, {}],
    ['null', { dayPlan: null }, {}],
    ['array', { dayPlan: ['r1'] }, {}],
    ['number', { dayPlan: 7 }, {}],
    ['string', { dayPlan: 'r1' }, {}],
    ['boolean', { dayPlan: false }, {}],
    ['scalar override', { dayPlan: { '2026-01-01': 'r1' } }, { '2026-01-01': ['r1'] }],
    ['rest override', { dayPlan: { '2026-01-02': 'rest' } }, { '2026-01-02': ['rest'] }],
    ['empty list override', { dayPlan: { '2026-01-03': [] } }, { '2026-01-03': [] }],
    ['ordered list override', { dayPlan: { '2026-01-04': ['r2', 'r1'] } }, { '2026-01-04': ['r2', 'r1'] }]
  ])('canonicalizes a %s dayPlan root at every state boundary', (_label, input, expected) => {
    const direct = normalizeDayPlan(input)
    const state = normalizeState(input, DEF)
    expect(direct.dayPlan).toEqual(expected)
    expect(state.dayPlan).toEqual(expected)
    expect(normalizeDayPlan(direct)).toEqual(direct)
    expect(normalizeState(state, DEF).dayPlan).toEqual(expected)
  })

  it('copy-on-read preserves ordered lists without mutating the persisted source', () => {
    const ids = ['r2', 'r1']
    const source = { dayPlan: { '2026-01-04': ids } }
    const normalized = normalizeDayPlan(source)
    ids.push('r3')
    expect(normalized.dayPlan['2026-01-04']).toEqual(['r2', 'r1'])
    expect(normalized.dayPlan['2026-01-04']).not.toBe(ids)
    expect(source.dayPlan['2026-01-04']).toBe(ids)
  })

  it('preserves the versioned Programme namespace across load normalization while retaining legacy arrays', () => {
    const programmes = {
      version: 1,
      cycles: [{ id: 'cycle-1', status: 'active' }],
      skippedInstanceIds: ['pi:old:session']
    }
    const source = { programmes }
    const state = normalizeState(source, DEF)
    expect(state.programmes).toEqual(programmes)
    expect(state.programmes).not.toBe(programmes)
    expect(normalizeState(state, DEF).programmes).toEqual(programmes)
    expect(normalizeState({ programmes: ['legacy-programme'] }, DEF).programmes).toEqual(['legacy-programme'])
  })

  it('replaces an array root with a serializable object before date writes', () => {
    const dayPlan = []
    dayPlan['2026-01-05'] = 'r1'
    const normalized = normalizeDayPlan({ dayPlan })
    expect(normalized.dayPlan).toEqual({})
    expect(JSON.stringify(normalized)).toContain('"dayPlan":{}')
  })

  it('adds explicit work phases to legacy records without inferring warm-up from position', () => {
    const state = normalizeState({
      routines: [{ id: 'r1', name: 'A', ex: [{ id: 'squat', sets: 3, reps: 5 }] }],
      workouts: [{ id: 'w1', d: '2026-01-01', unit: 'kg', entries: [{ id: 'squat', sets: [
        { unit: 'kg', w: 60, r: 5, done: true }, { unit: 'kg', w: 60, r: 5, done: true }
      ] }] }]
    }, DEF)
    expect(state.schemaVersion).toBe(3)
    expect(state.workouts[0].entries[0].sets.map(s => s.phase)).toEqual(['work', 'work'])
    expect(state.workouts[0].vol).toBe(600)
    expect(state.routines[0].ex[0].id).toBe('squat')
  })

  it('preserves warm-up volume and phase-specific fields when loading a newer record', () => {
    const state = normalizeState({
      workouts: [{ id: 'w1', unit: 'kg', entries: [{ id: 'squat', target: { mode: 'reps', sets: 1, reps: 5 }, sets: [
        { phase: 'warmup', unit: 'kg', w: 20, r: 10, done: true },
        { phase: 'work', unit: 'kg', w: 60, r: 5, done: true }
      ] }] }]
    }, DEF)
    const sets = state.workouts[0].entries[0].sets
    expect(sets[0].phase).toBe('warmup')
    expect(sets[1].phase).toBe('work')
    expect(state.workouts[0].vol).toBe(500)
  })

  it('preserves explicit AMRAP roles and deterministically repairs warm-up or duplicate drivers', () => {
    const state = normalizeState({
      active: { entries: [{ id: 'squat', target: { mode: 'reps', kind: 'amrap', sets: 3, reps: 5 }, sets: [
        { phase: 'warmup', w: 20, r: 8, amrapRole: 'progression' },
        { phase: 'work', w: 60, r: 5, amrapRole: 'progression' },
        { phase: 'work', w: 60, r: 5, amrapRole: 'progression' },
        { phase: 'work', w: 60, r: 5 }
      ] }] }
    }, DEF)
    const sets = state.active.entries[0].sets
    expect(sets.map(set => set.amrapRole ?? null)).toEqual([null, 'progression', 'amrap', 'none'])
    expect(normalizeState(state, DEF).active.entries[0].sets).toEqual(sets)
  })

  it.each(['linear', 'double', 'off'])(
    'uses target %s policy over stale Greyskull plan metadata across repeated reloads',
    policy => {
      const input = { active: { entries: [{
        id: 'press',
        target: { mode: 'reps', kind: 'amrap', reps: 5, prog: policy, progressionPolicy: policy },
        plan: { policy: 'greyskull', reason: 'stale' },
        sets: [{ phase: 'work', mode: 'reps', w: 40, r: 5, amrapRole: 'progression' }]
      }] } }
      const once = normalizeState(input, DEF)
      const twice = normalizeState(JSON.parse(JSON.stringify(once)), DEF)

      for (const state of [once, twice]) {
        const entry = state.active.entries[0]
        expect(entry.plan).toMatchObject({ policy, reason: 'stale' })
        expect(entry.sets[0].amrapRole).toBe('amrap')
      }
    }
  )

  it('excludes malformed cardio roles from active persistence and completed history without changing results', () => {
    const completedCardio = {
      phase: 'work', mode: 'cardio', min: 32, speed: 9.5, done: true,
      note: 'keep me', amrapRole: 'progression'
    }
    const input = {
      active: { entries: [{ id: 'run', target: { mode: 'cardio', min: 20, speed: 9 }, sets: [
        { phase: 'work', mode: 'cardio', min: 20, speed: 9, done: false, amrapRole: 'amrap' }
      ] }] },
      workouts: [{ id: 'history', entries: [{ id: 'run', target: { mode: 'cardio', min: 20, speed: 9 }, sets: [completedCardio] }] }]
    }

    const state = normalizeState(input, DEF)

    expect(state.active.entries[0].sets[0]).not.toHaveProperty('amrapRole')
    expect(state.workouts[0].entries[0].sets[0]).toMatchObject({
      phase: 'work', mode: 'cardio', min: 32, speed: 9.5, done: true, note: 'keep me'
    })
    expect(state.workouts[0].entries[0].sets[0]).not.toHaveProperty('amrapRole')
    expect(completedCardio.amrapRole).toBe('progression')
    expect(normalizeState(state, DEF)).toEqual(state)
  })

  it('normalizes optional routine phases and legacy multi-muscle custom exercises', () => {
    const state = normalizeState({
      routines: [{ id: 'r1', name: 'Phased', phases: ['warm-up', 'work', 'work', 'unknown'], ex: [] }],
      customEx: [{ id: 'c1', n: 'Press', bp: 'chest', tg: 'chest', muscleGroups: ['pectorals', 'chest', 'triceps'] }]
    }, DEF)
    expect(state.routines[0].phases).toEqual(['warmup', 'work'])
    expect(state.customEx[0].muscleGroups).toEqual(['chest', 'triceps'])
  })

  it('retains an explicit zero rest value instead of treating it as absent', () => {
    const state = normalizeState({
      routines: [{ id: 'r1', name: 'Zero rest', warmupRestSec: 0, workRestSec: 0, ex: [] }]
    }, DEF)
    expect(state.routines[0]).toMatchObject({ warmupRestSec: 0, workRestSec: 0 })
  })

  it('keeps cardio results readable instead of turning them into repetition sets', () => {
    const state = normalizeState({
      workouts: [{ entries: [{ id: 'run', sets: [{ min: 20, speed: 9, done: true }] }] }]
    }, DEF)
    const entry = state.workouts[0].entries[0]
    expect(entry).not.toHaveProperty('target')
    expect(entry.sets[0]).toMatchObject({ min: 20, speed: 9, r: null, sec: null, phase: 'work' })
    expect(state.workouts[0].vol).toBe(0)
  })

  it('keeps targetless legacy actuals targetless so progression uses the current plan', () => {
    const state = normalizeState({
      workouts: [{ unit: 'kg', entries: [{ id: 'legacy-lift', sets: [
        { unit: 'kg', w: 60, r: 8, done: true }, { unit: 'kg', w: 60, r: 8, done: true }, { unit: 'kg', w: 60, r: 8, done: true }
      ] }] }]
    }, DEF)
    const entry = state.workouts[0].entries[0]
    expect(entry).not.toHaveProperty('target')
    const next = nextPrescription(state, { id: 'legacy-lift', sets: 3, reps: 10, weight: 60, prog: 'linear' })
    expect(next.kind).toBe('hold')
    expect(next.weight).toBe(60)
  })

  it('flattens nested phase targets at the state boundary without dropping warm-up prescriptions', () => {
    const state = normalizeState({
      routines: [{ id: 'r1', ex: [{
        id: 'squat', target: { phase: 'work', mode: 'time', sets: 2, sec: 45, weight: 10 },
        warmup: [{ target: { phase: 'warmup', mode: 'reps', reps: 8, weight: 20 }, restSec: 30 }]
      }] }]
    }, DEF)
    const ex = state.routines[0].ex[0]
    expect(ex).toMatchObject({ mode: 'time', sets: 2, sec: 45, weight: 10 })
    expect(ex.warmup[0]).toMatchObject({ phase: 'warmup', mode: 'reps', reps: 8, weight: 20, restSec: 30 })
  })

  it('preserves the work-set percentage kind for routine and active warm-ups', () => {
    const prescription = { kind: 'workset_percent', percent: 50, fallbackWeight: 10 }
    const state = normalizeState({
      routines: [{ id: 'r1', ex: [{ id: 'squat', mode: 'reps', sets: 1, reps: 5, weight: 100,
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: prescription }] }] }],
      active: { entries: [{ id: 'squat', target: { mode: 'reps', weight: 100,
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: prescription }] },
        sets: [{ phase: 'warmup', mode: 'reps', w: 50, r: 8 }] }] }
    }, DEF)
    expect(state.routines[0].ex[0].warmup[0].weightPrescription).toEqual(prescription)
    expect(state.active.entries[0].target.warmup[0].weightPrescription).toEqual(prescription)
  })

  it('does not recreate a work weight for a nested warm-up-only target', () => {
    const state = normalizeState({
      routines: [{ id: 'r1', ex: [{
        id: 'squat',
        target: {
          phases: ['warmup'], mode: 'reps', sets: 1, reps: 8, weight: 60,
          weightPrescription: { kind: 'fixed', weight: 60 },
          warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20, restSec: 15 }]
        }
      }] }],
      active: { entries: [{ id: 'squat', target: {
        phases: ['warmup'], mode: 'reps', reps: 8, weight: 60,
        weightPrescription: { kind: 'fixed', weight: 60 },
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20, restSec: 15 }]
      }, sets: [{ phase: 'warmup', mode: 'reps', w: 20, r: 8, restSec: 15 }] }] }
    }, DEF)

    const routineEx = state.routines[0].ex[0]
    const activeTarget = state.active.entries[0].target
    expect(routineEx).not.toHaveProperty('weight')
    expect(routineEx).not.toHaveProperty('weightPrescription')
    expect(routineEx.target).not.toHaveProperty('weight')
    expect(activeTarget).not.toHaveProperty('weight')
    expect(activeTarget).not.toHaveProperty('weightPrescription')
    expect(activeTarget.warmup[0]).toMatchObject({ weight: 20, restSec: 15 })
    expect(state.active.entries[0].sets[0]).toMatchObject({ phase: 'warmup', w: 20, r: 8, restSec: 15 })
  })

  it('does not mutate the input state', () => {
    const input = { workouts: [{ entries: [{ id: 'x', sets: [{ w: 1, r: 1, done: true }] }] }] }
    normalizeState(input, DEF)
    expect(input.workouts[0].entries[0].sets[0].phase).toBeUndefined()
  })

  it('preserves a missing weighted workout unit and excludes it from unit-sensitive volume', () => {
    const state = normalizeState({
      unit: 'lb',
      workouts: [{ id: 'unknown-weight', entries: [{ id: 'squat', sets: [{ w: 135, r: 5, done: true }] }] }]
    }, DEF)
    expect(state.workouts[0]).not.toHaveProperty('unit')
    expect(state.workouts[0].entries[0].sets[0]).not.toHaveProperty('unit')
    expect(state.workouts[0].vol).toBe(0)
    expect(historyUnitCompatible(state.workouts[0], state.unit)).toBe(false)
  })

  it('keeps active source provenance unchanged during backup/API state normalization', () => {
    const state = normalizeState({
      unit: 'kg',
      active: { id: 'active-1', sourceUnit: 'lb', entries: [] }
    }, DEF)
    expect(state.active).toMatchObject({ id: 'active-1', sourceUnit: 'lb' })
    expect(state.active).not.toHaveProperty('unit')
    expect(canChangeWeightUnit(state, 'lb')).toBe(false)
    expect(canChangeWeightUnit({ ...state, active: null }, 'lb')).toBe(true)
  })
})
