import { describe, expect, it } from 'vitest'
import { applyPickupSuggestion, buildPickupAction, consumePickupAction, derivePickupSuggestions, highestWorkingValue, pickupExercisesFromProgramme, pickupIncrement, pickupRows, pickupCycleFor, resolvePickupContext, savedPickupPolicy, snapPickupLoad, stepDeloadPercent, updatePickupValue } from './programme-pickup.js'
import { repeatProgrammeCycleInState } from './programmes-ui.js'

describe('programme pickup math', () => {
  it('floors deloads to display-unit increments', () => {
    expect(snapPickupLoad(62.5, 90, 2.5)).toBe(55)
    expect(snapPickupLoad(135, 90, 5)).toBe(120)
  })

  it('clamps the free deload stepper', () => {
    expect(stepDeloadPercent(50, -5)).toBe(50)
    expect(stepDeloadPercent(100, 5)).toBe(100)
    expect(stepDeloadPercent(90, -5)).toBe(85)
  })

  it('honours exercise increment overrides and handles bodyweight/cardio rows', () => {
    expect(pickupIncrement({ id: 'custom', inc: 7.5 }, 'kg')).toBe(7.5)
    const rows = pickupRows({
      exercises: [
        { id: 'custom', n: 'Mystery', bp: 'chest', weight: 20 },
        { id: 'bw', n: 'Pull-up', mode: 'reps', reps: 8, bodyweight: true },
        { id: 'run', n: 'Run', mode: 'cardio', min: 20 }
      ], unit: 'kg'
    })
    expect(rows[0].defaultIncrement).toBe(true)
    expect(rows[1].bodyweight).toBe(true)
    expect(rows[2].cardio).toBe(true)
  })

  it('uses the highest completed work value for bodyweight, timed, and cardio rows', () => {
    const exercises = [
      { id: 'bw', n: 'Pull-up', mode: 'reps', reps: 8, bodyweight: true, bp: 'back' },
      { id: 'hold', n: 'Hang', mode: 'time', sec: 45, bodyweight: true, bp: 'back' },
      { id: 'run', n: 'Run', mode: 'cardio', min: 20, speed: 8, bp: 'cardio' },
    ]
    const workouts = [{ unit: 'kg', entries: [
      { id: 'bw', unit: 'kg', target: { mode: 'reps', bodyweight: true, unit: 'kg' }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', r: 12, w: 0, done: true },
      ] },
      { id: 'hold', unit: 'kg', target: { mode: 'time', bodyweight: true, unit: 'kg' }, sets: [
        { phase: 'work', mode: 'time', unit: 'kg', sec: 50, w: 0, done: true },
      ] },
    ] }]

    const rows = pickupRows({ exercises, workouts, mode: 'max' })
    expect(rows.map(row => row.value)).toEqual([12, 50, null])
    expect(highestWorkingValue(workouts, exercises[0], 'kg')).toBe(12)
    expect(highestWorkingValue(workouts, exercises[1], 'kg')).toBe(50)
  })

  it('filters warm-ups, incomplete rows, and incompatible units from working history', () => {
    const exercise = { id: 'lift', n: 'Press', mode: 'reps', weight: 40, bp: 'chest' }
    const workouts = [
      { unit: 'kg', entries: [{ id: 'lift', unit: 'kg', target: { mode: 'reps', unit: 'kg' }, sets: [
        { phase: 'warmup', mode: 'reps', unit: 'kg', w: 250, r: 5, done: true },
        { phase: 'work', mode: 'reps', unit: 'kg', w: 200, r: 5, done: false },
        { phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 5, done: true },
      ] }] },
      { unit: 'lb', entries: [{ id: 'lift', unit: 'lb', target: { mode: 'reps', unit: 'lb' }, sets: [
        { phase: 'work', mode: 'reps', unit: 'lb', w: 200, r: 5, done: true },
      ] }] },
    ]

    expect(highestWorkingValue(workouts, exercise, 'kg')).toBe(80)
    expect(pickupRows({ exercises: [exercise], workouts, unit: 'kg' })[0].value).toBe(80)
  })

  it('deloads bodyweight reps and seconds, applies percentage suggestions, and floors at one', () => {
    const exercises = [
      { id: 'bw', n: 'Pull-up', mode: 'reps', reps: 8, bodyweight: true, bp: 'back' },
      { id: 'hold', n: 'Hang', mode: 'time', sec: 45, bodyweight: true, bp: 'back' },
    ]
    const workouts = [{ unit: 'kg', entries: [
      { id: 'bw', unit: 'kg', target: { mode: 'reps', bodyweight: true, unit: 'kg' }, sets: [{ phase: 'work', unit: 'kg', r: 12, w: 0, done: true }] },
      { id: 'hold', unit: 'kg', target: { mode: 'time', bodyweight: true, unit: 'kg' }, sets: [{ phase: 'work', unit: 'kg', sec: 45, w: 0, done: true }] },
    ] }]
    const rows = pickupRows({ exercises, workouts, mode: 'deload', percent: 75, suggestions: { back: 75 } })

    expect(rows.map(row => row.value)).toEqual([9, 33])
    expect(rows.every(row => row.value >= 1)).toBe(true)
    expect(applyPickupSuggestion({ ...rows[0], base: 12, suggestion: 75 })).toMatchObject({ value: 9 })
    expect(applyPickupSuggestion({ ...rows[0], base: 1, suggestion: 50 })).toMatchObject({ value: 1 })
  })

  it('matches canonical muscle slugs and preserves manual rows across suggestions and mode changes', () => {
    const exercise = { id: 'lift', n: 'Press', mode: 'reps', weight: 62.5, tg: 'pectorals', bp: 'chest' }
    const initial = pickupRows({ exercises: [exercise], suggestions: { chest: 75 } })
    expect(initial[0].suggestion).toBe(75)

    const edited = updatePickupValue(initial, 'lift', 17)
    expect(applyPickupSuggestion(edited[0])).toMatchObject({ value: 17, manual: true })
    const rebuilt = pickupRows({ exercises: [exercise], mode: 'deload', percent: 90, suggestions: { chest: 75 }, previousRows: edited })
    expect(rebuilt[0]).toMatchObject({ value: 17, manual: true })
  })

  it('extracts exercises from the selected versioned programme cycle and reads its saved policy', () => {
    const cycle = {
      id: 'cycle-1',
      status: 'complete',
      prog: 'linear',
      snapshot: { weeks: [{ days: [{ sessions: [{ routineSnapshot: { ex: [
        { id: 'lift', n: 'Press' },
        { id: 'pull', n: 'Row' },
      ] } }] }] }] },
    }
    const programme = { version: 1, id: 'programme-1', cycles: [cycle] }

    expect(pickupCycleFor(programme)).toBe(cycle)
    expect(pickupCycleFor({ cycles: [
      { id: 'active', status: 'active', definitionId: 'programme-1' },
      { id: 'done', status: 'done', definitionId: 'programme-1' },
    ] })).toBeNull()
    expect(pickupCycleFor({ cycles: [{ id: 'active', status: 'active' }, cycle] })).toBe(cycle)
    expect(pickupCycleFor({ cycles: [{ id: 'active', status: 'active' }] }, { id: 'active', status: 'active' })).toBeNull()
    expect(pickupCycleFor({ cycles: [{ id: 'active', status: 'active' }] })).toBeNull()
    expect(pickupCycleFor({ cycles: [{ id: 'draft', status: 'draft' }] })).toBeNull()
    expect(pickupCycleFor({ cycles: [{ id: 'done', status: 'done' }] })).toMatchObject({ id: 'done' })
    expect(pickupExercisesFromProgramme(programme).map(exercise => exercise.id)).toEqual(['lift', 'pull'])
    expect(savedPickupPolicy({ programme, cycle })).toBe('linear')
  })

  it('skips cardio rows and blank values from starting-values to keep repeat contracts canonical', () => {
    const action = buildPickupAction({
      intent: 'repeat',
      rows: [
        { id: 'run', key: 'run:0', cardio: true, value: null },
        { id: 'lift', key: 'lift:0', value: 80 },
        { id: 'empty', key: 'empty:0', value: '' },
        { id: 'zero', key: 'zero:0', value: 0 },
      ],
      cycle: { id: 'cycle-1' },
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      policy: 'linear',
    })

    expect(action.startingValues).toEqual({ 'lift:0': 80, 'zero:0': 0 })
  })

  it('resolves real namespace IDs and emits a lifecycle-safe final-load action', () => {
    const definition = {
      id: 'programme-1',
      name: 'Strength',
      progression: 'double',
      weeks: [{ days: [{ sessions: [{ routineSnapshot: { id: 'push', ex: [{ id: 'lift', mode: 'reps', weight: 80 }] } }] }] }]
    }
    const cycle = {
      id: 'cycle-1', programmeId: 'programme-1', status: 'done', progression: 'linear',
      snapshot: { weeks: definition.weeks }
    }
    const namespace = { version: 1, definitions: [definition], cycles: [cycle] }
    const context = resolvePickupContext({ state: { programmeId: 'programme-1', cycleId: 'cycle-1' }, namespace })

    expect(context).toMatchObject({ programme: definition, cycle, programmeId: 'programme-1', cycleId: 'cycle-1', valid: true })
    expect(resolvePickupContext({
      state: { programmeId: 'programme-1', cycleId: 'cycle-1', mode: 'repeat' },
      namespace: { version: 1, definitions: [definition], cycles: [cycle, { id: 'cycle-2', programmeId: 'programme-1', status: 'active', snapshot: { weeks: definition.weeks } }] },
    }).valid).toBe(false)

    expect(resolvePickupContext({
      state: { programmeId: 'programme-1', cycleId: 'cycle-2', mode: 'repeat' },
      namespace: { version: 1, definitions: [definition], cycles: [
        { id: 'cycle-1', definitionId: 'programme-1', status: 'done', snapshot: { weeks: [] } },
        { id: 'cycle-2', definitionId: 'programme-2', status: 'done', snapshot: { weeks: [] } },
      ] },
    }).valid).toBe(false)

    expect(resolvePickupContext({
      state: { programmeId: 'programme-1', mode: 'repeat' },
      programme: { id: 'programme-2', version: 2 },
      namespace: { version: 1, definitions: [definition, { id: 'programme-2', weeks: [] }], cycles: [
        { id: 'cycle-1', definitionId: 'programme-2', status: 'done', snapshot: { weeks: [] } },
        { id: 'cycle-2', definitionId: 'programme-1', status: 'done', snapshot: { weeks: [] } },
      ] },
    }).valid).toBe(false)

    expect(resolvePickupContext({
      state: { programmeId: 'programme-1', cycleId: 'cycle-1', mode: 'repeat' },
      cycle: { id: 'cycle-3', programmeId: 'programme-1', status: 'done', snapshot: { weeks: [] } },
      namespace: { version: 1, definitions: [definition], cycles: [
        { id: 'cycle-1', definitionId: 'programme-1', status: 'done', snapshot: { weeks: [] } },
      ] },
    }).valid).toBe(false)

    expect(resolvePickupContext({ state: { programmeId: 'programme-1', cycleId: 'cycle-1', mode: 'repeat' }, namespace }).cycle).toBe(cycle)
    expect(resolvePickupContext({ state: { programmeId: 'programme-1', cycleId: 'other', mode: 'repeat' }, namespace }).valid).toBe(false)

    const action = buildPickupAction({
      intent: 'repeat', loadMode: 'deload', percent: 90, policy: 'linear', unit: 'lb',
      programme: context.programme, cycle: context.cycle,
      rows: [{ id: 'lift', key: 'push:lift:0', value: 70, base: 80 }]
    })

    expect(action).toMatchObject({
      type: 'programme-pickup', mode: 'repeat', loadMode: 'deload', startMode: 'highest',
      percent: 90, deloadPercent: 10, startingValuesAreFinal: true, policy: 'linear', unit: 'lb',
      programmeId: 'programme-1', cycleId: 'cycle-1',
      startingValues: { 'push:lift:0': 70 }
    })
    expect(action.rows[0]).toMatchObject({ id: 'lift', value: 70 })
  })

  it('consumes one repeat action through the lifecycle boundary without reapplying its displayed deload', () => {
    const definition = {
      id: 'programme-1', progression: 'linear',
      weeks: [{ days: [{ sessions: [{ routineSnapshot: { id: 'push', ex: [{ id: 'lift', weight: 80, mode: 'reps' }] } }] }] }]
    }
    const snapshot = {
      id: 'programme-1',
      weeks: definition.weeks,
      progression: 'linear',
    }
    const completed = {
      id: 'cycle-1', programmeId: 'programme-1', status: 'done',
      snapshot: { weeks: definition.weeks },
      programmeSnapshot: snapshot
    }
    const state = { programmes: { version: 1, definitions: [definition], cycles: [completed] } }
    const action = buildPickupAction({
      intent: 'repeat', loadMode: 'deload', percent: 90, policy: 'linear', unit: 'lb',
      programmeId: 'programme-1', cycleId: 'cycle-1',
      rows: [{ id: 'lift', pickupKeys: ['push:lift:0'], value: 70 }]
    })
    const calls = []
    const repeated = consumePickupAction(action, {
      repeat: options => {
        calls.push(options)
        const next = repeatProgrammeCycleInState(state, options.cycleId, {
          ...options,
          cycleId: 'cycle-2',
        })
        expect(next).toMatchObject({ startMode: 'highest', progression: 'linear' })
        return next
      },
    })

    expect(repeated).toMatchObject({ id: 'cycle-2', programmeId: 'programme-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ mode: 'repeat', startMode: 'highest', deloadPercent: 10, progression: 'linear', unit: 'lb' })
    expect(calls[0].startingValues).toEqual({ 'push:lift:0': 70 })
    expect(state.programmes.cycles).toHaveLength(2)
    expect(state.programmes.cycles[1].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]).toMatchObject({ weight: 70 })
    expect(state.programmes.cycles[1].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).not.toBe(63)
  })

  it('trims whitespace before treating inputs as finite starting values', () => {
    const action = buildPickupAction({
      intent: 'start', mode: 'deload', percent: 90, rows: [
        { id: 'blank', key: 'blank:0', value: '   ' },
        { id: 'zero', key: 'zero:0', value: '0' },
      ],
    })
    expect(action.startingValues).toEqual({ 'zero:0': 0 })
  })

  it('derives a percentage suggestion from the canonical strength map and emits the start action contract', () => {
    const now = Date.UTC(2026, 0, 22, 12)
    const suggestions = derivePickupSuggestions({
      unit: 'kg',
      now,
      exercises: [{ id: '1001' }],
      workouts: [{ start: now - 15 * 86400000, unit: 'kg', entries: [{ id: '1001', unit: 'kg', target: { mode: 'reps', unit: 'kg' }, sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 8, done: true },
      ] }] }],
    })
    expect(suggestions['1001']).toBe(100)

    const rows = [{ id: '1001', value: 60, manual: false }]
    const action = buildPickupAction({ startMode: 'repeat', mode: 'deload', percent: 75, policy: 'linear', programme: { id: 'p' }, cycle: { id: 'c' }, rows })
    expect(action).toMatchObject({ type: 'programme-pickup', mode: 'repeat', loadMode: 'deload', startMode: 'highest', percent: 75, deloadPercent: 25, policy: 'linear', programmeId: 'p', cycleId: 'c' })
    expect(action.rows).toEqual(rows)
    expect(action.rows).not.toBe(rows)
  })
})
