import { describe, expect, it } from 'vitest'
import { classifyWorkoutExit, entriesForProgrammeExit, isProgrammeSession, partialExitBaseline, recordProgrammeSetRemoval } from './partial.js'

const entry = (id, doneRows, totalRows = 2) => ({
  id,
  sets: Array.from({ length: totalRows }, (_, index) => ({
    phase: 'work',
    mode: 'reps',
    w: 40,
    r: 5,
    done: index < doneRows
  }))
})

const workout = (...entries) => ({ entries })

describe('Programme session boundary', () => {
  it('requires a positive Programme marker and leaves classic sessions on the native path', () => {
    expect(isProgrammeSession({ sessionType: 'programme' })).toBe(true)
    expect(isProgrammeSession({ cycleId: 'cycle-1' })).toBe(true)
    expect(isProgrammeSession({ programme: false, cycle: null, programmeId: null })).toBe(false)
    expect(isProgrammeSession({ programmeSession: false, kind: 'routine' })).toBe(false)
    expect(isProgrammeSession({ routineId: 'routine-1', entries: [] })).toBe(false)
  })
})
describe('D4 partial workout exit classifier', () => {
  it('discards zero completed work sets for the no-choice default', () => {
    const active = workout(entry('push', 0), entry('pull', 0))

    expect(classifyWorkoutExit(active, 'default')).toMatchObject({
      outcome: 'discard',
      partial: false,
      owed: false,
      scheduling: 'discard',
      completedWorkSets: 0,
      prescribedWorkSets: 4
    })
    expect(classifyWorkoutExit(active, 'continue').record).toBe(false)
    expect(classifyWorkoutExit(active, 'skip')).toMatchObject({ record: false, scheduling: 'advance' })
  })

  it('uses continue-next-time as the default below thirty percent', () => {
    const result = classifyWorkoutExit(workout(entry('push', 1), entry('pull', 0)), 'default')

    expect(result).toMatchObject({
      outcome: 'partial',
      partial: true,
      owed: true,
      scheduling: 'repeat',
      completedWorkSets: 1,
      prescribedWorkSets: 4
    })
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'push', progression: 'miss' }),
      expect.objectContaining({ id: 'pull', progression: 'miss' })
    ])
  })

  it('uses finish-and-skip as the default at exactly thirty percent', () => {
    const result = classifyWorkoutExit(workout(entry('push', 3, 10), entry('pull', 0, 0)), 'default')

    expect(result).toMatchObject({
      outcome: 'partial',
      partial: true,
      owed: false,
      scheduling: 'advance',
      completedWorkSets: 3,
      prescribedWorkSets: 10
    })
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'push', progression: 'none' }),
      expect.objectContaining({ id: 'pull', progression: 'none' })
    ])
  })

  it('keeps above-thirty-percent default partials incomplete while progressing only complete exercises', () => {
    const result = classifyWorkoutExit(workout(entry('push', 2), entry('pull', 2, 3)), 'default')

    expect(result).toMatchObject({
      outcome: 'partial',
      partial: true,
      owed: false,
      scheduling: 'advance',
      completedWorkSets: 4,
      prescribedWorkSets: 5
    })
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'push', progression: 'progress' }),
      expect.objectContaining({ id: 'pull', progression: 'none' })
    ])
  })

  it('lets an explicit continue choice override the advancing default', () => {
    expect(classifyWorkoutExit(workout(entry('push', 1), entry('pull', 0)), 'continue')).toMatchObject({
      outcome: 'partial',
      partial: true,
      owed: true,
      scheduling: 'repeat'
    })
  })

  it('counts only explicit work-phase rows in the threshold denominator', () => {
    const result = classifyWorkoutExit(workout({
      id: 'mixed',
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: true },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: false }
      ]
    }), 'default')

    expect(result).toMatchObject({
      outcome: 'partial',
      completedWorkSets: 1,
      prescribedWorkSets: 2,
      owed: false,
      scheduling: 'advance'
    })
  })

  it('lets an explicit discard override a saved-work default without creating a record', () => {
    expect(classifyWorkoutExit(workout(entry('push', 1), entry('pull', 0)), 'discard')).toMatchObject({
      outcome: 'discard',
      record: false,
      partial: false,
      complete: false,
      owed: false,
      scheduling: 'discard',
      completedWorkSets: 1,
      prescribedWorkSets: 4
    })
  })

  it('keeps completed exercises eligible for progression when Continue is explicitly chosen above the default threshold', () => {
    const result = classifyWorkoutExit(workout(entry('push', 2), entry('pull', 1, 3)), 'continue')

    expect(result).toMatchObject({ outcome: 'partial', owed: true, scheduling: 'repeat' })
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'push', progression: 'progress' }),
      expect.objectContaining({ id: 'pull', progression: 'none' })
    ])
  })

  it('lets an explicit finish-and-skip choice override the owed default', () => {
    expect(classifyWorkoutExit(workout(entry('push', 1), entry('pull', 0)), 'skip')).toMatchObject({
      outcome: 'partial',
      partial: true,
      owed: false,
      scheduling: 'advance'
    })
  })

  it('uses the immutable prescribed-at-start denominator after the active rows are edited', () => {
    const active = workout(entry('push', 2, 4))
    active.partialExitBaseline = { version: 1, prescribedWorkSets: 10 }
    expect(classifyWorkoutExit(active, 'default')).toMatchObject({
      outcome: 'partial',
      completedWorkSets: 2,
      prescribedWorkSets: 10,
      thresholdMet: false,
      owed: true,
      scheduling: 'repeat'
    })
  })

  it('ignores work added after Programme start when applying the anchored default denominator', () => {
    const active = {
      partialExitBaseline: {
        version: 1,
        prescribedWorkSets: 10,
        entries: [{ id: 'push', sets: Array.from({ length: 10 }, () => ({ phase: 'work', mode: 'reps', r: 5 })) }]
      },
      entries: [
        { id: 'push', sets: [
          { phase: 'work', mode: 'reps', r: 5, done: true },
          ...Array.from({ length: 9 }, () => ({ phase: 'work', mode: 'reps', r: 5, done: false }))
        ] },
        { id: 'added-after-start', sets: Array.from({ length: 9 }, () => ({ phase: 'work', mode: 'reps', r: 5, done: true })) }
      ]
    }

    expect(classifyWorkoutExit(active, 'default')).toMatchObject({
      outcome: 'partial',
      completedWorkSets: 1,
      prescribedWorkSets: 10,
      thresholdMet: false,
      owed: true,
      scheduling: 'repeat'
    })
  })

  it('retains prescribed undone work rows when the active editor removes one', () => {
    const active = {
      partialExitBaseline: {
        version: 1,
        prescribedWorkSets: 2,
        entries: [{ id: 'push', sets: [{ phase: 'work', mode: 'reps', r: 5 }, { phase: 'work', mode: 'reps', r: 5 }] }]
      },
      entries: [{ id: 'push', sets: [
        { phase: 'warmup', mode: 'reps', r: 8 },
        { phase: 'work', mode: 'reps', r: 5, done: true }
      ] }]
    }
    const persisted = entriesForProgrammeExit(active)[0]
    expect(persisted.sets.filter(set => set.phase === 'work')).toHaveLength(2)
    expect(persisted.sets.filter(set => set.phase === 'work').at(-1)).toMatchObject({ done: false, r: 5 })
  })

  it('revises the Programme baseline for removed work rows in duplicate occurrences', () => {
    const entries = [
      entry('cooldown', 0),
      entry('cooldown', 0),
    ]
    const active = { entries, partialExitBaseline: partialExitBaseline(entries) }

    expect(recordProgrammeSetRemoval(active, 0, 1)).toBe(true)
    active.entries[0].sets.splice(1, 1)
    expect(recordProgrammeSetRemoval(active, 1, 1)).toBe(true)
    active.entries[1].sets.splice(1, 1)
    active.entries.forEach(current => { current.sets[0].done = true })

    expect(classifyWorkoutExit(active, 'default')).toMatchObject({
      outcome: 'complete',
      completedWorkSets: 2,
      prescribedWorkSets: 2,
    })
    expect(entriesForProgrammeExit(active).map(current => current.sets.filter(set => set.phase === 'work')))
      .toHaveLength(2)
    expect(entriesForProgrammeExit(active).every(current => current.sets.filter(set => set.phase === 'work').length === 1)).toBe(true)
  })

  it('does not count an added work row toward a tagged Programme baseline', () => {
    const entries = [entry('press', 0, 1)]
    const active = { entries, partialExitBaseline: partialExitBaseline(entries) }
    active.entries[0].sets.push({ phase: 'work', mode: 'reps', w: 40, r: 5, done: true })

    expect(classifyWorkoutExit(active, 'default')).toMatchObject({
      outcome: 'discard',
      completedWorkSets: 0,
      prescribedWorkSets: 1,
    })
  })

  it('leaves the Programme work baseline unchanged when a warm-up is removed', () => {
    const entries = [{
      id: 'press',
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: false },
      ]
    }]
    const active = { entries, partialExitBaseline: partialExitBaseline(entries) }

    expect(recordProgrammeSetRemoval(active, 0, 0)).toBe(false)
    expect(classifyWorkoutExit(active, 'default').prescribedWorkSets).toBe(1)
    expect(active.partialExitBaseline.removedWorkRowIds).toEqual([])
  })

  it('treats explicit Finish as complete and advancing even when sets remain', () => {
    expect(classifyWorkoutExit(workout(entry('push', 1), entry('pull', 0)), 'finish')).toMatchObject({
      outcome: 'complete',
      partial: false,
      owed: false,
      scheduling: 'advance'
    })
  })
})
