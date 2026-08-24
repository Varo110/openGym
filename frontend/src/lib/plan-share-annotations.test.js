import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises.js'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'

const BUILTIN = EXDB.find(exercise => exercise.bp !== 'cardio').id

describe('plan share annotation privacy', () => {
  it('excludes personal cues by default and only imports them when explicitly selected', () => {
    const source = {
      unit: 'kg', week: {},
      routines: [{ id: 'r1', name: 'Private cues', ex: [{ id: BUILTIN }, { id: 'custom-1' }] }],
      customEx: [{ id: 'custom-1', n: 'Private custom', bp: 'back', desc: 'General description', cues: 'legacy personal fallback' }],
      exerciseAnnotations: {
        [BUILTIN]: { cues: 'Keep ribs down' },
        'custom-1': { cues: 'Brace before pulling' }
      }
    }

    const publicBundle = buildPlanBundle(source)
    expect(publicBundle).not.toHaveProperty('exerciseAnnotations')
    expect(publicBundle.customEx[0]).not.toHaveProperty('cues')
    expect(publicBundle.customEx[0].desc).toBe('General description')

    const privateBundle = buildPlanBundle(source, '', { includePersonalCues: true })
    expect(privateBundle.exerciseAnnotations).toEqual(source.exerciseAnnotations)
    expect(privateBundle.customEx[0]).not.toHaveProperty('cues')

    const defaultDestination = { unit: 'kg', routines: [], customEx: [], week: {}, exerciseAnnotations: { [BUILTIN]: { cues: 'Keep local cue' } } }
    mergePlan(defaultDestination, parsePlan(privateBundle))
    expect(defaultDestination.exerciseAnnotations).toEqual({ [BUILTIN]: { cues: 'Keep local cue' } })

    const optedInDestination = { unit: 'kg', routines: [], customEx: [], week: {}, exerciseAnnotations: { [BUILTIN]: { cues: 'Keep local cue' } } }
    mergePlan(optedInDestination, parsePlan(privateBundle), { importPersonalCues: true })
    expect(optedInDestination.exerciseAnnotations[BUILTIN]).toEqual({ cues: 'Keep ribs down' })
    const importedCustom = optedInDestination.customEx.find(exercise => exercise.n === 'Private custom')
    expect(optedInDestination.exerciseAnnotations[importedCustom.id]).toEqual({ cues: 'Brace before pulling' })
  })

  it('applies an explicitly opted-in empty cue as a deliberate local clear', () => {
    const source = {
      unit: 'kg', week: {}, routines: [{ id: 'r1', name: 'Shared', ex: [{ id: BUILTIN, sets: 3, reps: 5, weight: 0 }] }], customEx: [],
      exerciseAnnotations: { [BUILTIN]: { cues: '' } }
    }
    const destination = {
      unit: 'kg', week: {}, routines: [], customEx: [],
      exerciseAnnotations: { [BUILTIN]: { cues: 'Local cue to clear' } }
    }

    const privateBundle = buildPlanBundle(source, '', { includePersonalCues: true })
    mergePlan(destination, parsePlan(privateBundle), { importPersonalCues: true })

    expect(destination.exerciseAnnotations[BUILTIN]).toEqual({ cues: '' })
  })
})
