import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises.js'
import {
  buildSets,
  metricModeForEntry,
  setsByPhase,
  volumeByPhase,
  workoutVolume
} from './history.js'
import { best1RM, e1rmSeries } from './onerm.js'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'
import { nextPrescription, readSession } from './progression.js'
import { amrapResultFor, sessionConfigFor } from './workout-runtime.js'
import { stampCompletedWorkout } from './workout-model.js'

const LIFT = EXDB.find(exercise => exercise.bp !== 'cardio' && exercise.eq !== 'body weight').id

describe('phase-aware cross-feature integration', () => {
  it('keeps warm-up volume while progression, 1RM, and mode switches consume only compatible work', () => {
    const repsTarget = { phase: 'work', mode: 'reps', kind: 'fixed', sets: 3, reps: 5, weight: 60 }
    const repsWorkout = stampCompletedWorkout({
      d: '2026-05-01', start: 1,
      entries: [{
        id: LIFT,
        target: repsTarget,
        sets: [
          { phase: 'warmup', mode: 'reps', w: 20, r: 10, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
        ]
      }]
    }, 'kg')
    const timedWorkout = stampCompletedWorkout({
      d: '2026-05-08', start: 2,
      entries: [{
        id: LIFT,
        target: { phase: 'work', mode: 'time', kind: 'fixed', sets: 1, sec: 45, weight: 200 },
        sets: [{ phase: 'work', mode: 'time', w: 200, sec: 45, r: 99, done: true }]
      }]
    }, 'kg')
    const repsState = { unit: 'kg', exWeights: {}, workouts: [repsWorkout] }
    const switchedState = { ...repsState, workouts: [repsWorkout, timedWorkout] }

    expect(workoutVolume(repsWorkout, 'kg')).toBe(1100)
    expect(volumeByPhase(repsWorkout, 'kg')).toEqual({ warmup: 200, work: 900 })
    expect(setsByPhase(repsWorkout, 'kg')).toEqual({ warmup: 1, work: 3 })
    expect(nextPrescription(repsState, { id: LIFT, ...repsTarget, prog: 'linear' })).toMatchObject({ kind: 'up' })
    expect(best1RM(repsState, LIFT)).toMatchObject({ est: 70, w: 60, r: 5, d: '2026-05-01' })

    expect(metricModeForEntry(timedWorkout.entries[0])).toBe('time')
    expect(workoutVolume(timedWorkout, 'kg')).toBe(0)
    expect(e1rmSeries(switchedState, LIFT)).toEqual([
      { t: 1, d: '2026-05-01', y: 70, w: 60, r: 5 }
    ])
    expect(nextPrescription(switchedState, {
      id: LIFT, mode: 'time', sets: 1, sec: 45
    }, { prog: 'time' })).toMatchObject({ policy: 'time', kind: 'up', sec: 50 })
    expect(nextPrescription(switchedState, { id: LIFT, ...repsTarget, prog: 'linear' })).toMatchObject({ kind: 'up' })
    expect(buildSets(switchedState, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0 }))
      .toEqual([{ sec: 45, w: 200, done: false }])
    expect(buildSets(switchedState, { id: LIFT, mode: 'reps', sets: 1, reps: 5, weight: 60 }))
      .toEqual([{ w: 60, r: 5, done: false }])
  })

  it('freezes configurable Greyskull AMRAP metadata and exposes the uncapped final actual', () => {
    const target = sessionConfigFor({
      phase: 'work', mode: 'reps', sets: 3, reps: 5, weight: 60,
      amrapMissPolicy: 'maintain'
    }, { policy: 'greyskull' })
    expect(target).toMatchObject({
      phase: 'work', mode: 'reps', kind: 'amrap', amrapMinReps: 5,
      amrapMissPolicy: 'maintain'
    })

    const workout = stampCompletedWorkout({
      d: '2026-05-15', start: 3,
      entries: [{
        id: LIFT,
        target,
        sets: [
          { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 5, done: true },
          { phase: 'work', mode: 'reps', w: 60, r: 12, done: true }
        ]
      }]
    }, 'kg')
    const entry = workout.entries[0]

    expect(amrapResultFor(entry)).toEqual({
      index: 3, phase: 'work', mode: 'reps', actual: 12, target: 5, amrapMinReps: 5
    })
    expect(readSession(entry, target, 'kg', 'greyskull', workout.unit)).toMatchObject({
      mode: 'reps', kind: 'amrap', goal: 5, amrap: 12, ok: true
    })
    const next = nextPrescription({ unit: 'kg', workouts: [workout] }, {
      id: LIFT, ...target, prog: 'greyskull'
    })
    expect(next).toMatchObject({ kind: 'up' })
    expect(next.why[0]).toContain('double')
  })

  it('round-trips current phase, prescription, AMRAP, and progression metadata and accepts a legacy plan', () => {
    const source = {
      unit: 'kg',
      week: { 1: 'current' },
      customEx: [],
      routines: [{
        id: 'current', name: 'Integrated', emoji: 'timer',
        phases: ['warmup', 'work'], prog: 'time', amrapMissPolicy: 'maintain',
        warmupRestSec: 0, workRestSec: 75,
        ex: [{
          id: LIFT,
          prog: 'time', inc: 5,
          target: {
            phase: 'work', mode: 'time', kind: 'amrap', sets: 2, sec: 45,
            weight: 10, prepSec: 3, restSec: 0, amrapMaxSec: 90,
            weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 10 }
          },
          warmup: [{
            target: {
              phase: 'warmup', mode: 'reps', reps: 8, weight: 20,
              weightPrescription: { kind: 'fixed', weight: 20 }
            },
            restSec: 0
          }]
        }]
      }]
    }
    const bundle = buildPlanBundle(source, 'Integrated')
    const parsed = parsePlan(JSON.stringify(bundle))
    const destination = { unit: 'kg', routines: [], customEx: [], week: {} }

    mergePlan(destination, parsed, { schedule: true })

    const routine = destination.routines[0]
    const exercise = routine.ex[0]
    expect(routine).toMatchObject({
      phases: ['warmup', 'work'], prog: 'time', amrapMissPolicy: 'maintain',
      warmupRestSec: 0, workRestSec: 75
    })
    expect(exercise).toMatchObject({
      phase: 'work', mode: 'time', kind: 'amrap', sets: 2, sec: 45,
      prepSec: 3, restSec: 0, amrapMaxSec: 90, prog: 'time', inc: 5,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 10 },
      target: { phase: 'work', mode: 'time', kind: 'amrap', sec: 45 },
      warmup: [{
        phase: 'warmup', mode: 'reps', reps: 8, restSec: 0,
        weightPrescription: { kind: 'fixed', weight: 20 }
      }]
    })
    expect(destination.week[1]).toBe(routine.id)

    const legacy = parsePlan({
      opengym_plan: 1,
      week: {}, customEx: [],
      routines: [{
        id: 'legacy', name: 'Legacy',
        ex: [{
          id: LIFT, sets: 3, reps: 5, weight: 0,
          warmupSets: 1, warmupReps: 8, warmupWeight: 0
        }]
      }]
    })
    const legacyDestination = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(legacyDestination, legacy)
    expect(legacyDestination.routines[0].ex[0]).toMatchObject({
      id: LIFT, sets: 3, reps: 5, weight: 0,
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8 }]
    })
  })
})
