import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises.js'
import { buildPlanBundle, mergePlan, parsePlan, planPrintHTML } from './plan-share.js'

const LIFT = EXDB.find(ex => ex.bp !== 'cardio' && ex.eq !== 'body weight')

describe('planPrintHTML unit boundary', () => {
  it('renders canonical weights in the selected display unit', () => {
    const html = planPrintHTML({
      unit: 'lb',
      week: {},
      routines: [{ id: 'r1', name: 'Strength', ex: [{ id: LIFT.id, sets: 3, reps: 5, weight: 60 }] }],
      customEx: [],
    }, '')

    expect(html).toContain('132.3 lb')
    expect(html).not.toContain('60 lb')
  })

  it('marks exported plan weights as canonical kilograms', () => {
    const bundle = buildPlanBundle({
      unitsVersion: 1,
      unit: 'lb',
      week: {},
      routines: [{ id: 'r1', name: 'Strength', ex: [{ id: LIFT.id, sets: 3, reps: 5, weight: 60 }] }],
      customEx: [],
    }, 'Strength')

    expect(bundle.weightUnit).toBe('kg')
    expect(parsePlan(bundle).sourceUnit).toBe('kg')
  })

  it('converts legacy pounds in a merged plan at the import boundary', () => {
    const bundle = parsePlan({
      opengym_plan: 1,
      weightUnit: 'lb',
      week: {},
      customEx: [],
      routines: [{ id: 'legacy', name: 'Legacy', ex: [{ id: LIFT.id, sets: 3, reps: 5, weight: 100, inc: 10 }] }],
    })
    const state = { unit: 'kg', routines: [], customEx: [], week: {} }

    mergePlan(state, bundle)

    expect(state.routines[0].ex[0].weight).toBe(100 * 0.45359237)
    expect(state.routines[0].ex[0].inc).toBe(10 * 0.45359237)
  })
})
