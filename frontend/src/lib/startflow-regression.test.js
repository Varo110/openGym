import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

// Real modules, no mocks: drive the actual startFlow like the user's tap does.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setNav } from './nav.js'
import { EXDB, isBodyweightEq } from './exercises.js'
import { programmeStartSurface } from './programmes.js'
import { bindUI } from '../components/ui.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

const LIFT = EXDB.find(exercise => exercise.bp !== 'cardio' && !isBodyweightEq(exercise.id)).id
const CARDIO = EXDB.find(exercise => exercise.bp === 'cardio').id

const routine = { id: 'push', name: 'Push', emoji: null, prog: 'linear', ex: [{ id: 'lift', sets: 3 }] }

function baseState(over = {}) {
  const today = '2026-08-11' // Tuesday
  return {
    unit: 'kg', bodyweight: [], routines: [routine],
    week: { 2: 'push' }, dayPlan: { [today]: ['push'] },
    workouts: [], active: null,
    programmes: null,
    ...over
  }
}

function queueState(kind) {
  const iso = '2026-08-11'
  const classic = { id: 'classic', name: 'Classic', emoji: null, ex: [{ id: 'lift', sets: 3 }] }
  const programmeRoutine = { id: 'programme-routine', name: 'Programme', emoji: null, ex: [{ id: 'lift', sets: 2 }] }
  const selected = {
    id: 'historical-workout', d: '2026-08-10', unit: 'kg',
    entries: [{ id: LIFT, target: { mode: 'reps', sets: 1, reps: 8, weight: 100 }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 100, r: 8, done: true }] }]
  }
  const conflictingTimed = {
    id: 'conflicting-timed-workout', d: '2026-08-10', unit: 'kg',
    entries: [{ id: LIFT, target: { mode: 'time', sets: 1, sec: 120, weight: 125 }, sets: [{ phase: 'work', mode: 'time', unit: 'kg', w: 125, sec: 120, done: true }] }]
  }
  const conflictingCardio = {
    id: 'conflicting-cardio-workout', d: '2026-08-10', unit: 'kg',
    entries: [{ id: CARDIO, target: { mode: 'cardio', sets: 1, min: 30, speed: 12 }, sets: [{ phase: 'work', mode: 'cardio', min: 30, speed: 12, done: true }] }]
  }
  const state = baseState({
    routines: [classic, programmeRoutine],
    week: {},
    dayPlan: { [iso]: ['classic'] },
    classicSessions: [{
      instanceId: 'classic:' + iso,
      nominalDate: iso,
      projectedDate: iso,
      routineId: 'classic',
      routineSnapshot: classic
    }],
    workouts: [selected, conflictingTimed, conflictingCardio],
    exWeights: { [LIFT]: { w: 125, unit: 'kg', d: '2026-08-10' }, [CARDIO]: { w: 90, unit: 'kg', d: '2026-08-10' } }
  })
  if (kind === 'programme') {
    state.programmes = {
      version: 1,
      cycles: [{
        id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-08-01T00:00:00Z',
        timeZone: 'UTC', week1StartDate: '2026-08-10',
        snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 2, sessions: [{
          id: 'programme-session', routineId: programmeRoutine.id, routineSnapshot: programmeRoutine
        }] }] }] }
      }]
    }
  }
  return state
}

function partialProgrammeQueueState({ multiple = false } = {}) {
  const state = queueState('programme')
  const partial = {
    id: 'programme-partial', d: '2026-08-11', start: 111, end: 222,
    routineId: 'programme-routine', name: 'Programme', bw: 71, unit: 'kg',
    sessionType: 'programme', kind: 'programme', programmeSession: true,
    programmeId: 'programme-1', cycleId: 'cycle-1', instanceId: 'pi:cycle-1:programme-session',
    sessionId: 'programme-session', timeZone: 'UTC', complete: false, partial: true,
    owed: true, schedule: 'repeat',
    programmeStep: { weekIndex: 1, weekday: 2, ordinal: 1, nominalDate: '2026-08-11', projectedDate: '2026-08-11' },
    entries: [{
      id: LIFT, occurrenceId: `${LIFT}#1`,
      target: { mode: 'reps', sets: 2, reps: 5, weight: 57, prog: 'greyskull', unit: 'kg' },
      plan: { policy: 'greyskull', kind: 'progress', progressionSetIndex: 0 },
      sets: [
        { phase: 'work', mode: 'reps', unit: 'kg', w: 57, r: 9, done: true, amrapRole: 'progression' },
        { phase: 'work', mode: 'reps', unit: 'kg', w: 57, r: 5, done: false, amrapRole: 'none' }
      ]
    }]
  }
  state.workouts.push(partial)
  const older = multiple ? {
    ...JSON.parse(JSON.stringify(partial)),
    id: 'programme-partial-older', start: 101, end: 151,
    entries: partial.entries.map(entry => ({
      ...JSON.parse(JSON.stringify(entry)),
      sets: entry.sets.map((set, index) => ({ ...set, r: index === 0 ? 6 : set.r }))
    }))
  } : null
  // Imported/synced history may be stored newest-first. The projector orders by
  // record time, while a reverse-array lookup would incorrectly choose `older`.
  if (older) state.workouts.push(older)
  return { state, partial, older }
}

let dom
let root
let overlayRoot
let container
let overlayContainer

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div><div id="overlay"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  globalThis.localStorage = storage
  dom.localStorage = storage
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'MouseEvent', 'Blob']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  overlayContainer = document.getElementById('overlay')
  root = createRoot(container)
  overlayRoot = createRoot(overlayContainer)
  bindUI(useUI)
}

async function unmountOverlay() {
  if (overlayRoot) await act(async () => { overlayRoot.render(null) })
}

async function mountLatestSheetInOverlay() {
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  const close = () => {
    useUI.getState().closeSheet(sheet.id)
    void unmountOverlay()
  }
  const view = sheet.render(close)
  await act(async () => { overlayRoot.render(view) })
  return { sheet, view }
}

async function unmount() {
  if (root) await act(async () => { root.unmount() })
  if (overlayRoot) await act(async () => { overlayRoot.unmount() })
  root = null
  overlayRoot = null
  container = null
  overlayContainer = null
  dom = null
}
async function clickExplicitFreestyle(Component, state) {
  useStore.setState({ S: state })
  installDom()
  await act(async () => { root.render(React.createElement(Component, { close: () => {} })) })
  const button = [...container.querySelectorAll('button')]
    .find(candidate => candidate.textContent.includes('Freestyle workout'))
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })

  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toMatchObject({ locked: false })
  const view = sheet.render(() => {})
  useUI.getState().closeSheet(sheet.id)
  await act(async () => { view.props.onDone(null) })
  return useStore.getState().S.active
}

async function mountStartSurface(Component, state) {
  useStore.setState({ S: state })
  installDom()
  await act(async () => { root.render(React.createElement(Component, { close: () => {} })) })
}

function findTextElement(parent, selector, text) {
  return [...parent.querySelectorAll(selector)].find(element => element.textContent.includes(text))
}

async function clickMainButton(text) {
  const button = findTextElement(container, 'button', text)
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

function expectIgnoredPartial(actual, expected) {
  expect(actual).toMatchObject({
    id: expected.id, start: expected.start, end: expected.end, partial: true
  })
  expect(actual.entries[0].sets[0]).toMatchObject({ r: 6 })
}

async function clickMainRow(text) {
  const row = findTextElement(container, '.lrow', text)
  expect(row).toBeTruthy()
  await act(async () => { row.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

async function clickOverlayButton(text) {
  const button = findTextElement(overlayContainer, 'button', text)
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  await unmountOverlay()
}

async function mountLatestSheetInMain() {
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  const close = () => useUI.getState().closeSheet(sheet.id)
  const view = sheet.render(close)
  await act(async () => { root.render(view) })
  return { sheet, view }
}

async function addExerciseThroughRealSheets(Workout, ex, configure = async () => {}) {
  await act(async () => { root.render(React.createElement(Workout)) })
  await clickMainButton('Add exercise')
  const pickerSheet = useUI.getState().sheets.at(-1)
  const pickerView = pickerSheet.render(() => {})
  act(() => { useUI.getState().closeSheet(pickerSheet.id) })
  await act(async () => { pickerView.props.onPick(ex) })
  await mountLatestSheetInMain()
  await configure()
  await clickMainButton('Add to routine')
}

function weightHistory(unit, globalUnit, sessionWeight, selected = false) {
  const selectedWorkout = {
    id: selected ? 'selected-repeat' : 'global-reps', d: '2026-08-10', unit,
    entries: [{
      id: LIFT, occurrenceId: `${LIFT}#1`, unit,
      target: { mode: 'reps', sets: 1, reps: 5, weight: sessionWeight, prog: 'off', unit },
      sets: [{ phase: 'work', mode: 'reps', unit, w: sessionWeight, r: 5, done: true }]
    }]
  }
  const newer = {
    id: 'newer-global', d: '2026-08-11', unit,
    entries: [{
      id: LIFT, occurrenceId: `${LIFT}#1`, unit,
      target: { mode: 'reps', sets: 1, reps: 5, weight: 125, prog: 'off', unit },
      sets: [{ phase: 'work', mode: 'reps', unit, w: 125, r: 5, done: true }]
    }]
  }
  return {
    selectedWorkout,
    state: baseState({
      unit,
      workouts: [selectedWorkout, newer],
      exWeights: { [LIFT]: { w: 125, unit: globalUnit, d: '2026-08-11' } }
    })
  }
}

async function startWeightSession(kind, unit, globalUnit, sessionWeight) {
  const { beginWorkout, startFreestyleFlow } = await import('../sheets.jsx')
  const { selectedWorkout, state } = weightHistory(unit, globalUnit, sessionWeight, kind === 'selected')
  useStore.setState({ S: state })
  installDom()

  if (kind === 'fresh') {
    startFreestyleFlow()
    const sheet = useUI.getState().sheets.at(-1)
    const view = sheet.render(() => {})
    useUI.getState().closeSheet(sheet.id)
    await act(async () => { view.props.onDone(null) })
    const { default: Workout } = await import('../views/Workout.jsx')
    await addExerciseThroughRealSheets(Workout, EXDB.find(exercise => exercise.id === LIFT))
  } else {
    beginWorkout(null, null, null, {
      name: 'Selected repeat', unit, selectedWorkout,
      ex: [{ ...selectedWorkout.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selectedWorkout.entries[0] }]
    })
  }

  act(() => {
    useStore.setState(({ S }) => ({
      S: {
        ...S,
        active: {
          ...S.active,
          entries: S.active.entries.map(entry => ({
            ...entry,
            sets: entry.sets.map(set => ({ ...set, phase: 'work', mode: 'reps', unit, w: sessionWeight, r: 5, done: true }))
          }))
        }
      }
    }))
  })
  return { selectedWorkout, active: useStore.getState().S.active }
}

async function commitTopWeightPopup() {
  const { topWeightSheet } = await import('../sheets.jsx')
  topWeightSheet(0)
  await mountLatestSheetInOverlay()
  const display = overlayContainer.querySelector('.bw-read')
  const displayedValue = display?.textContent.replace(/\s+/g, ' ').trim()
  const save = [...overlayContainer.querySelectorAll('button')]
    .find(button => button.textContent.trim() === 'Save')
  expect(save).toBeTruthy()
  await act(async () => { save.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  return displayedValue
}

vi.setConfig({ testTimeout: 15_000 })

describe('startFlow explicit-start regression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'))
    setNav(() => {})
    useUI.setState({ stack: [], sheets: [] })
  })

  afterEach(async () => {
    await unmount()
    useUI.getState().closeAll()
    useStore.setState({ S: baseState() })
    setNav(() => {})
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns true (opens weight sheet) for a plain classic start with no programmes', async () => {
    const { startFlow } = await import('../sheets.jsx')
    useStore.setState({ S: baseState() })
    expect(() => startFlow('push')).not.toThrow()
  })

  it('starts the tapped routine even when a programme queue head for another session exists', async () => {
    const { startFlow } = await import('../sheets.jsx')
    useStore.setState({ S: baseState({
      programmes: {
        version: 1,
        cycles: [{
          id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-07-27T00:00:00Z',
          timeZone: 'UTC', week1StartDate: '2026-07-27',
          snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 1, sessions: [{ id: 's1', routineId: 'push', routineSnapshot: routine }] }] }] }
        }]
      }
    }) })
    expect(() => startFlow('push')).not.toThrow()
  })

  it('starts an eligible programme head (never bypassed) when tapping any classic routine', async () => {
    const { startFlow } = await import('../sheets.jsx')
    const other = { id: 'legs', name: 'Legs', emoji: null, prog: 'linear', ex: [{ id: 'squat', sets: 3 }] }
    useStore.setState({ S: baseState({
      routines: [routine, other],
      programmes: {
        version: 1,
        cycles: [{
          id: 'cycle-1', programmeId: 'programme-1', status: 'active', createdAt: '2026-07-20T00:00:00Z',
          timeZone: 'UTC', week1StartDate: '2026-07-20',
          snapshot: { weeks: [{ weekIndex: 1, days: [{ weekday: 2, sessions: [{ id: 's1', routineId: 'push', routineSnapshot: routine }] }] }] }
        }]
      }
    }) })
    expect(() => startFlow('legs')).not.toThrow()
  })

  it.each([
    ['classic queue head', 'classic'],
    ['programme queue head', 'programme']
  ])('real StartChooser Freestyle action creates a blank session despite an eligible %s', async (_label, kind) => {
    const state = queueState(kind)
    const surface = programmeStartSurface(state, { now: Date.now(), timeZone: 'UTC' })
    expect(surface.front).toMatchObject({ source: kind })
    expect(surface.eligible).toHaveLength(1)

    const { StartChooser } = await import('../views/Workout.jsx')
    const active = await clickExplicitFreestyle(StartChooser, state)

    expect(active).toMatchObject({ routineId: null, historyPolicy: { kind: 'fresh-freestyle' } })
    expect(active.entries).toEqual([])
  })

  it.each([
    ['classic queue head', 'classic'],
    ['programme queue head', 'programme']
  ])('real StartSessions Freestyle action creates a blank session despite an eligible %s', async (_label, kind) => {
    const state = queueState(kind)
    const surface = programmeStartSurface(state, { now: Date.now(), timeZone: 'UTC' })
    expect(surface.front).toMatchObject({ source: kind })
    expect(surface.eligible).toHaveLength(1)

    const { StartSessions } = await import('../sheets.jsx')
    const active = await clickExplicitFreestyle(StartSessions, state)

    expect(active).toMatchObject({ routineId: null, historyPolicy: { kind: 'fresh-freestyle' } })
    expect(active.entries).toEqual([])
  })

  it.each([
    ['StartChooser', async () => (await import('../views/Workout.jsx')).StartChooser],
    ['StartSessions', async () => (await import('../sheets.jsx')).StartSessions]
  ])('real %s resumes the exact Programme queue record and preserves its lifecycle', async (_label, loadComponent) => {
    const { finishWorkout, resumeWeeklySession, saveProgrammeExit, discardWorkout } = await import('../sheets.jsx')
    const first = partialProgrammeQueueState({ multiple: true })
    const projected = programmeStartSurface(first.state, { now: Date.now(), timeZone: 'UTC' }).front
    expect(projected).toMatchObject({ recordId: first.partial.id, latestRecord: { id: first.partial.id } })
    await mountStartSurface(await loadComponent(), first.state)
    const persisted = JSON.parse(JSON.stringify(useStore.getState().S.workouts.find(workout => workout.id === first.partial.id)))
    const ignored = JSON.parse(JSON.stringify(useStore.getState().S.workouts.find(workout => workout.id === first.older.id)))
    const historyBefore = JSON.parse(JSON.stringify(useStore.getState().S.workouts))

    expect(container.textContent).toContain('Resume')
    expect(container.textContent).not.toContain('Start Programme')
    await clickMainButton('Resume')

    const active = useStore.getState().S.active
    expect(active).toMatchObject({
      id: persisted.id, d: persisted.d, start: persisted.start,
      sourceWorkoutId: persisted.id, instanceId: persisted.instanceId
    })
    expect(active.entries).toMatchObject(persisted.entries)
    expect(active.entries[0].sets[0].amrapRole).toBe('progression')
    expect(useStore.getState().S.workouts).toHaveLength(historyBefore.length)
    expect(useStore.getState().S.workouts.filter(workout => workout.id === persisted.id)).toHaveLength(1)
    expect(useStore.getState().S.workouts.find(workout => workout.id === persisted.id)).toMatchObject(persisted)
    expectIgnoredPartial(useStore.getState().S.workouts.find(workout => workout.id === ignored.id), ignored)

    act(() => {
      useStore.setState(({ S }) => ({
        S: { ...S, active: { ...S.active, entries: S.active.entries.map(entry => ({
          ...entry, sets: entry.sets.map(set => ({ ...set, done: true }))
        })) } }
      }))
    })
    act(() => { finishWorkout() })
    expect(useStore.getState().S.workouts).toHaveLength(historyBefore.length)
    const completed = useStore.getState().S.workouts.find(workout => workout.id === persisted.id)
    expect(completed).toMatchObject({ id: persisted.id, complete: true })
    expect(completed).not.toHaveProperty('partial')
    expectIgnoredPartial(useStore.getState().S.workouts.find(workout => workout.id === ignored.id), ignored)

    const second = partialProgrammeQueueState({ multiple: true })
    const secondProjected = programmeStartSurface(second.state, { now: Date.now(), timeZone: 'UTC' }).front
    const session = {
      source: 'programme', routineId: secondProjected.routineId,
      instanceId: secondProjected.instanceId, calendarDate: secondProjected.nominalDate,
      status: secondProjected.status, recordId: secondProjected.recordId,
      latestRecord: secondProjected.latestRecord
    }
    const secondIgnored = JSON.parse(JSON.stringify(second.older))
    let resumed
    let ended
    act(() => {
      useStore.setState({ S: second.state })
      resumed = resumeWeeklySession(session)
      ended = saveProgrammeExit('continue')
    })
    expect(resumed).toBe(true)
    expect(ended).toBe(true)
    expect(useStore.getState().S.workouts).toHaveLength(second.state.workouts.length)
    expect(useStore.getState().S.workouts.find(workout => workout.id === second.partial.id)).toMatchObject({ partial: true })
    expectIgnoredPartial(useStore.getState().S.workouts.find(workout => workout.id === second.older.id), secondIgnored)

    let discarded
    act(() => {
      resumed = resumeWeeklySession(session)
      discarded = discardWorkout()
    })
    expect(resumed).toBe(true)
    expect(discarded).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(second.state.workouts.length - 1)
    expect(useStore.getState().S.workouts.some(workout => workout.id === second.partial.id)).toBe(false)
    expectIgnoredPartial(useStore.getState().S.workouts.find(workout => workout.id === second.older.id), secondIgnored)
  })

  it('fails safely when an exact projected Programme record is stale or no longer resumable', async () => {
    const { resumeWeeklySession } = await import('../sheets.jsx')
    const fixture = partialProgrammeQueueState({ multiple: true })
    const projected = programmeStartSurface(fixture.state, { now: Date.now(), timeZone: 'UTC' }).front
    const session = {
      source: 'programme', routineId: projected.routineId,
      instanceId: projected.instanceId, calendarDate: projected.nominalDate,
      status: projected.status, recordId: projected.recordId,
      latestRecord: projected.latestRecord
    }

    useStore.setState({ S: fixture.state })
    expect(resumeWeeklySession({ ...session, recordId: 'missing-record' })).toBe(false)
    expect(useStore.getState().S.active).toBeNull()

    useStore.setState(({ S }) => ({
      S: {
        ...S,
        workouts: S.workouts.map(workout => workout.id === fixture.partial.id
          ? Object.fromEntries(Object.entries(workout).filter(([key]) => !['complete', 'partial', 'plannedComplete'].includes(key)))
          : workout)
      }
    }))
    expect(resumeWeeklySession(session)).toBe(false)
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts.find(workout => workout.id === fixture.older.id)).toEqual(fixture.older)
  })

  it.each([
    ['StartChooser', async () => (await import('../views/Workout.jsx')).StartChooser],
    ['StartSessions', async () => (await import('../sheets.jsx')).StartSessions]
  ])('real %s keeps a true-new Programme queue head on Start', async (_label, loadComponent) => {
    await mountStartSurface(await loadComponent(), queueState('programme'))

    expect(container.textContent).toContain('Start Programme')
    expect(container.textContent).not.toContain('Resume')
    await clickMainButton('Start Programme')

    expect(useStore.getState().S.active).toBeNull()
    expect(useUI.getState().sheets.at(-1)).toMatchObject({ locked: false })
  })

  it('real fresh freestyle config and phase editors ignore populated global history', async () => {
    const state = queueState('classic')
    const { StartChooser, default: Workout } = await import('../views/Workout.jsx')
    const active = await clickExplicitFreestyle(StartChooser, state)
    expect(active.entries).toEqual([])

    await addExerciseThroughRealSheets(Workout, EXDB.find(exercise => exercise.id === LIFT), async () => {
      const sets = findTextElement(container, '.stp-w', 'Sets')?.querySelector('input')
      const reps = findTextElement(container, '.stp-w', 'Reps')?.querySelector('input')
      const weight = findTextElement(container, '.stp-w', 'Weight')?.querySelector('input')
      expect(sets?.value).toBe('3')
      expect(reps?.value).toBe('10')
      expect(weight?.value).toBe('0')
      await clickMainButton('Add warm-up set')
    })
    await addExerciseThroughRealSheets(Workout, EXDB.find(exercise => exercise.id === LIFT), async () => {
      await clickMainButton('Time')
    })
    await addExerciseThroughRealSheets(Workout, EXDB.find(exercise => exercise.id === CARDIO))

    let fresh = useStore.getState().S.active
    const [repsEntry, timedEntry, cardioEntry] = fresh.entries
    expect(repsEntry.target).toMatchObject({ mode: 'reps', sets: 3, reps: 10, weight: 0 })
    expect(repsEntry.sets.filter(set => set.phase === 'work')).toHaveLength(3)
    expect(repsEntry.sets.every(set => set.w === 0)).toBe(true)
    expect(timedEntry.target).toMatchObject({ mode: 'time', sets: 3, sec: 45, weight: 0 })
    expect(timedEntry.sets.every(set => set.mode === 'time' && set.sec === 45 && set.w === 0)).toBe(true)
    expect(cardioEntry.target).toMatchObject({ sets: 1, min: 20, speed: 8 })
    expect(cardioEntry.sets.every(set => set.min === 20 && set.speed === 8)).toBe(true)

    act(() => { useStore.setState(({ S }) => ({ S: { ...S, active: { ...S.active, cur: 0 } } })) })
    await act(async () => { root.render(React.createElement(Workout)) })
    const liveAddWarmup = findTextElement(container, 'button', 'Add warm-up set')
    expect(liveAddWarmup).toBeTruthy()
    await act(async () => { liveAddWarmup.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    fresh = useStore.getState().S.active
    expect(fresh.entries[0].sets.filter(set => set.phase === 'warmup')).toHaveLength(2)
    expect(fresh.entries[0].sets.find(set => set.phase === 'warmup')).toMatchObject({ w: 0, done: false })

    const workSettings = container.querySelector('[aria-label="Work settings"]')
    expect(workSettings).toBeTruthy()
    await act(async () => { workSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainRow('Work load')
    await mountLatestSheetInOverlay()
    await clickOverlayButton('% of e1RM')
    await clickMainButton('Save')

    fresh = useStore.getState().S.active
    expect(fresh.entries[0].target.weightPrescription).toMatchObject({ kind: 'percentage', percent: 50, fallbackWeight: 0 })
    expect(fresh.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 0)).toBe(true)

    await act(async () => { root.render(React.createElement(Workout)) })
    const warmupSettings = container.querySelector('[aria-label="Warm-up settings"]')
    expect(warmupSettings).toBeTruthy()
    await act(async () => { warmupSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainRow('Warm-up load')
    await mountLatestSheetInOverlay()
    await clickOverlayButton('% of e1RM')
    await clickMainButton('Save')

    fresh = useStore.getState().S.active
    expect(fresh.entries[0].target.warmup[0].weightPrescription)
      .toMatchObject({ kind: 'percentage', percent: 50, fallbackWeight: 0 })
    expect(fresh.entries[0].sets.filter(set => set.phase === 'warmup').every(set => set.w === 0)).toBe(true)
  })

  it('real fresh Freestyle theoretical warm-ups use a separate global reps reference in all callbacks', async () => {
    const state = queueState('classic')
    state.workouts = [{
      id: 'theoretical-reference', d: '2026-08-10', unit: 'kg',
      entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps', sets: 1, reps: 3, weight: 80, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }] }]
    }]
    state.exWeights = {}
    const { StartChooser, default: Workout } = await import('../views/Workout.jsx')
    await clickExplicitFreestyle(StartChooser, state)

    await addExerciseThroughRealSheets(Workout, EXDB.find(exercise => exercise.id === LIFT), async () => {
      await clickMainButton('Add warm-up set')
      await clickMainRow('Warm-up load')
      await mountLatestSheetInOverlay()
      await clickOverlayButton('% of e1RM')
    })

    let active = useStore.getState().S.active
    let entry = active.entries[0]
    expect(entry.target.weight).toBe(85)
    expect(entry.target.warmup[0].weightPrescription).toMatchObject({ kind: 'percentage', percent: 50 })
    expect(entry.sets.filter(set => set.phase === 'warmup')).toHaveLength(1)
    expect(entry.sets.filter(set => set.phase === 'warmup')[0]).toMatchObject({ w: 45, done: false })
    expect(entry.sets.filter(set => set.phase === 'work').every(set => set.w === 85)).toBe(true)

    await act(async () => { root.render(React.createElement(Workout)) })
    await clickMainButton('Add warm-up set')
    active = useStore.getState().S.active
    entry = active.entries[0]
    expect(entry.sets.filter(set => set.phase === 'warmup')).toHaveLength(2)
    expect(entry.sets.filter(set => set.phase === 'warmup').every(set => set.w === 45)).toBe(true)

    const completedWarmup = entry.sets.find(set => set.phase === 'warmup')
    const workRows = entry.sets.filter(set => set.phase === 'work')
    act(() => {
      useStore.setState(({ S }) => ({
        S: {
          ...S,
          active: {
            ...S.active,
            entries: S.active.entries.map((candidate, index) => index === 0
              ? { ...candidate, sets: candidate.sets.map(set => set === completedWarmup ? { ...set, done: true } : set) }
              : candidate)
          }
        }
      }))
    })
    await act(async () => { root.render(React.createElement(Workout)) })
    const warmupSettings = container.querySelector('[aria-label="Warm-up settings"]')
    expect(warmupSettings).toBeTruthy()
    await act(async () => { warmupSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainButton('Save')

    active = useStore.getState().S.active
    entry = active.entries[0]
    expect(entry.sets.filter(set => set.phase === 'warmup').every(set => set.w === 45)).toBe(true)
    expect(entry.sets.find(set => set.phase === 'warmup').done).toBe(true)
    expect(entry.sets.filter(set => set.phase === 'work')).toEqual(workRows)
  })

  it('real Work settings serialization preserves a frozen percentage on a reps-only edit', async () => {
    const frozen = {
      id: LIFT, target: {
        mode: 'reps', sets: 2, reps: 5, weight: 45, resolvedWeight: 45,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 }
      },
      sets: [
        { phase: 'work', mode: 'reps', w: 45, r: 5, done: false },
        { phase: 'work', mode: 'reps', w: 45, r: 5, done: false }
      ]
    }
    const state = baseState({ workouts: [], active: {
      id: 'frozen-percentage', routineId: null, historyPolicy: { kind: 'fresh-freestyle' },
      unit: 'kg', cur: 0, entries: [frozen]
    } })
    const { default: Workout } = await import('../views/Workout.jsx')
    useStore.setState({ S: state })
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })

    const workSettings = container.querySelector('[aria-label="Work settings"]')
    expect(workSettings).toBeTruthy()
    await act(async () => { workSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    const repsStepper = findTextElement(container, '.stp-w', 'Reps')
    expect(repsStepper).toBeTruthy()
    await act(async () => { repsStepper.querySelector('[aria-label="Increase"]')
      .dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await clickMainButton('Save')

    let active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ weight: 45, resolvedWeight: 45,
      weightPrescription: { kind: 'percentage', percent: 50 } })
    expect(active.entries[0].sets.map(set => ({ w: set.w, r: set.r }))).toEqual([
      { w: 45, r: 6 }, { w: 45, r: 6 }
    ])

    await act(async () => { root.render(React.createElement(Workout)) })
    const changedWorkSettings = container.querySelector('[aria-label="Work settings"]')
    await act(async () => { changedWorkSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    const percentStepper = findTextElement(container, '.stp-w', 'Percent')
    expect(percentStepper).toBeTruthy()
    await act(async () => { percentStepper.querySelector('[aria-label="Increase"]')
      .dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await clickMainButton('Save')

    active = useStore.getState().S.active
    expect(active.entries[0].target.weight).toBe(0)
    expect(active.entries[0].target.resolvedWeight).toBe(0)
    expect(active.entries[0].sets.every(set => set.w === 0)).toBe(true)
  })

  it('real timed Work percentage save uses reps history and the configured fallback', async () => {
    const reference = {
      id: 'timed-reference', d: '2026-08-10', unit: 'kg',
      entries: [{ id: LIFT, unit: 'kg', target: { mode: 'reps', reps: 3, weight: 80, unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 80, r: 3, done: true }] }]
    }
    const entry = {
      id: LIFT, target: { mode: 'time', sets: 1, sec: 45, weight: 0 },
      sets: [{ phase: 'work', mode: 'time', sec: 45, w: 0, done: false }]
    }
    const state = baseState({ workouts: [reference], active: {
      id: 'timed-percentage', routineId: null, historyPolicy: { kind: 'fresh-freestyle' },
      unit: 'kg', cur: 0, entries: [entry]
    } })
    const { default: Workout } = await import('../views/Workout.jsx')
    useStore.setState({ S: state })
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })

    const workSettings = container.querySelector('[aria-label="Work settings"]')
    await act(async () => { workSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainRow('Work load')
    await mountLatestSheetInOverlay()
    await clickOverlayButton('% of e1RM')
    await clickMainButton('Save')

    let active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ mode: 'time', weight: 45, resolvedWeight: 45,
      weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 0 } })
    expect(active.entries[0].sets[0]).toMatchObject({ mode: 'time', sec: 45, w: 45 })

    const fallbackEntry = {
      id: LIFT,
      target: { mode: 'time', sets: 1, sec: 45, weight: 20, resolvedWeight: 20,
        weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 20 } },
      sets: [{ phase: 'work', mode: 'time', sec: 45, w: 20, done: false }]
    }
    act(() => useStore.setState(({ S }) => ({
      S: { ...S, workouts: [], active: { ...S.active, entries: [fallbackEntry] } }
    })))
    await act(async () => { root.render(React.createElement(Workout)) })
    const fallbackSettings = container.querySelector('[aria-label="Work settings"]')
    await act(async () => { fallbackSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainButton('Save')

    active = useStore.getState().S.active
    expect(active.entries[0].target).toMatchObject({ weight: 20, resolvedWeight: 20,
      weightPrescription: { kind: 'percentage', fallbackWeight: 20 } })
    expect(active.entries[0].sets[0].w).toBe(20)
  })

  it('keeps ExerciseBlock Last/Best scoped for fresh and selected Repeat sessions', async () => {
    const state = queueState('classic')
    const { StartChooser, default: Workout } = await import('../views/Workout.jsx')
    await clickExplicitFreestyle(StartChooser, state)
    await addExerciseThroughRealSheets(Workout, EXDB.find(exercise => exercise.id === LIFT))

    let rendered = container.textContent
    expect(rendered).not.toContain('Last time')
    expect(rendered).not.toMatch(/Best:\s*125/)

    const selectedWorkout = {
      id: 'selected-repeat-ui', d: '2026-08-10', unit: 'kg',
      entries: [{
        id: LIFT, occurrenceId: `${LIFT}#1`, unit: 'kg',
        target: { mode: 'reps', sets: 1, reps: 5, weight: 60, prog: 'off', unit: 'kg' },
        sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 60, r: 5, done: true }]
      }]
    }
    const { beginWorkout } = await import('../sheets.jsx')
    act(() => {
      useStore.setState({
        S: baseState({
          workouts: [selectedWorkout, {
            id: 'newer-repeat-ui', d: '2026-08-11', unit: 'kg',
            entries: [{ id: LIFT, target: { mode: 'reps', sets: 1, reps: 5, weight: 125, prog: 'off', unit: 'kg' }, sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: 125, r: 5, done: true }] }]
          }],
          exWeights: { [LIFT]: { w: 125, unit: 'kg', d: '2026-08-11' } }
        })
      })
    })
    act(() => {
      beginWorkout(null, null, null, {
        name: 'Selected repeat', unit: 'kg', selectedWorkout,
        ex: [{ ...selectedWorkout.entries[0].target, id: LIFT, occurrenceId: `${LIFT}#1`, selectedEntry: selectedWorkout.entries[0] }]
      })
    })
    await act(async () => { root.render(React.createElement(Workout)) })

    rendered = container.textContent
    expect(rendered).toContain('Last performance')
    expect(rendered).toContain('Best: 60')
    expect(rendered).not.toContain('Best: 125')
  })

  it('keeps selected Repeat Work and Warm-up editors on the selected source, not newer global history', async () => {
    await startWeightSession('selected', 'kg', 'kg', 60)
    const { default: Workout } = await import('../views/Workout.jsx')
    await act(async () => { root.render(React.createElement(Workout)) })
    await clickMainButton('Add warm-up set')

    const workSettings = container.querySelector('[aria-label="Work settings"]')
    expect(workSettings).toBeTruthy()
    await act(async () => { workSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainRow('Work load')
    await mountLatestSheetInOverlay()
    await clickOverlayButton('% of e1RM')
    await clickMainButton('Save')

    let active = useStore.getState().S.active
    expect(active.entries[0].sets.filter(set => set.phase === 'work').every(set => set.w === 60)).toBe(true)

    await act(async () => { root.render(React.createElement(Workout)) })
    const warmupSettings = container.querySelector('[aria-label="Warm-up settings"]')
    expect(warmupSettings).toBeTruthy()
    await act(async () => { warmupSettings.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await mountLatestSheetInMain()
    await clickMainRow('Warm-up load')
    await mountLatestSheetInOverlay()
    await clickOverlayButton('% of e1RM')
    await clickMainButton('Save')

    active = useStore.getState().S.active
    const warmupRows = active.entries[0].sets.filter(set => set.phase === 'warmup')
    expect(warmupRows.every(set => set.w > 0 && set.w < 125)).toBe(true)
  })

  it.each([
    ['fresh popup compatible', 'fresh', 'popup', 'kg', 'kg', 50, 125, 'kg'],
    ['selected popup compatible', 'selected', 'popup', 'kg', 'kg', 60, 125, 'kg'],
    ['fresh auto compatible', 'fresh', 'auto', 'kg', 'kg', 50, 125, 'kg'],
    ['selected auto compatible', 'selected', 'auto', 'kg', 'kg', 60, 125, 'kg'],
    ['fresh popup incompatible', 'fresh', 'popup', 'lb', 'kg', 50, 50, 'lb'],
    ['selected popup incompatible', 'selected', 'popup', 'lb', 'kg', 60, 60, 'lb'],
    ['fresh auto incompatible', 'fresh', 'auto', 'lb', 'kg', 50, 50, 'lb'],
    ['selected auto incompatible', 'selected', 'auto', 'lb', 'kg', 60, 60, 'lb']
  ])('keeps scoped TopWeight active value and globally merges the compatible cache (%s)', async (_label, kind, path, unit, globalUnit, sessionWeight, expectedWeight, expectedUnit) => {
    await startWeightSession(kind, unit, globalUnit, sessionWeight)
    let popupValue
    if (path === 'popup') popupValue = await commitTopWeightPopup()
    else {
      const { autoConfirmTopWeight } = await import('../sheets.jsx')
      await act(async () => { autoConfirmTopWeight(0) })
    }

    const state = useStore.getState().S
    expect(popupValue).toEqual(path === 'popup' ? expect.stringContaining(String(sessionWeight)) : undefined)
    if (path === 'popup') expect(popupValue).not.toContain('125')
    expect(state.active.entries[0].topW).toBe(sessionWeight)
    expect(state.exWeights[LIFT]).toMatchObject({ w: expectedWeight, unit: expectedUnit })
  })
})
