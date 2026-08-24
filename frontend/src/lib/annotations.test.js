import { describe, expect, it } from 'vitest'
import { cuesForExercise, normalizeExerciseAnnotations, normalizeGroupMeta, normalizeRoutineGroupMeta } from './annotations.js'
import { normalizeState } from './state.js'

describe('per-user exercise annotations', () => {
  it('migrates legacy custom cues exactly without mutating the catalogue or custom description', () => {
    const custom = { id: 'custom-row', n: 'Row', desc: 'A general setup.', cues: 'Brace exactly; elbows back.' }
    const annotations = normalizeExerciseAnnotations({}, [custom])

    expect(annotations).toEqual({ 'custom-row': { cues: 'Brace exactly; elbows back.' } })
    expect(custom).toEqual({ id: 'custom-row', n: 'Row', desc: 'A general setup.', cues: 'Brace exactly; elbows back.' })
    expect(cuesForExercise({ customEx: [custom], exerciseAnnotations: annotations }, 'custom-row', custom)).toBe('Brace exactly; elbows back.')
  })

  it('uses the legacy fallback only for a custom exercise owned by the account', () => {
    const custom = { id: 'custom-row', cues: 'Legacy custom cue' }
    const builtIn = { id: 'catalogue-row', cues: 'Catalogue cue must not become personal' }
    const state = { customEx: [custom], exerciseAnnotations: {} }

    expect(cuesForExercise(state, custom.id, custom)).toBe('Legacy custom cue')
    expect(cuesForExercise(state, builtIn.id, builtIn)).toBe('')
  })

  it('migrates and preserves every cue in a synthetic exact-90 legacy custom fixture', () => {
    const legacyCustomExercises = Array.from({ length: 90 }, (_, index) => ({
      id: `legacy-${index + 1}`,
      n: `Legacy exercise ${index + 1}`,
      bp: 'back',
      cues: `Exact legacy cue ${index + 1}`
    }))
    const annotations = normalizeExerciseAnnotations({}, legacyCustomExercises)

    expect(Object.keys(annotations)).toHaveLength(90)
    for (const exercise of legacyCustomExercises) {
      expect(annotations[exercise.id]).toEqual({ cues: exercise.cues })
      expect(cuesForExercise({ customEx: legacyCustomExercises, exerciseAnnotations: annotations }, exercise.id)).toBe(exercise.cues)
    }
  })

  it('keeps only real adjacent groups and their routine-scoped metadata', () => {
    const routine = {
      id: 'r1',
      ex: [{ id: 'a', sg: 'pair' }, { id: 'b', sg: 'pair' }, { id: 'c', sg: 'orphan' }],
      groupMeta: {
        pair: { kind: 'complex', label: 'Clean + press', cues: 'Do not rack between movements.' },
        orphan: { kind: 'superset', label: 'Must disappear', cues: 'orphan' }
      }
    }

    expect(normalizeGroupMeta(routine.ex, routine.groupMeta)).toEqual({
      pair: { kind: 'complex', label: 'Clean + press', cues: 'Do not rack between movements.' }
    })
    expect(normalizeRoutineGroupMeta(routine)).toEqual({
      ...routine,
      ex: [{ id: 'a', sg: 'pair' }, { id: 'b', sg: 'pair' }, { id: 'c' }],
      groupMeta: { pair: { kind: 'complex', label: 'Clean + press', cues: 'Do not rack between movements.' } }
    })
  })

  it('normalizes legacy state into account annotations while retaining frozen active group metadata', () => {
    const state = normalizeState({
      customEx: [{ id: 'custom', n: 'Custom', bp: 'back', desc: 'General', cues: 'Exact migration cue' }],
      routines: [{ id: 'r1', ex: [{ id: 'a', sg: 'g' }, { id: 'b', sg: 'g' }, { id: 'c', sg: 'orphan' }], groupMeta: { g: { kind: 'superset', cues: 'No rest' }, orphan: { cues: 'remove' } } }],
      active: { id: 'active', entries: [], groupMeta: { g: { kind: 'superset', cues: 'Frozen instruction' } } }
    })

    expect(state.schemaVersion).toBe(3)
    expect(state.exerciseAnnotations.custom).toEqual({ cues: 'Exact migration cue' })
    expect(state.customEx[0]).toMatchObject({ desc: 'General', cues: 'Exact migration cue' })
    expect(state.routines[0].groupMeta).toEqual({ g: { kind: 'superset', cues: 'No rest' } })
    expect(state.routines[0].ex[2].sg).toBeUndefined()
    expect(state.active.groupMeta.g.cues).toBe('Frozen instruction')
  })
})
