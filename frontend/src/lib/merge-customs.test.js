import { describe, expect, it } from 'vitest'
import { mergeCustomExercises, suggestMatches } from './merge-customs.js'

describe('suggestMatches', () => {
  it('ranks an exact catalogue word-bag before weaker candidates', () => {
    const matches = suggestMatches('Press  bench  barbell')
    expect(matches[0]).toBe('0025')
    expect(matches).toEqual([...new Set(matches)])
    expect(matches.length).toBeLessThanOrEqual(3)
  })

  it('ranks a close multi-token overlap first', () => {
    expect(suggestMatches('flat barbell bench pressing')[0]).toBe('0025')
  })

  it('does not guess for generic single tokens or unrelated names', () => {
    expect(suggestMatches('press')).toEqual([])
    expect(suggestMatches('row')).toEqual([])
    expect(suggestMatches('a completely unrelated movement name')).toEqual([])
  })

  it('offers the curated importer matches for common imported names', () => {
    for (const [name, id] of [
      ['flat barbell bench press', '0025'],
      ['ab wheel rollout', '0857'],
      ['kettlebell swings (2 hand)', '0549'],
      ['dumbbell overhead triceps extension', '0430'],
      ['rings row', '0808'],
      ['flat dumbbell fly', '0308'],
      ['parallel bar triceps dip', '1755'],
    ]) {
      expect(suggestMatches(name), name).toContain(id)
    }
  })
})

describe('mergeCustomExercises', () => {
  it('remaps PRs and nested routine exercise references without changing timestamps', () => {
    const state = {
      customEx: [{ id: 'c-old', n: 'Old', custom: true }],
      routines: [{
        id: 'routine-1',
        ex: [{
          id: 'c-old',
          target: { id: 'c-old', reps: 5 },
          warmup: [{ id: 'c-old', target: { id: 'c-old', reps: 8 } }],
        }],
      }],
      workouts: [{
        id: 'workout-1', d: '2024-01-02', start: 1704189600123, end: 1704191400456,
        entries: [{ id: 'c-old', target: { id: 'c-old' }, sets: [] }],
        prs: ['c-old', '0085'],
      }],
      exWeights: {},
    }

    const merged = mergeCustomExercises(state, { 'c-old': '0025' })

    expect(merged.workouts[0]).toMatchObject({
      d: '2024-01-02', start: 1704189600123, end: 1704191400456,
      prs: ['0025', '0085'],
    })
    expect(merged.routines[0].ex[0]).toMatchObject({
      id: '0025',
      target: { id: '0025' },
      warmup: [{ id: '0025', target: { id: '0025' } }],
    })
    expect(state.workouts[0].prs).toEqual(['c-old', '0085'])
    expect(state.routines[0].ex[0].target.id).toBe('c-old')
  })

  it('re-points workouts, nested targets, routines, and merges best weights without changing dates', () => {
    const state = {
      unit: 'kg',
      customEx: [
        { id: 'c-old', n: 'Old bench import', custom: true },
        { id: 'c-second', n: 'Second import', custom: true },
        { id: 'c-keep', n: 'Keep this custom', custom: true },
      ],
      routines: [{ id: 'routine-1', ex: [{ id: 'c-old', reps: 5 }, { id: 'c-keep' }] }],
      workouts: [{
        id: 'workout-1', d: '2024-01-02', start: 1704189600123, end: 1704191400456,
        entries: [
          { id: 'c-old', target: { id: 'c-old', reps: 5 }, sets: [{ w: 100, r: 5, done: true }] },
          { id: 'c-second', target: { reps: 8 }, sets: [] },
          { id: 'c-keep', target: { id: 'c-keep' }, sets: [] },
        ],
      }],
      active: {
        id: 'active-1', start: 1704200000000,
        entries: [{ id: 'c-second', target: { id: 'c-second' }, sets: [] }],
      },
      exWeights: {
        'c-old': { w: 100, d: '2024-02-01', unit: 'kg', source: 'custom' },
        '0025': { w: 100, d: '2024-03-01', unit: 'kg', source: 'catalogue' },
        'c-second': { w: 110, d: '2024-01-01', unit: 'kg' },
        '0085': { w: 105, d: '2024-04-01', unit: 'kg' },
        'c-keep': { w: 20, d: '2024-01-01', unit: 'kg' },
      },
      untouched: { preserve: true },
    }
    const before = JSON.stringify(state)
    const beforeDates = state.workouts.map(({ d, start, end }) => ({ d, start, end }))

    const merged = mergeCustomExercises(state, { 'c-old': '0025', 'c-second': '0085' })

    expect(state).toEqual(JSON.parse(before))
    expect(merged.customEx.map(ex => ex.id)).toEqual(['c-keep'])
    expect(merged.workouts[0].entries.map(entry => entry.id)).toEqual(['0025', '0085', 'c-keep'])
    expect(merged.workouts[0].entries[0].target.id).toBe('0025')
    expect(merged.workouts[0].entries[1].target).toEqual({ reps: 8 })
    expect(merged.workouts.map(({ d, start, end }) => ({ d, start, end }))).toEqual(beforeDates)
    expect(merged.routines[0].ex.map(ex => ex.id)).toEqual(['0025', 'c-keep'])
    expect(merged.active.entries[0].id).toBe('0085')
    expect(merged.active.entries[0].target.id).toBe('0085')

    expect(merged.exWeights['0025']).toEqual({ w: 100, d: '2024-03-01', unit: 'kg', source: 'catalogue' })
    expect(merged.exWeights['0085']).toEqual({ w: 110, d: '2024-01-01', unit: 'kg' })
    expect(merged.exWeights).not.toHaveProperty('c-old')
    expect(merged.exWeights).not.toHaveProperty('c-second')
    expect(merged.exWeights['c-keep']).toEqual({ w: 20, d: '2024-01-01', unit: 'kg' })
  })

  it('uses the newer record when merged and catalogue weights tie', () => {
    const state = {
      unit: 'kg',
      customEx: [{ id: 'c-old', n: 'Old', custom: true }],
      workouts: [], routines: [], exWeights: {
        'c-old': { w: 100, d: '2030-01-01', unit: 'kg' },
        '0025': { w: 100, d: '2020-01-01', unit: 'kg' },
      },
    }
    const merged = mergeCustomExercises(state, { 'c-old': '0025' })
    expect(merged.exWeights['0025']).toEqual({ w: 100, d: '2030-01-01', unit: 'kg' })
  })

  it('uses a merged record when its weight beats the catalogue record', () => {
    const state = {
      unit: 'kg',
      customEx: [{ id: 'c-old', n: 'Old', custom: true }],
      workouts: [], routines: [], exWeights: {
        'c-old': { w: 125, d: '2020-01-01', unit: 'kg' },
        '0025': { w: 100, d: '2030-01-01', unit: 'kg' },
      },
    }
    const merged = mergeCustomExercises(state, { 'c-old': '0025' })
    expect(merged.exWeights['0025']).toEqual({ w: 125, d: '2020-01-01', unit: 'kg' })
  })

  it('does not replace a current-unit cache by comparing an incompatible raw value', () => {
    const state = {
      unit: 'kg',
      customEx: [{ id: 'c-old', n: 'Old', custom: true }],
      workouts: [], routines: [], exWeights: {
        'c-old': { w: 225, d: '2030-01-01', unit: 'lb' },
        '0025': { w: 100, d: '2020-01-01', unit: 'kg' },
      },
    }

    const merged = mergeCustomExercises(state, { 'c-old': '0025' })

    expect(merged.exWeights['0025']).toEqual({ w: 100, d: '2020-01-01', unit: 'kg' })
    expect(merged.exWeights).not.toHaveProperty('c-old')
  })

  it('leaves kept customs and invalid mappings untouched', () => {
    const state = {
      customEx: [{ id: 'c-keep', n: 'Keep', custom: true }],
      workouts: [{ d: '2024-01-01', entries: [{ id: 'c-keep' }] }],
      routines: [{ ex: [{ id: 'c-keep' }] }],
      exWeights: { 'c-keep': { w: 10, d: '2024-01-01' } },
    }
    const merged = mergeCustomExercises(state, { 'c-keep': 'not-a-catalogue-id' })
    expect(merged).toEqual(state)
    expect(mergeCustomExercises(state, { 'missing-custom': '0025' })).toEqual(state)
  })
})
