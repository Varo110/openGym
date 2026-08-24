import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActiveProgrammeCard, ActiveProgrammeDetail, CompletedProgrammeRow, ReadyProgrammeRow } from '../components/ProgrammeCard.jsx'

const definition = {
  id: 'ppl', name: 'PPL Strength', emoji: 'dumbbell', progression: 'linear',
  weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{ id: 'push', sessionTemplateId: 'push', routineId: 'push', routineSnapshot: { id: 'push', name: 'Push', ex: [] } }] }] }]
}
const cycle = {
  id: 'cycle-1', programmeId: 'ppl', status: 'active', week1StartDate: '2026-02-23', timeZone: 'UTC',
  snapshot: { weeks: definition.weeks }, programmeSnapshot: definition
}

const state = { programmes: { version: 1, definitions: [definition], cycles: [cycle] }, workouts: [] }

describe('programme Plan and Stats rows', () => {
  it('shows an active card with week progress and an early-complete action', () => {
    const html = renderToStaticMarkup(<ActiveProgrammeCard state={state} cycle={cycle} now="2026-02-23T12:00:00.000Z" />)
    expect(html).toContain('data-testid="active-programme-card"')
    expect(html).toContain('PPL Strength')
    expect(html).toContain('Week 1 of 1')
    expect(html).toContain('Complete early')
    expect(html).not.toContain('role="button"')
  })

  it('keeps ready and completed rows as separate lifecycle surfaces', () => {
    const ready = renderToStaticMarkup(<ReadyProgrammeRow definition={{ ...definition, id: 'ready', name: 'Ready block' }} />)
    const completed = renderToStaticMarkup(<CompletedProgrammeRow state={state} cycle={{ ...cycle, status: 'completed', completedAt: '2026-03-02T12:00:00.000Z' }} />)
    expect(ready).toContain('data-testid="ready-programme-row"')
    expect(ready).toContain('Ready block')
    expect(completed).toContain('data-testid="completed-programme-row"')
    expect(completed).toContain('Completed')
    expect(completed).toContain('Repeat')
  })

  it('renders named exercise last-to-next targets and exposes a dedicated edit action', () => {
    const routine = { id: 'push', name: 'Push', ex: [{ id: 'bench', name: 'Bench press', mode: 'reps', weight: 60, reps: 5, prog: 'linear' }] }
    const detailCycle = { ...cycle, progression: 'linear', snapshot: { weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{ id: 'push', routineId: 'push', routineSnapshot: routine }] }] }] } }
    const html = renderToStaticMarkup(<ActiveProgrammeDetail state={{ ...state, workouts: [], programmes: { ...state.programmes, cycles: [detailCycle] } }} cycle={detailCycle} now="2026-02-23T12:00:00.000Z" onEdit={() => {}} />)
    expect(html).toContain('data-testid="programme-exercise-timeline"')
    expect(html).toContain('Bench press')
    expect(html).toContain('→')
    expect(html).toContain('Edit programme')
  })

  it('renders the view-programme surface with week pills, a collapsed next-up card, and session states', () => {
    const routine = { id: 'push', name: 'Push', ex: [{ id: 'bench', name: 'Bench press', mode: 'reps', sets: 3, weight: 60, reps: 5, prog: 'linear' }] }
    const secondRoutine = { id: 'pull', name: 'Pull', ex: [{ id: 'row', name: 'Barbell row', mode: 'reps', sets: 4, weight: 40, reps: 8, prog: 'linear' }] }
    const detailCycle = {
      ...cycle,
      lengthWeeks: 2,
      progression: 'linear',
      snapshot: { weeks: [
        { weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{ id: 'push:w1', routineId: 'push', routineSnapshot: routine }] }] },
        { weekIndex: 2, mode: 'normal', days: [{ weekday: 3, sessions: [{ id: 'pull:w2', routineId: 'pull', routineSnapshot: secondRoutine }] }] }
      ] }
    }
    const html = renderToStaticMarkup(<ActiveProgrammeDetail state={{ ...state, workouts: [], programmes: { ...state.programmes, cycles: [detailCycle] } }} cycle={detailCycle} now="2026-02-23T12:00:00.000Z" onEdit={() => {}} />)

    expect(html).toContain('data-testid="programme-week-pill-1"')
    expect(html).toContain('data-testid="programme-week-pill-2"')
    expect(html).toContain('data-testid="programme-next-up"')
    expect(html).toContain('data-testid="programme-next-toggle"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('NEXT')
    expect(html).toContain('data-testid="programme-session-row"')
    expect(html).toContain('data-testid="programme-exercise-timeline"')
    expect(html).toContain('Bench press')
    expect(html).toContain('3 sets')
  })

  it('renders member-specific rest and notes and canonicalizes malformed superset ids', () => {
    const routine = {
      id: 'mixed', name: 'Mixed', ex: [
        { id: 'orphan', name: 'Orphan', mode: 'reps', sets: 1, reps: 5, sg: 'orphan' },
        { id: 'a1', name: 'A1', mode: 'reps', sets: 1, reps: 5, sg: 'repeat', workRestSec: 60, notes: 'first note' },
        { id: 'a2', name: 'A2', mode: 'reps', sets: 1, reps: 5, sg: 'repeat', workRestSec: 120, notes: 'second note' },
        { id: 'gap', name: 'Gap', mode: 'reps', sets: 1, reps: 5 },
        { id: 'b1', name: 'B1', mode: 'reps', sets: 1, reps: 5, sg: 'repeat' },
        { id: 'b2', name: 'B2', mode: 'reps', sets: 1, reps: 5, sg: 'repeat' },
        { id: 'g1', name: 'G1', mode: 'reps', sets: 1, reps: 5, sg: 'giant' },
        { id: 'g2', name: 'G2', mode: 'reps', sets: 1, reps: 5, sg: 'giant' },
        { id: 'g3', name: 'G3', mode: 'reps', sets: 1, reps: 5, sg: 'giant' },
        { id: 'g4', name: 'G4', mode: 'reps', sets: 1, reps: 5, sg: 'giant' }
      ]
    }
    const detailCycle = {
      ...cycle,
      snapshot: { weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{ id: 'mixed', routineId: 'mixed', routineSnapshot: routine }] }] }] }
    }
    const html = renderToStaticMarkup(<ActiveProgrammeDetail
      state={{ ...state, workouts: [], programmes: { ...state.programmes, cycles: [detailCycle] } }}
      cycle={detailCycle} now="2026-02-23T12:00:00.000Z" />)

    expect((html.match(/data-testid="programme-superset-group"/g) || []).length).toBe(6)
    expect(html).toContain('Giant set')
    expect(html).toContain('rest 60 s')
    expect(html).toContain('rest 120 s')
    expect(html).toContain('first note')
    expect(html).toContain('second note')
    expect(html).toContain('Orphan')
  })
})
