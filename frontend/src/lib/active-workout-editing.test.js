import { describe, expect, it } from 'vitest'
import {
  moveActiveGroupMember,
  reorderActiveWorkoutUnit,
  replaceOrInsertActiveExercise,
  saveActiveOrderToRoutine,
  saveActiveAmrapTargetsToRoutine,
} from './active-workout-editing.js'
import { partialExitBaseline } from './partial.js'

const entry = (id, { sg, done = false, occurrenceId, programmeRowId } = {}) => ({
  id,
  ...(sg ? { sg } : {}),
  ...(occurrenceId ? { occurrenceId } : {}),
  target: { mode: 'reps', reps: 5, weight: 40 },
  sets: [{ phase: 'work', mode: 'reps', w: 40, r: 5, done, ...(programmeRowId ? { programmeRowId } : {}) }],
})

const active = entries => ({
  id: 'active',
  cur: 1,
  entries,
  groupMeta: { pair: { kind: 'complex', label: 'Clean + press', cues: 'Stay tight.' } },
})

describe('active workout editing', () => {
  it('moves a group as a unit while preserving cursor identity, metadata, occurrences and Programme rows', () => {
    const a = active([
      entry('clean', { sg: 'pair', occurrenceId: 'clean#1', programmeRowId: 'clean#1:work:1' }),
      entry('press', { sg: 'pair', occurrenceId: 'press#1', programmeRowId: 'press#1:work:1' }),
      entry('row', { occurrenceId: 'row#1', programmeRowId: 'row#1:work:1' }),
    ])
    const selected = a.entries[1]

    expect(reorderActiveWorkoutUnit(a, 0, 2)).toBe(true)
    expect(a.entries.map(value => value.id)).toEqual(['row', 'clean', 'press'])
    expect(a.entries[1].sg).toBe('pair')
    expect(a.entries[2].sg).toBe('pair')
    expect(a.groupMeta).toEqual({ pair: { kind: 'complex', label: 'Clean + press', cues: 'Stay tight.' } })
    expect(a.cur).toBe(2)
    expect(a.entries[a.cur]).toBe(selected)
    expect(a.entries.map(value => value.occurrenceId)).toEqual(['row#1', 'clean#1', 'press#1'])
    expect(a.entries.map(value => value.sets[0].programmeRowId)).toEqual(['row#1:work:1', 'clean#1:work:1', 'press#1:work:1'])
  })

  it('reorders only adjacent members inside one group without splitting it', () => {
    const a = active([entry('clean', { sg: 'pair' }), entry('press', { sg: 'pair' }), entry('row')])
    const selected = a.entries[1]

    expect(moveActiveGroupMember(a, 1, -1)).toBe(true)
    expect(a.entries.map(value => value.id)).toEqual(['press', 'clean', 'row'])
    expect(a.entries.slice(0, 2).map(value => value.sg)).toEqual(['pair', 'pair'])
    expect(a.entries[a.cur]).toBe(selected)
    expect(moveActiveGroupMember(a, 0, -1)).toBe(false)
  })

  it('retains Programme occurrence and compatible planned row identities when replacing an unstarted entry in place', () => {
    const a = active([entry('bench', { sg: 'pair', occurrenceId: 'bench#1' }), entry('row', { sg: 'pair', occurrenceId: 'row#1' })])
    a.partialExitBaseline = partialExitBaseline(a.entries)
    a.cur = 0
    const replacement = entry('incline', { occurrenceId: 'incline#1' })

    expect(replaceOrInsertActiveExercise(a, 0, replacement)).toEqual({ inserted: false, index: 0 })
    expect(a.entries.map(value => value.id)).toEqual(['incline', 'row'])
    expect(a.entries[0].sg).toBe('pair')
    expect(a.entries[0].occurrenceId).toBe('bench#1')
    expect(a.entries[0].sets[0].programmeRowId).toBe('bench#1:work:1')
    expect(a.cur).toBe(0)
  })

  it('tombstones intentionally dropped Programme rows and leaves added replacement rows optional', () => {
    const a = active([{
      ...entry('bench', { occurrenceId: 'bench#1' }),
      sets: [
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: false }
      ]
    }])
    a.partialExitBaseline = partialExitBaseline(a.entries)
    const replacement = {
      ...entry('incline', { occurrenceId: 'incline#1' }),
      sets: [
        { phase: 'work', mode: 'reps', w: 45, r: 6, done: false },
        { phase: 'work', mode: 'reps', w: 45, r: 6, done: false },
        { phase: 'work', mode: 'reps', w: 45, r: 6, done: false }
      ]
    }

    replaceOrInsertActiveExercise(a, 0, replacement)
    expect(a.entries[0].sets.map(set => set.programmeRowId)).toEqual([
      'bench#1:work:1', 'bench#1:work:2', undefined
    ])
    expect(a.partialExitBaseline.removedWorkRowIds).toEqual([])

    replaceOrInsertActiveExercise(a, 0, { ...replacement, sets: replacement.sets.slice(0, 1) })
    expect(a.partialExitBaseline.removedWorkRowIds).toEqual(['bench#1:work:2'])
  })

  it('keeps an incompatible Programme replacement optional and tombstones each former planned row', () => {
    const a = active([{
      ...entry('bench', { occurrenceId: 'bench#1' }),
      sets: [
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: false }
      ]
    }])
    a.partialExitBaseline = partialExitBaseline(a.entries)

    replaceOrInsertActiveExercise(a, 0, {
      id: 'timed-incline', target: { mode: 'time', sets: 1, sec: 30 },
      plan: { policy: 'off', kind: 'off' },
      sets: [{ phase: 'work', mode: 'time', sec: 30, done: false }]
    })

    expect(a.entries[0]).toMatchObject({ id: 'timed-incline', occurrenceId: 'bench#1' })
    expect(a.entries[0].sets[0]).not.toHaveProperty('programmeRowId')
    expect(a.partialExitBaseline.removedWorkRowIds).toEqual(['bench#1:work:1', 'bench#1:work:2'])
  })

  it('keeps a completed grouped entry untouched and inserts an ungrouped replacement after its group by default', () => {
    const a = active([entry('clean', { sg: 'pair', done: true, occurrenceId: 'clean#1', programmeRowId: 'clean#1:work:1' }), entry('press', { sg: 'pair' }), entry('row')])
    a.partialExitBaseline = partialExitBaseline(a.entries)
    const original = a.entries[0]
    const replacement = entry('power-clean')

    expect(replaceOrInsertActiveExercise(a, 0, replacement)).toEqual({ inserted: true, index: 2 })
    expect(a.entries.map(value => value.id)).toEqual(['clean', 'press', 'power-clean', 'row'])
    expect(a.entries[0]).toBe(original)
    expect(a.entries[0].sets[0].done).toBe(true)
    expect(a.entries[0].occurrenceId).toBe('clean#1')
    expect(a.entries[0].sets[0].programmeRowId).toBe('clean#1:work:1')
    expect(a.entries[2]).not.toHaveProperty('occurrenceId')
    expect(a.entries[2].sg).toBeUndefined()
  })

  it('can insert a completed-entry replacement into a confirmed group without relabelling logged rows', () => {
    const a = active([entry('clean', { sg: 'pair', done: true }), entry('press', { sg: 'pair' })])
    const original = a.entries[0]

    expect(replaceOrInsertActiveExercise(a, 0, entry('power-clean'), { inheritGroup: true })).toEqual({ inserted: true, index: 1 })
    expect(a.entries.map(value => value.id)).toEqual(['clean', 'power-clean', 'press'])
    expect(a.entries.map(value => value.sg)).toEqual(['pair', 'pair', 'pair'])
    expect(a.entries[0]).toBe(original)
  })

  it('fails closed when active order lacks a complete stable routine occurrence map', () => {
    const routine = { id: 'r1', ex: [{ id: 'clean', sg: 'pair' }, { id: 'press', sg: 'pair' }], groupMeta: { pair: { kind: 'superset' } } }
    const a = active([entry('clean', { sg: 'pair', occurrenceId: 'clean#1' }), entry('press', { sg: 'pair', occurrenceId: 'press#1' })])

    expect(saveActiveOrderToRoutine(a, routine)).toBe(false)
    expect(routine.ex.map(value => value.id)).toEqual(['clean', 'press'])
  })

  it('saves only ordered group configuration to a mapped routine and leaves active Programme state untouched', () => {
    const routine = {
      id: 'r1',
      ex: [entry('clean', { sg: 'pair', occurrenceId: 'clean#1' }), entry('press', { sg: 'pair', occurrenceId: 'press#1' }), entry('row', { occurrenceId: 'row#1' })],
      groupMeta: { pair: { kind: 'superset' } },
    }
    const a = active([entry('row', { occurrenceId: 'row#1', programmeRowId: 'row#1:work:1' }), entry('press', { sg: 'pair', occurrenceId: 'press#1', programmeRowId: 'press#1:work:1' }), entry('clean', { sg: 'pair', occurrenceId: 'clean#1', programmeRowId: 'clean#1:work:1' })])

    expect(saveActiveOrderToRoutine(a, routine)).toBe(true)
    expect(routine.ex.map(value => value.id)).toEqual(['row', 'press', 'clean'])
    expect(routine.ex.map(value => value.sg)).toEqual([undefined, 'pair', 'pair'])
    expect(routine.groupMeta).toEqual({ pair: { kind: 'complex', label: 'Clean + press', cues: 'Stay tight.' } })
    expect(a.entries.map(value => value.sets[0].programmeRowId)).toEqual(['row#1:work:1', 'press#1:work:1', 'clean#1:work:1'])
  })
})

describe('per-row AMRAP routine persistence', () => {
  it('stores distinct targets for weighted rows by stable exercise mapping', () => {
    const routine = { id: 'routine-1', ex: [{ id: 'press' }, { id: 'row' }] }
    const active = {
      routineId: 'routine-1',
      routineEntryMap: [
        { occurrenceId: 'press#1', routineIndex: 0, id: 'press' },
        { occurrenceId: 'row#1', routineIndex: 1, id: 'row' }
      ],
      entries: [
        { id: 'press', occurrenceId: 'press#1', target: { mode: 'reps', kind: 'amrap' }, sets: [{ phase: 'work', mode: 'reps', w: 20, r: 12, amrapRole: 'amrap', amrapTarget: 12 }] },
        { id: 'row', occurrenceId: 'row#1', target: { mode: 'reps', kind: 'amrap' }, sets: [{ phase: 'work', mode: 'reps', w: 100, r: 5, amrapRole: 'progression', amrapTarget: 5 }] }
      ]
    }

    expect(saveActiveAmrapTargetsToRoutine(active, routine)).toBe(true)
    expect(routine.ex.map(entry => entry.amrapTargets)).toEqual([[12], [5]])
  })

  it('fails closed without changing the routine when the row mapping is stale', () => {
    const routine = { id: 'routine-1', ex: [{ id: 'press' }] }
    const before = JSON.stringify(routine)
    const active = {
      routineId: 'routine-1',
      routineEntryMap: [{ occurrenceId: 'wrong#1', routineIndex: 0, id: 'row' }],
      entries: [{ id: 'row', occurrenceId: 'wrong#1', sets: [] }]
    }

    expect(saveActiveAmrapTargetsToRoutine(active, routine)).toBe(false)
    expect(JSON.stringify(routine)).toBe(before)
  })
})
