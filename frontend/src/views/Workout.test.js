import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { setTableColumnsForMode, tableModesForEntry, tableModesRequirePerRowHeaders } from '../lib/workout-runtime.js'
import { normalizeState } from '../lib/state.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { emptyWorkoutMessage } from './Workout.jsx'

const source = readFileSync(new URL('./Workout.jsx', import.meta.url), 'utf8')
const sheetsSource = readFileSync(new URL('../sheets.jsx', import.meta.url), 'utf8')
const DEF = { unit: 'kg', routines: [], workouts: [], active: null, customEx: [], programmes: [], reminder: { on: false } }

function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (predicate(node)) return node
  return findElement(node.props?.children, predicate)
}

const workoutStateFixture = {
  ...DEF,
  programmes: {
    version: 1,
    definitions: [{
      id: 'programme-1',
      weeks: [
        {
          days: [
            {
              sessions: [
                { routineSnapshot: { id: 'push', ex: [{ id: 'lift', mode: 'reps', weight: 70 }] } },
              ],
            },
          ],
        },
      ],
    }],
    cycles: [{
      id: 'cycle-1',
      definitionId: 'programme-1',
      programmeId: 'programme-1',
      status: 'done',
      prog: 'linear',
      snapshot: {
        weeks: [
          {
            days: [
              {
                sessions: [
                  { routineSnapshot: { ex: [{ id: 'lift', mode: 'reps', weight: 70 }] } },
                ],
              },
            ],
          },
        ],
      },
    }],
  },
  routines: [],
  workouts: [],
  customEx: [],
  active: null,
  dayPlan: {},
  week: {},
  reminder: { on: false },
}

const testMocks = {
  nav: vi.fn(),
  state: workoutStateFixture,
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => testMocks.nav,
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: testMocks.state }),
}))

beforeEach(() => {
  testMocks.nav = vi.fn()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('Workout working-weight completion path', () => {
  it('imports the guard used by the working-weight confirmation call', () => {
    expect(source).toMatch(/import \{[^}\n]*\bshouldConfirmWorkingWeight\b[^}\n]*\} from ['"]\.\.\/lib\/workout-runtime\.js['"]/)
    expect(source).toContain('shouldConfirmWorkingWeight(e, m)')
  })

  it('routes Add Set through the phase-aware pure helper', () => {
    expect(source).toContain('addSetForEntry')
    expect(source).toContain('addSetForEntry(e)')
  })

  it('tears down both timers before final-set mutation and routes discard through the lifecycle helper', () => {
    const toggle = source.indexOf('const toggle = (idx, i) =>')
    const completionTeardown = source.indexOf('useUI.getState().stopTimers()', toggle)
    const completionMutation = source.indexOf('mutEntry(idx, e => {', toggle)
    expect(toggle).toBeGreaterThanOrEqual(0)
    expect(completionTeardown).toBeGreaterThanOrEqual(toggle)
    expect(completionTeardown).toBeLessThan(completionMutation)

    const discard = source.indexOf('onConfirm: discardWorkout', source.indexOf('Discard workout?'))
    expect(discard).toBeGreaterThanOrEqual(0)
    expect(source).toContain('discardWorkout')
  })
})

describe('Programme partial-session exit path', () => {
  it('routes only explicit Programme exits to the three-choice sheet', () => {
    expect(source).toMatch(/programmeExitSheet/)
    expect(source).toMatch(/isProgrammeSession/)
    expect(sheetsSource).toContain("t('Continue next time')")
    expect(sheetsSource).toContain("t('Finish and skip')")
    expect(source).not.toContain('saveProgrammeExit')
    expect(source).not.toContain("addEventListener('visibilitychange'")
    expect(source).not.toContain("addEventListener('pagehide'")
  })
})

describe('Programme queue start surface', () => {
  it('shows the queued head in the direct start chooser instead of silently redirecting classic buttons', () => {
    expect(source).toContain('programmeStartSurface')
    expect(source).toContain('Queued session')
    expect(source).toContain('Available after {0}')
  })

  it('does not show a programme-only queued card for a classic start head', () => {
    expect(source).toContain("const showQueuedSession = queueHead?.source === 'programme'")
    expect(source).toMatch(/showQueuedSession\s*&&\s*<div className="card"/)
    expect(source).toContain("S.routines.find(r => String(r.id) === String(queueHead?.routineId))")
  })
  it('keeps the classic direct-start chooser free of a duplicate programme queue card', async () => {
    const previous = testMocks.state.S
    testMocks.state.S = {
      ...previous,
      programmes: { version: 1, cycles: [] },
      routines: [{ id: 'push', name: 'Push', emoji: null, ex: [{ id: 'lift' }] }],
      week: { 1: 'push' }
    }
    try {
      const { StartChooser } = await import('./Workout.jsx')
      const tree = StartChooser()
      expect(textOf(tree)).not.toContain('Queued session')
    } finally {
      testMocks.state.S = previous
    }
  })
})

describe('Programme pickup chooser wiring', () => {
  it('navigates to /programme/pickup with repeat IDs and saved policy from state', async () => {
    const { StartChooser } = await import('./Workout.jsx')
    const tree = StartChooser()
    const button = findElement(tree, node => textOf(node).includes('Start / Repeat') && typeof node.props?.onClick === 'function')

    expect(button).toBeTruthy()
    button.props.onClick()

    expect(testMocks.nav).toHaveBeenCalledTimes(1)
    expect(testMocks.nav).toHaveBeenCalledWith('/programme/pickup', {
      state: {
        programmeId: 'programme-1',
        cycleId: 'cycle-1',
        mode: 'repeat',
        savedPolicy: 'linear',
      },
    })
  })
})

describe('Workout mixed-mode set headings', () => {
  it('uses the pure row-mode heading helper for mixed warm-up/work rows', () => {
    const entry = { target: { mode: 'time' }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8 },
      { phase: 'work', mode: 'time', w: 0, sec: 45 }
    ] }
    expect(tableModesForEntry(entry)).toEqual(['reps', 'time'])
    expect(tableModesRequirePerRowHeaders(entry)).toBe(true)
    expect(setTableColumnsForMode(tableModesForEntry(entry)[0], 'kg').primary.field).toBe('w')
    expect(setTableColumnsForMode(tableModesForEntry(entry)[1], 'kg').primary.field).toBe('sec')
    expect(source).toContain('tableModesRequirePerRowHeaders(entry)')
    expect(source).not.toContain('tableModesForEntry(entry).length > 1')
  })
})

describe('Workout warm-up phase controls', () => {
  it('uses divider labels and a phase settings control instead of per-row phase tags', () => {
    expect(source).toContain("t('Remove warm-up set')")
    expect(source).toContain('onRemoveWarmup')
    expect(source).toContain('onWarmupSettings')
    expect(source).toContain("t('Work')")
    expect(source).not.toContain('phase-tag')
  })
})

describe('Workout restored-active warm-up rendering contract', () => {
  it.each([
    ['legacy boolean', { phase: 'work', warmup: true }],
    ['explicit phase', { phase: 'warmup' }]
  ])('keeps a %s row in the warm-up label, grouping, and control boundary', (_label, marker) => {
    const active = normalizeState({ active: { entries: [{ id: 'lift', target: { mode: 'reps' }, sets: [
      { ...marker, mode: 'reps', w: 20, r: 8, done: false },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: false }
    ] }] } }, DEF).active
    const [warmup, work] = active.entries[0].sets

    expect(isWarmupRow(warmup)).toBe(true)
    expect(isWarmupRow(work)).toBe(false)
    expect(source).toMatch(/import \{[^}\n]*\bisWarmupRow\b[^}\n]*\bisWorkRow\b[^}\n]*\} from ['"]\.\.\/lib\/workout-model\.js['"]/)
    expect(source).toContain('entry.sets.filter(isWarmupRow)')
    expect(source).toContain("const phase = isWarmupRow(s) ? 'warmup' : 'work'")
    expect(source).toContain("const prevPhase = i > 0 ? (isWarmupRow(entry.sets[i - 1]) ? 'warmup' : 'work') : null")
    expect(source).toContain('const noWarmups = !entry.sets.some(isWarmupRow)')
    expect(source).toContain("filter(x => isWarmupRow(x) === (phase === 'warmup'))")
    expect(source).toContain('const warm = isWarmupRow(e.sets[i])')
    expect(source).toContain('const firstWork = e.sets.findIndex(isWorkRow)')
    expect(source).toContain('const workSets = e.sets.filter(isWorkRow)')
    expect(source).toContain('findLastIndex(isWarmupRow)')
  })
})

describe('Workout empty-state copy', () => {
  it('uses planned wording for a named routine with no entries', () => {
    expect(emptyWorkoutMessage('routine-1')).toContain('Planned workout')
    expect(emptyWorkoutMessage('routine-1')).not.toContain('Freestyle')
  })

  it('reserves freestyle wording for a null routine id', () => {
    expect(emptyWorkoutMessage(null)).toBe('Freestyle workout — add your first exercise.')
  })
})
