// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sheetMocks = vi.hoisted(() => ({
  exConfigSheet: vi.fn(),
  exercisePicker: vi.fn(),
  glyphPicker: vi.fn(),
  confirmSheet: vi.fn(),
  groupMetaSheet: vi.fn((routineId, groupId) => ({
    save: changes => useStore.getState().update(state => {
      const routine = state.routines.find(candidate => candidate.id === routineId)
      if (!routine) return
      routine.groupMeta = routine.groupMeta || {}
      routine.groupMeta[groupId] = { ...routine.groupMeta[groupId], ...changes }
    }),
  })),
}))

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => sheetMocks)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit, { ROUTINE_LONG_PRESS_MS, reorderRoutineUnit } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const configured = (id, sg) => ({
  id,
  mode: 'reps',
  sets: 3,
  reps: 5,
  weight: 0,
  ...(sg ? { sg } : {}),
})

let root
let host

function routineState(entries, groupMeta = null) {
  const state = clone(DEF)
  state.routines = [{
    id: 'drag-routine',
    name: 'Drag routine',
    emoji: 'dumbbell',
    prog: 'linear',
    ex: entries,
    ...(groupMeta ? { groupMeta: clone(groupMeta) } : {}),
  }]
  return state
}

function mountRoutine(entries, groupMeta = null) {
  useStore.setState({ S: routineState(entries, groupMeta), user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(
    <MemoryRouter initialEntries={['/plan/r/drag-routine']}>
      <Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes>
    </MemoryRouter>,
  ))
  return installGeometry()
}

function rect(top, height, left = 20, width = 340) {
  return { x: left, y: top, left, right: left + width, top, bottom: top + height, width, height }
}

function rows() {
  return [...host.querySelectorAll('[data-routine-row]')]
}

function installGeometry(heights = rows().map((_, index) => [68, 92, 76, 108][index % 4])) {
  const list = host.querySelector('.routine-list')
  const rowNodes = rows()
  const tops = []
  const bottoms = []
  const centers = []
  let top = 100
  rowNodes.forEach((row, index) => {
    const height = heights[index] ?? 72
    tops.push(top)
    bottoms.push(top + height)
    centers.push(top + height / 2)
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(tops[index], height))
    top += height + 14
  })
  const listRect = rect(80, Math.max(40, top - 80))
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => listRect)
  return { list, tops, bottoms, centers, listRect }
}

function touchPoint(x, y) {
  return { identifier: 7, clientX: x, clientY: y }
}

function dispatchTouch(target, type, x, y) {
  const point = touchPoint(x, y)
  const event = new Event(type, { bubbles: true, cancelable: true })
  const ended = type === 'touchend' || type === 'touchcancel'
  Object.defineProperty(event, 'touches', { configurable: true, value: ended ? [] : [point] })
  Object.defineProperty(event, 'changedTouches', { configurable: true, value: [point] })
  act(() => target.dispatchEvent(event))
  return event
}

function lift(row, x, y) {
  dispatchTouch(row.querySelector('.item'), 'touchstart', x, y)
  act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
}

function exerciseIds() {
  return useStore.getState().S.routines[0].ex.map(exercise => exercise.id)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(Date.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  localStorage.clear()
  sheetMocks.exConfigSheet.mockReset()
  sheetMocks.exercisePicker.mockReset()
  sheetMocks.glyphPicker.mockReset()
  sheetMocks.confirmSheet.mockReset()
  sheetMocks.groupMetaSheet.mockClear()
  root = null
  host = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  vi.clearAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('routine long-press reorder', () => {
  it('keeps a short press as a normal row tap', () => {
    const layout = mountRoutine([configured('1001'), configured('1002')])
    const item = rows()[0].querySelector('.item')

    dispatchTouch(item, 'touchstart', 120, layout.centers[0])
    act(() => vi.advanceTimersByTime(120))
    dispatchTouch(item, 'touchend', 120, layout.centers[0])
    act(() => item.click())

    expect(sheetMocks.exConfigSheet).toHaveBeenCalledTimes(1)
    expect(exerciseIds()).toEqual(['1001', '1002'])
  })

  it('leaves pre-lift vertical scrolling unclaimed and cancels the pending hold past the slop', () => {
    const layout = mountRoutine([configured('1001'), configured('1002')])
    const item = rows()[0].querySelector('.item')

    dispatchTouch(item, 'touchstart', 120, layout.centers[0])
    const move = dispatchTouch(item, 'touchmove', 120, layout.centers[0] + 12)
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))

    expect(move.defaultPrevented).toBe(false)
    expect(rows()[0].classList.contains('is-dragging')).toBe(false)
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeNull()
  })

  it('lifts only after the hold, follows the finger, shows an indicator, and cancels without a click', () => {
    const layout = mountRoutine([configured('1001'), configured('1002'), configured('1003')])
    const row = rows()[1]
    const item = row.querySelector('.item')

    dispatchTouch(item, 'touchstart', 120, layout.centers[1])
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS - 1))
    expect(row.classList.contains('is-dragging')).toBe(false)
    act(() => vi.advanceTimersByTime(1))

    expect(row.classList.contains('is-dragging')).toBe(true)
    expect(row.style.transform).toBe('translate3d(0, 0px, 0)')
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeTruthy()

    const move = dispatchTouch(item, 'touchmove', 120, layout.centers[2])
    expect(move.defaultPrevented).toBe(true)
    expect(row.style.transform).not.toBe('translate3d(0, 0px, 0)')

    dispatchTouch(item, 'touchcancel', 120, layout.centers[2])
    expect(exerciseIds()).toEqual(['1001', '1002', '1003'])
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeNull()
    expect(row.classList.contains('is-dragging')).toBe(false)
    act(() => item.click())
    expect(sheetMocks.exConfigSheet).not.toHaveBeenCalled()
  })

  it('reorders down and back up using the measured row positions', () => {
    let layout = mountRoutine([configured('1001'), configured('1002'), configured('1003'), configured('1004')])
    let row = rows()[0]

    lift(row, 120, layout.centers[0])
    dispatchTouch(row.querySelector('.item'), 'touchmove', 120, layout.centers[2] + 2)
    dispatchTouch(row.querySelector('.item'), 'touchend', 120, layout.centers[2] + 2)
    expect(exerciseIds()).toEqual(['1002', '1003', '1001', '1004'])

    layout = { ...layout, centers: [...layout.centers] }
    row = rows()[2]
    lift(row, 120, layout.centers[2])
    dispatchTouch(row.querySelector('.item'), 'touchmove', 120, layout.tops[0] + 2)
    dispatchTouch(row.querySelector('.item'), 'touchend', 120, layout.tops[0] + 2)
    expect(exerciseIds()).toEqual(['1001', '1002', '1003', '1004'])
  })

  it('moves a dragged superset as one unit and preserves its group id', () => {
    const layout = mountRoutine([
      configured('1001', 'pair'),
      configured('1002', 'pair'),
      configured('1003'),
      configured('1004'),
    ])
    const secondMember = rows()[1]
    const dropY = layout.listRect.bottom - 2

    lift(secondMember, 120, layout.centers[1])
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    expect(rows()[1].classList.contains('is-dragging')).toBe(true)
    dispatchTouch(secondMember.querySelector('.item'), 'touchmove', 120, dropY)
    dispatchTouch(secondMember.querySelector('.item'), 'touchend', 120, dropY)

    const exercises = useStore.getState().S.routines[0].ex
    expect(exercises.map(exercise => exercise.id)).toEqual(['1003', '1004', '1001', '1002'])
    expect(exercises.slice(2).map(exercise => exercise.sg)).toEqual(['pair', 'pair'])
  })

  it('preserves group cues when RoutineEdit reorders their linked group', () => {
    const groupMeta = { pair: { kind: 'complex', label: 'Clean + press', cues: 'Do not rack between movements.' } }
    const layout = mountRoutine([
      configured('1001', 'pair'), configured('1002', 'pair'), configured('1003'), configured('1004'),
    ], groupMeta)
    const member = rows()[1]

    lift(member, 120, layout.centers[1])
    dispatchTouch(member.querySelector('.item'), 'touchmove', 120, layout.listRect.bottom - 2)
    dispatchTouch(member.querySelector('.item'), 'touchend', 120, layout.listRect.bottom - 2)

    const routine = useStore.getState().S.routines[0]
    expect(routine.ex.slice(2).map(exercise => exercise.sg)).toEqual(['pair', 'pair'])
    expect(routine.groupMeta).toEqual(groupMeta)
  })

  it('opens the linked group editor and preserves its metadata when it saves', () => {
    mountRoutine([
      configured('1001', 'pair'), configured('1002', 'pair'), configured('1003'),
    ], { pair: { kind: 'complex', label: 'Clean + press', cues: 'Do not rack between movements.' } })

    const groupLabel = [...host.querySelectorAll('.ss-label')].find(label => label.textContent.includes('Clean + press'))
    expect(groupLabel).toBeTruthy()
    act(() => groupLabel.click())

    expect(sheetMocks.groupMetaSheet).toHaveBeenCalledWith('drag-routine', 'pair')
    const editor = sheetMocks.groupMetaSheet.mock.results[0].value
    act(() => editor.save({ label: 'Power clean + press', cues: 'Keep the bar close.' }))

    expect(useStore.getState().S.routines[0].groupMeta).toEqual({
      pair: { kind: 'complex', label: 'Power clean + press', cues: 'Keep the bar close.' },
    })
  })

  it('cleans group metadata when RoutineEdit splits its last linked pair', () => {
    mountRoutine([
      configured('1001', 'pair'), configured('1002', 'pair'), configured('1003'),
    ], { pair: { kind: 'complex', cues: 'Stay linked.' } })

    act(() => rows()[1].querySelector('button[title="Superset with exercise above"]').click())

    const routine = useStore.getState().S.routines[0]
    expect(routine.ex.every(exercise => exercise.sg == null)).toBe(true)
    expect(routine.groupMeta).toBeUndefined()
  })

  it('cleans orphan metadata during a RoutineEdit move without disturbing a real group', () => {
    mountRoutine([
      configured('1001', 'pair'), configured('1002', 'pair'), configured('1003', 'orphan'), configured('1004'),
    ], {
      pair: { kind: 'superset', cues: 'Keep this pair.' },
      orphan: { kind: 'complex', cues: 'Remove this stale group.' }
    })

    act(() => rows()[3].querySelector('button[aria-label="Move up"]').click())

    const routine = useStore.getState().S.routines[0]
    expect(routine.ex.some(exercise => exercise.sg === 'orphan')).toBe(false)
    expect(routine.groupMeta).toEqual({ pair: { kind: 'superset', cues: 'Keep this pair.' } })
  })

  it('clamps a drop between superset members to the boundary before the whole unit', () => {
    mountRoutine([
      configured('1001'),
      configured('1002', 'pair'),
      configured('1003', 'pair'),
      configured('1004'),
    ])
    // Equal member heights put the canonical unit midpoint exactly in the gap between its rows.
    const equalLayout = installGeometry([70, 80, 80, 70])
    const tail = rows()[3]
    const betweenMembers = (equalLayout.bottoms[1] + equalLayout.tops[2]) / 2

    lift(tail, 120, equalLayout.centers[3])
    dispatchTouch(tail.querySelector('.item'), 'touchmove', 120, betweenMembers)
    const indicator = host.querySelector('[data-testid="routine-drop-indicator"]')
    expect(indicator).toBeTruthy()
    dispatchTouch(tail.querySelector('.item'), 'touchend', 120, betweenMembers)

    const exercises = useStore.getState().S.routines[0].ex
    expect(exercises.map(exercise => exercise.id)).toEqual(['1001', '1004', '1002', '1003'])
    expect(exercises.slice(2).map(exercise => exercise.sg)).toEqual(['pair', 'pair'])
  })

  it('cancels a release outside the list and Escape during a mouse drag', () => {
    const layout = mountRoutine([configured('1001'), configured('1002'), configured('1003')])
    let row = rows()[0]

    lift(row, 120, layout.centers[0])
    dispatchTouch(row.querySelector('.item'), 'touchmove', 120, layout.listRect.bottom + 40)
    dispatchTouch(row.querySelector('.item'), 'touchend', 120, layout.listRect.bottom + 40)
    expect(exerciseIds()).toEqual(['1001', '1002', '1003'])

    row = rows()[1]
    act(() => row.querySelector('.item').dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: 120, clientY: layout.centers[1],
    })))
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(row.classList.contains('is-dragging')).toBe(true)
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))

    expect(exerciseIds()).toEqual(['1001', '1002', '1003'])
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeNull()
  })

  it('auto-scrolls the nearest scroll container while held near its bottom edge', () => {
    const layout = mountRoutine([
      configured('1001'), configured('1002'), configured('1003'),
      configured('1004'), configured('1005'), configured('1006'),
    ])
    host.style.overflowY = 'auto'
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 360 })
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 900 })
    host.scrollTop = 100
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => rect(0, 360))
    const row = rows()[2]

    lift(row, 120, layout.centers[2])
    act(() => vi.advanceTimersByTime(16))

    expect(host.scrollTop).toBeGreaterThan(100)
    dispatchTouch(row.querySelector('.item'), 'touchcancel', 120, layout.centers[2])
  })
})

describe('reorderRoutineUnit', () => {
  it('drops only at canonical unit slots and cleans orphaned superset ids', () => {
    const exercises = [
      configured('1001', 'pair'), configured('1002', 'pair'),
      configured('1003', 'orphan'), configured('1004'),
    ]

    expect(reorderRoutineUnit(exercises, 3, 1)).toBe(true)
    expect(exercises.map(exercise => exercise.id)).toEqual(['1001', '1002', '1004', '1003'])
    expect(exercises[0].sg).toBe('pair')
    expect(exercises[1].sg).toBe('pair')
    expect(exercises[3].sg).toBeUndefined()
  })
})
