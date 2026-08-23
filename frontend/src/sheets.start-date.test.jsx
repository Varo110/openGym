import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ store: null }))

vi.mock('./store/useStore.js', async () => {
  const actual = await vi.importActual('./store/useStore.js')
  const useStore = selector => selector(mocks.store)
  useStore.getState = () => mocks.store
  return { ...actual, useStore }
})

import { DEF } from './store/useStore.js'
import { DayView, StartSessions } from './sheets.jsx'

const TODAY = '2026-07-27'
const SELECTED = '2026-07-28'
const routine = (id, name) => ({ id, name, emoji: null, ex: [] })

describe('StartSessions selected-date plans', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(TODAY + 'T12:00:00Z'))
    const routines = [routine('today', 'Today routine'), routine('selected', 'Selected-date routine')]
    mocks.store = {
      S: {
        ...JSON.parse(JSON.stringify(DEF)),
        routines,
        dayPlan: { [TODAY]: ['today'], [SELECTED]: ['selected'] },
        workouts: []
      }
    }
  })

  it('offers the routines from the date supplied by the Home week strip', () => {
    const html = renderToStaticMarkup(React.createElement(StartSessions, { close: () => {}, iso: SELECTED }))

    expect(html).toContain('Start Selected-date routine')
    expect(html).not.toContain('Start Today routine')
  })

  it('shows a settled early-finish as Resume without offering Start', () => {
    mocks.store.S.workouts = [{
      d: SELECTED, routineId: 'selected', plannedComplete: false, entries: []
    }]

    const html = renderToStaticMarkup(React.createElement(StartSessions, { close: () => {}, iso: SELECTED }))

    expect(html).toContain('Resume')
    expect(html).not.toContain('Start Selected-date routine')
  })

  it('uses the same Resume status in date details', () => {
    mocks.store.S.workouts = [{
      d: SELECTED, routineId: 'selected', plannedComplete: false, entries: []
    }]

    const html = renderToStaticMarkup(React.createElement(DayView, { close: () => {}, iso: SELECTED }))

    expect(html).toContain('Selected-date routine')
    expect(html).toContain('Resume')
    expect(html).not.toContain('Start Selected-date routine')
  })

  it('keeps StartSessions and date details settled as Done after an early-finished Repeat', () => {
    mocks.store.S.workouts = [
      { d: SELECTED, routineId: 'selected', plannedComplete: true, entries: [] },
      { d: SELECTED, routineId: 'selected', plannedComplete: false, entries: [] },
    ]

    const sessions = renderToStaticMarkup(React.createElement(StartSessions, { close: () => {}, iso: SELECTED }))
    const details = renderToStaticMarkup(React.createElement(DayView, { close: () => {}, iso: SELECTED }))

    expect(sessions).toContain('Every planned session is done today')
    expect(sessions).not.toContain('Incomplete')
    expect(sessions).not.toContain('Start Selected-date routine')
    expect(details).toContain('Done')
    expect(details).not.toContain('Incomplete')
  })

  it('shows a converted-classic completion as Done and non-startable on both date surfaces', () => {
    mocks.store.S.workouts = [{
      d: SELECTED, routineId: 'selected', plannedComplete: true, entries: [],
      programmeId: 'converted-programme', classicConversion: true
    }]

    const sessions = renderToStaticMarkup(React.createElement(StartSessions, { close: () => {}, iso: SELECTED }))
    const details = renderToStaticMarkup(React.createElement(DayView, { close: () => {}, iso: SELECTED }))

    expect(sessions).toContain('Every planned session is done today')
    expect(sessions).not.toContain('Start Selected-date routine')
    expect(details).toContain('Done')
    expect(details).not.toContain('Start Selected-date routine')
  })
})
