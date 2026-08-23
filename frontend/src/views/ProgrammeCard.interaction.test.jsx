// @vitest-environment happy-dom

import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { ActiveProgrammeDetail, ReadyProgrammeDetail } from '../components/ProgrammeCard.jsx'

const routine = {
  id: 'mixed',
  name: 'Mixed',
  ex: [
    { id: 'plain', name: 'Plain', mode: 'reps', sets: 1, reps: 5 },
    { id: 'a1', name: 'A1', mode: 'reps', sets: 1, reps: 5, sg: 'pair', workRestSec: 60, notes: 'first note' },
    { id: 'a2', name: 'A2', mode: 'reps', sets: 1, reps: 5, sg: 'pair', workRestSec: 120, notes: 'second note' }
  ]
}

const definition = {
  id: 'programme',
  name: 'Programme',
  weeks: [{ weekIndex: 1, mode: 'normal', days: [{ weekday: 1, sessions: [{
    id: 'mixed-session', routineId: routine.id, routineSnapshot: routine
  }] }] }]
}

const cycle = {
  id: 'cycle', programmeId: definition.id, status: 'active', week1StartDate: '2026-02-23', timeZone: 'UTC',
  snapshot: { weeks: definition.weeks }, programmeSnapshot: definition
}

const state = { programmes: { version: 1, definitions: [definition], cycles: [cycle] }, workouts: [] }

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root
let host

function mount(view) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(view))
}

function keydown(element, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => element.dispatchEvent(event))
  return event
}

afterEach(() => {
  if (root) act(() => root.unmount())
  root = null
  host?.remove()
  host = null
})

describe('programme exercise rows', () => {
  it('activates plain and superset members with Enter and Space', () => {
    const onExercise = vi.fn()
    mount(<ActiveProgrammeDetail state={state} cycle={cycle} now="2026-02-23T12:00:00.000Z" onExercise={onExercise} />)

    const plain = host.querySelector('.prog-exercise-row:not(.prog-ssg-row)')
    const member = host.querySelector('.prog-ssg-row')
    expect(plain).toBeTruthy()
    expect(member).toBeTruthy()

    keydown(plain, 'Enter')
    const space = keydown(member, ' ')

    expect(space.defaultPrevented).toBe(true)
    expect(onExercise).toHaveBeenCalledTimes(2)
    expect(onExercise.mock.calls.map(call => call[1])).toEqual(['plain', 'a1'])
    expect(onExercise.mock.calls.map(call => call.slice(2))).toEqual([[0, 0], [1, 0]])
  })

  it('shows each ready superset member rest and note', () => {
    mount(<ReadyProgrammeDetail definition={definition} />)
    const session = host.querySelector('.prog-session-toggle')
    act(() => session.click())

    expect(host.textContent).toContain('rest 60 s')
    expect(host.textContent).toContain('rest 120 s')
    expect(host.textContent).toContain('first note')
    expect(host.textContent).toContain('second note')
  })
})
