import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ExerciseDetail, StartSessions, reconcileStartSessionChoice, routineDraftFromWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { EXDB } from './lib/exercises.js'

const source = readFileSync(new URL('./sheets.jsx', import.meta.url), 'utf8')

describe('CSV unknown-unit import warning UI contract', () => {
  it('does not claim unknown-unit weights are imported unchanged', () => {
    expect(source).not.toContain('numbers are imported as they are')
    expect(source).toContain('unknownWeightRows')
    expect(source).toContain('{0} weighted rows omitted because their unit is unknown.')
  })

  it('uses the explicit count warning when every workout row was rejected', () => {
    expect(source).toMatch(/unknownWeightRows\s*>\s*0[\s\S]*Nothing to import from that file/)
  })

  it('shows the same unknown-unit warning for body-weight previews and all-rejected imports', () => {
    const summary = source.slice(source.indexOf('function ImportSummary'), source.indexOf('/** Read a CSV/XML export'))
    const reader = source.slice(source.indexOf('export function importFromApp'))
    expect(summary).toContain('unknownWeightWarning(parsed)')
    expect(summary).not.toContain('!isBW && unknownWeightWarning(parsed)')
    expect(reader).toMatch(/parsed\.kind === 'bodyweight' \? !parsed\.bodyweight\.length[\s\S]*unknownWeightWarning\(parsed\)/)
  })
})

describe('plan-unit localization UI contract', () => {
  it('renders plan-share unit failures through the translation-aware formatter', () => {
    expect(source).toContain('planErrorMessage')
    expect(source).toContain('unitError = planErrorMessage(e)')
    expect(source).not.toContain('unitError = e.message')
    expect(source).toContain("t('Import failed: {0}', planErrorMessage(e))")
  })
})

describe('completion-time 1RM unit contract', () => {
  it('stamps a completion clone before the is1RMRecord call', () => {
    const start = source.indexOf('A.entries.forEach(e => {')
    const end = source.indexOf('const w = stampCompletedWorkout({', start)
    const detection = source.slice(start, end)
    expect(detection.indexOf('stampCompletedWorkout')).toBeGreaterThanOrEqual(0)
    expect(detection.indexOf('stampCompletedWorkout')).toBeLessThan(detection.indexOf('is1RMRecord'))
    expect(detection).toContain('entries: [e]')
  })
})

describe('workout load-state row-mode contract', () => {
  it('uses completed work-phase reps rows, not timed rows, for TopWeight max selection', () => {
    const topWeight = source.slice(source.indexOf('function TopWeight'), source.indexOf('// Shown when the last exercise'))
    expect(topWeight).toContain("workRowsForMode(entry, 'reps')")
    expect(topWeight).toMatch(/workRowsForMode\(entry, 'reps'\)[\s\S]*?filter\(s => s\.done\)/)
  })

  it('uses the same reps-row filter for finish PRs and exWeights cache writes', () => {
    const finish = source.slice(source.indexOf('function doFinishWorkout()'))
    expect(finish).toContain("workRowsForMode(e, 'reps')")
    expect(finish).toMatch(/workRowsForMode\(e, 'reps'\)[\s\S]*?filter\(s => s\.done\)/)
    expect(finish).toContain('repsWorkRows.length > 0')
  })

  it('does not let a stale topW widen the current strength cache for mixed work modes', () => {
    const finish = source.slice(source.indexOf('function doFinishWorkout()'))
    const cache = finish.slice(finish.indexOf('update(s => {'))
    expect(cache).toContain("const repsWorkRows = workRowsForMode(e, 'reps').filter(s => s.done)")
    expect(cache).not.toContain('e.topW || 0')
  })
})

describe('exercise notes editing contract', () => {
  it('renders the Notes control in the full routine exercise editor', () => {
    const editor = source.slice(source.indexOf('function ExConfig'), source.indexOf('export const exConfigSheet'))
    expect(editor).toContain('htmlFor="ex-note"')
    expect(editor).toContain("t('Notes')")
  })

  it('includes edited or cleared notes in both full and in-session save payloads', () => {
    const config = source.slice(source.indexOf('const common = {'), source.indexOf('if (cardio) onSave', source.indexOf('const common = {')))
    const workSave = source.slice(source.indexOf("if (phaseOnly === 'work')"), source.indexOf('if (phaseOnly)'))
    expect(config).toContain('notes: c.notes || undefined')
    expect(workSave).toContain('notes: c.notes || undefined')
  })
})

describe('built-in exercise description rendering', () => {
  it('renders the exact overhead-press note in military press details', () => {
    const exercise = EXDB.find(ex => ex.id === '1457')
    const html = renderToStaticMarkup(React.createElement(ExerciseDetail, { ex: exercise, close: () => {} }))
    expect(html).toContain('<div class="exnote">Also known as Overhead Press.</div>')
  })
})

describe('workout finish timer teardown contract', () => {
  it('stops both timers before building or persisting the completed workout', () => {
    const finish = source.indexOf('function doFinishWorkout()')
    const mutation = source.indexOf('update(s => {', finish)
    expect(finish).toBeGreaterThanOrEqual(0)
    expect(source.slice(finish, mutation)).toContain('useUI.getState().stopTimers()')
    expect(source.slice(finish, mutation)).not.toContain('useUI.getState().stopWork()')
    expect(source.slice(mutation)).toContain('useUI.getState().stopRest()')
  })
})

describe('Programme calendar provenance contract', () => {
  it('writes a nested stable instance marker and write-time timezone context only for Programme history', () => {
    expect(source).toContain('programmeInstanceMarker(active)')
    expect(source).toContain('programmeInstance: marker')
    expect(source).toContain('...scheduleWriteContext({ now: endedAt, timeZone: active.timeZone })')
    expect(source).toContain('const writeContext = programme ? scheduleWriteContext({ now: endedAt, timeZone: A.timeZone }) : {}')
    expect(source).toContain('...(programme ? writeContext : {})')
  })
})

describe('warm-up load phase settings contract', () => {
  it('offers fixed, theoretical-1RM, and work-set percentage load modes', () => {
    expect(source).toContain("kind: 'workset_percent'")
    expect(source).toContain("value: 'workset'")
    expect(source).toContain("t('% of work-set')")
  })

  it('exports a session warm-up settings sheet using the planner editor', () => {
    expect(source).toContain('warmupConfigSheet')
    expect(source).toContain('phaseOnly')
  })
})

describe('day override weekly-plan handoff', () => {
  it('closes the date override before opening the weekly-plan picker', () => {
    const override = source.slice(source.indexOf('function DayOverride'), source.indexOf('function DayAssign'))
    expect(override).toMatch(/onClick=\{\(\) => \{\s*close\(\)\s*;?\s*dayAssignSheet\(wd\)\s*;?\s*\}\}/)
  })
})

describe('StartSessions planned selection', () => {
  const ISO = '2026-07-27'
  const routine = (id, name = id) => ({ id, name, emoji: null, ex: [] })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(ISO + 'T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
  })

  it.each([
    ['one open plan', [routine('a')], [], null, 'a'],
    ['mixed plans after the chosen one is completed', [routine('a'), routine('b')], ['a'], 'a', 'b'],
    ['all plans completed', [routine('a'), routine('b'), routine('c')], ['a', 'b', 'c'], 'b', null]
  ])('reconciles %s without retaining a completed id', (_label, plans, done, chosen, expected) => {
    expect(reconcileStartSessionChoice(plans, new Set(done), chosen)).toBe(expected)
  })

  it('renders the all-completed state without a planned Start CTA', () => {
    const plans = [routine('a', 'Routine A'), routine('b', 'Routine B')]
    useStore.setState({ S: {
      ...JSON.parse(JSON.stringify(DEF)),
      routines: plans,
      dayPlan: { [ISO]: plans.map(r => r.id) },
      workouts: plans.map(r => ({ d: ISO, routineId: r.id, entries: [] }))
    } })
    const html = renderToStaticMarkup(React.createElement(StartSessions, { close: () => {} }))
    expect(html).toContain('Every planned session is done today')
    expect(html).not.toContain('Start Routine A')
    expect(html).not.toContain('Start Routine B')
  })
})

describe('queue source display contract', () => {
  it('does not render the programme-only queued card for a classic slot', () => {
    expect(source).toContain("const showQueuedSession = queueHead?.source === 'programme'")
    expect(source).toMatch(/showQueuedSession\s*&&\s*<div className="card"/)
  })

  it('resolves queued routine metadata from the classic routine collection', () => {
    expect(source).toContain("S.routines.find(r => String(r.id) === String(queueHead?.routineId))")
  })
})

describe('Freestyle history routine draft contract', () => {
  it('builds a draft routine from logged entries without changing the workout record', () => {
    const workout = {
      id: 'w-1', name: 'Freestyle', routineId: null,
      entries: [
        { id: 'bench', n: 'Bench press', target: { mode: 'reps', sets: 2, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: true }] },
        { id: 'plank', n: 'Plank', target: { mode: 'time', sets: 1, sec: 30 }, sets: [{ sec: 30, done: true }] }
      ]
    }
    const before = JSON.stringify(workout)
    const draft = routineDraftFromWorkout(workout)
    expect(draft).toMatchObject({ name: 'Freestyle', draft: true })
    expect(draft.ex).toEqual([
      { id: 'bench', mode: 'reps', sets: 2, reps: 8, weight: 60 },
      { id: 'plank', mode: 'time', sets: 1, sec: 30 }
    ])
    expect(JSON.stringify(workout)).toBe(before)
  })

  it('keeps the workout detail sheet as the entry point and exposes an explicit edit action', () => {
    expect(source).toContain("t('Edit as routine')")
    expect(source).toContain("nav('/plan/r/' + draft.id)")
    expect(source).not.toContain("onClick={() => nav('/plan/r/'")
  })

  it('opens freestyle calendar history in workout details, not the routine editor', () => {
    expect(source).toContain("? () => (close(), workoutDetailSheet(b.workout))")
    expect(source).not.toContain('openFreestyleDraft')
  })
})
