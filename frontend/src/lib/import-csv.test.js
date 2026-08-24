import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises.js'
import { mergeImport, parseBodyweight, parseWorkoutCSV } from './import-csv.js'

const LIFT_NAME = EXDB.find(e => e.bp !== 'cardio').n

describe('CSV completed-workout phase and unit persistence', () => {
  it('keeps imported warm-up phase and converts/persists the destination unit through merge', () => {
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Set Type,Weight,Weight Unit,Reps',
      `2026-05-01,${LIFT_NAME},Warmup,20,kg,8`,
      `2026-05-01,${LIFT_NAME},Working,135,lb,5`
    ].join('\n'), { unit: 'kg' })
    expect(parsed.workouts[0]).toMatchObject({ unit: 'kg', sourceUnit: 'mixed' })
    expect(parsed.workouts[0].entries[0].sets[0]).toMatchObject({ phase: 'warmup', unit: 'kg', w: 20 })
    expect(parsed.workouts[0].entries[0].sets[1]).toMatchObject({ phase: 'work', unit: 'kg', w: 61.2 })

    const state = { unit: 'kg', workouts: [], bodyweight: [], customEx: [], exWeights: {} }
    mergeImport(state, parsed)
    expect(state.workouts[0].unit).toBe('kg')
    expect(state.workouts[0].entries[0].sets[0].phase).toBe('warmup')
    expect(state.exWeights[parsed.workouts[0].entries[0].id]).toMatchObject({ unit: 'kg', w: 61.2 })
  })

  it('rejects generic weighted rows without an explicit unit instead of stamping the destination unit', () => {
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Set Type,Weight,Reps',
      `2026-05-02,${LIFT_NAME},Working,60,5`
    ].join('\n'), { unit: 'kg' })
    expect(parsed.unknownWeightRows).toBe(1)
    expect(parsed.workouts).toEqual([])
    expect(parsed.skipped).toBe(1)
  })

  it('keeps explicit-unit rows usable beside rejected untagged numeric weights', () => {
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Set Type,Weight,Weight Unit,Reps',
      `2026-05-03,${LIFT_NAME},Warmup,20,kg,8`,
      `2026-05-03,${LIFT_NAME},Working,60,,5`,
      `2026-05-03,${LIFT_NAME},Working,135,lb,5`
    ].join('\n'), { unit: 'kg' })
    expect(parsed.unknownWeightRows).toBe(1)
    expect(parsed.workouts[0]).toMatchObject({ unit: 'kg' })
    expect(parsed.workouts[0].entries[0].sets).toHaveLength(2)
    expect(parsed.workouts[0].entries[0].sets.map(s => s.phase)).toEqual(['warmup', 'work'])
    expect(parsed.workouts[0].entries[0].sets[1]).toMatchObject({ unit: 'kg', w: 61.2 })
  })
})

describe('body-weight import unit provenance', () => {
  it('converts generic CSV rows from their own kg/lb units and counts unknown rows', () => {
    const parsed = parseBodyweight([
      'Date,Weight,Weight Unit',
      '2026-05-10,70,kg',
      '2026-05-11,154,lb',
      '2026-05-12,80,stone'
    ].join('\n'), { unit: 'kg' })

    expect(parsed).toMatchObject({
      kind: 'bodyweight', fileUnit: '', mixedUnits: true, converted: true, unknownWeightRows: 1
    })
    expect(parsed.bodyweight.map(({ d, w }) => ({ d, w }))).toEqual([
      { d: '2026-05-10', w: 70 },
      { d: '2026-05-11', w: 69.9 }
    ])
  })

  it('converts XML records independently and counts an unsupported unit', () => {
    const parsed = parseBodyweight([
      '<HealthData>',
      '<Record type="HKQuantityTypeIdentifierBodyMass" value="70" unit="kg" startDate="2026-05-13 08:00:00 +0000"/>',
      '<Record type="HKQuantityTypeIdentifierBodyMass" value="154" unit="lb" startDate="2026-05-14 08:00:00 +0000"/>',
      '<Record type="HKQuantityTypeIdentifierBodyMass" value="80" unit="stone" startDate="2026-05-15 08:00:00 +0000"/>',
      '</HealthData>'
    ].join('\n'), { unit: 'kg' })

    expect(parsed).toMatchObject({
      kind: 'bodyweight', fileUnit: '', mixedUnits: true, converted: true, unknownWeightRows: 1
    })
    expect(parsed.bodyweight.map(({ d, w }) => ({ d, w }))).toEqual([
      { d: '2026-05-13', w: 70 },
      { d: '2026-05-14', w: 69.9 }
    ])
  })

  it('returns an empty bodyweight result with the warning count when every positive row is unknown', () => {
    const parsed = parseBodyweight([
      'Date,Weight,Weight Unit',
      '2026-05-16,70,',
      '2026-05-17,154,stone'
    ].join('\n'), { unit: 'kg' })

    expect(parsed).toMatchObject({
      kind: 'bodyweight', bodyweight: [], unknownWeightRows: 2, fileUnit: '', mixedUnits: false, converted: false
    })
    expect(parsed.error).toBeUndefined()
  })
})

describe('curated importer aliases', () => {
  it('resolves common names that otherwise become duplicate custom exercises', async () => {
    const { matchExercise } = await import('./import-csv.js')
    const aliases = {
      'flat barbell bench press': '0025',
      'ab wheel rollout': '0857',
      'kettlebell swings (2 hand)': '0549',
      'dumbbell overhead triceps extension': '0430',
      'rings row': '0808',
      'flat dumbbell fly': '0308',
      'parallel bar triceps dip': '1755',
      'turkish get up': '0551',
      'single leg deadlift': '1756',
      'step up': '0114',
      'back lunge (barbell)': '0078',
    }
    for (const [name, id] of Object.entries(aliases)) expect(matchExercise(name)).toBe(id)
  })
})

describe('CSV timed and cardio row modes', () => {
  it('imports a weighted timed plank as an explicit time row with converted weight provenance', () => {
    const exercise = EXDB.find(e => e.n === 'weighted front plank')
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Weight,Weight Unit,Duration',
      `2026-05-20,${exercise.n},22,lb,45`
    ].join('\n'), { unit: 'kg' })

    expect(parsed.workouts[0].entries[0].id).toBe(exercise.id)
    expect(parsed.workouts[0].entries[0].sets[0]).toMatchObject({
      phase: 'work', mode: 'time', sec: 45, w: 10, unit: 'kg', done: true
    })
  })

  it('keeps an unweighted seconds row timed with an explicit zero weight', () => {
    const exercise = EXDB.find(e => e.n === 'front plank with twist')
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Seconds',
      `2026-05-21,${exercise.n},30`
    ].join('\n'), { unit: 'kg' })

    expect(parsed.workouts[0].entries[0].id).toBe(exercise.id)
    expect(parsed.workouts[0].entries[0].sets[0]).toMatchObject({
      phase: 'work', mode: 'time', sec: 30, w: 0, done: true
    })
    expect(parsed.workouts[0].entries[0].sets[0]).not.toHaveProperty('unit')
  })

  it('keeps a catalogued running distance row as cardio with minutes and speed', () => {
    const exercise = EXDB.find(e => e.n === 'run')
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Distance,Distance Unit,Time',
      `2026-05-22,${exercise.n},5,km,30`
    ].join('\n'), { unit: 'kg' })

    expect(parsed.workouts[0].entries[0].id).toBe(exercise.id)
    expect(parsed.workouts[0].entries[0].sets[0]).toMatchObject({
      phase: 'work', min: 30, speed: 10, done: true
    })
    expect(parsed.workouts[0].entries[0].sets[0]).not.toHaveProperty('sec')
  })
})


describe('unit stamping for unit-less files', () => {
  it('stamps the profile unit on every positive weighted set so the record stays compatible', () => {
    // the classic FitNotes shape: no unit column and no Set Type - the legacy path that
    // assumes the profile unit - must still stamp it, or the record fails the unit model
    const csv = [
      'Date,Workout Name,Exercise,Category,Weight,Reps',
      '2026-01-02,Legs,Barbell Bench Press,Chest,80,8',
      '2026-01-02,Legs,Barbell Bench Press,Chest,50,8',
    ].join('\n')
    const parsed = parseWorkoutCSV(csv, { unit: 'kg' })
    expect(parsed.workouts).toHaveLength(1)
    const w = parsed.workouts[0]
    expect(w.unit).toBe('kg')
    const sets = w.entries[0].sets
    expect(sets.every(s => s.w > 0 && s.unit === 'kg')).toBe(true)
  })
})
