import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  locationState: {},
  save: vi.fn(),
  useState: vi.fn(initial => [typeof initial === 'function' ? initial() : initial, vi.fn()]),
  S: { unit: 'kg', workouts: [] },
}))

vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return { ...actual, useState: mocks.useState }
})
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: mocks.locationState }) }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('../lib/i18n.js', () => ({ t: value => value }))
vi.mock('./Icon.jsx', () => ({ default: () => React.createElement('span') }))
vi.mock('./ui.jsx', () => ({
  Button: ({ children, ...props }) => React.createElement('button', props, children),
  NumberField: ({ decimal: _decimal, ...props }) => React.createElement('input', props),
}))

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  const children = node.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return findElement(children, predicate)
}

describe('ProgrammePickupSheet versioned programme route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useState.mockImplementation(initial => [typeof initial === 'function' ? initial() : initial, vi.fn()])
    mocks.S = { unit: 'kg', workouts: [], programmes: { version: 1, definitions: [], cycles: [] } }
  })

  it('extracts rows from the versioned programme cycle and preselects that cycle policy', async () => {
    const cycle = {
      id: 'cycle-1', programmeId: 'programme-1', status: 'done',
      prog: 'linear',
      snapshot: { weeks: [{ days: [{ sessions: [{ routineSnapshot: { ex: [
        { id: 'lift', n: 'Press', mode: 'reps', weight: 60, bp: 'chest' },
        { id: 'row', n: 'Row', mode: 'reps', weight: 40, bp: 'back' },
      ] } }] }] }] },
    }
    mocks.S.programmes = { version: 1, definitions: [{ id: 'programme-1', weeks: cycle.snapshot.weeks }], cycles: [cycle] }
    mocks.locationState = { programmeId: 'programme-1', cycleId: 'cycle-1', mode: 'repeat' }

    const { default: ProgrammePickupSheet } = await import('./ProgrammePickupSheet.jsx')
    const tree = ProgrammePickupSheet({ onSave: mocks.save })
    const html = renderToStaticMarkup(tree)

    expect(html).toContain('Press')
    expect(html).toContain('Row')
    expect(html).toContain('class="opt on"')
    expect(html).toContain('Linear')
    expect(html).toContain('style="width:52px;text-align:center"')
  })

  it('sends start/repeat, mode, percent, policy, and row values to the persistence callback', async () => {
    const cycle = {
      id: 'cycle-1', programmeId: 'programme-1', status: 'done',
      snapshot: { weeks: [{ days: [{ sessions: [{ routine: { ex: [{ id: 'lift', n: 'Press', mode: 'reps', weight: 60, bp: 'chest' }] } }] }] }] },
    }
    mocks.S.programmes = { version: 1, definitions: [{ id: 'programme-1', weeks: cycle.snapshot.weeks }], cycles: [cycle] }
    mocks.locationState = { programmeId: 'programme-1', cycleId: 'cycle-1', mode: 'repeat', policy: 'double' }

    const { default: ProgrammePickupSheet } = await import('./ProgrammePickupSheet.jsx')
    const tree = ProgrammePickupSheet({ onSave: mocks.save })
    const continueButton = findElement(tree, node => node.props?.children === 'Continue')
    expect(continueButton).toBeTruthy()

    continueButton.props.onClick()

    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      type: 'programme-pickup', mode: 'repeat', loadMode: 'max', startMode: 'highest', percent: 100, deloadPercent: 0,
      policy: 'double', programmeId: 'programme-1', cycleId: 'cycle-1', unit: 'kg',
    })
    expect(mocks.save.mock.calls[0][0].rows[0]).toMatchObject({ id: 'lift', value: 60 })
  })

  it('fails closed when the reserved route does not provide a persistence callback', async () => {
    const cycle = {
      id: 'cycle-1', programmeId: 'programme-1', status: 'done',
      snapshot: { weeks: [{ days: [{ sessions: [{ routine: { ex: [{ id: 'lift', n: 'Press', mode: 'reps', weight: 60, bp: 'chest' }] } }] }] }] },
    }
    mocks.S.programmes = { version: 1, definitions: [{ id: 'programme-1', weeks: cycle.snapshot.weeks }], cycles: [cycle] }
    mocks.locationState = { programmeId: 'programme-1', cycleId: 'cycle-1', mode: 'repeat' }

    const { default: ProgrammePickupSheet } = await import('./ProgrammePickupSheet.jsx')
    const tree = ProgrammePickupSheet()
    const continueButton = findElement(tree, node => node.props?.children === 'Continue')

    expect(continueButton.props.onClick()).toBe(false)
  })

  it('disables Continue when a matching active cycle exists for the requested programme', async () => {
    const definition = {
      id: 'programme-1',
      weeks: [{ days: [{ sessions: [{ routineSnapshot: { ex: [{ id: 'lift', n: 'Press', mode: 'reps', weight: 60, bp: 'chest' }] } }] }] }],
    }
    mocks.S.programmes = {
      version: 1,
      definitions: [definition],
      cycles: [
        { id: 'cycle-1', definitionId: 'programme-1', status: 'done', snapshot: { weeks: definition.weeks } },
        { id: 'cycle-2', definitionId: 'programme-1', status: 'active', snapshot: { weeks: definition.weeks } },
      ],
    }
    mocks.locationState = {
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      mode: 'repeat',
      savedPolicy: 'linear',
    }

    const { default: ProgrammePickupSheet } = await import('./ProgrammePickupSheet.jsx')
    const tree = ProgrammePickupSheet({ onSave: mocks.save })
    const continueButton = findElement(tree, node => node.props?.children === 'Continue')

    expect(continueButton.props.disabled).toBe(true)
  })

  it('disables Continue when explicit route identifiers point to a different programme definition', async () => {
    const definition = {
      id: 'programme-1',
      weeks: [{ days: [{ sessions: [{ routineSnapshot: { ex: [{ id: 'lift', n: 'Press', mode: 'reps', weight: 60, bp: 'chest' }] } }] }] }],
    }
    const foreign = {
      id: 'programme-2',
      weeks: [{ days: [{ sessions: [{ routineSnapshot: { ex: [{ id: 'squat', n: 'Squat', mode: 'reps', weight: 40, bp: 'legs' }] } }] }] }],
    }
    mocks.S.programmes = {
      version: 1,
      definitions: [definition, foreign],
      cycles: [
        { id: 'cycle-1', definitionId: 'programme-2', status: 'done', snapshot: { weeks: foreign.weeks } },
      ],
    }
    mocks.locationState = {
      programmeId: 'programme-1',
      cycleId: 'cycle-1',
      mode: 'repeat',
      savedPolicy: 'linear',
    }

    const { default: ProgrammePickupSheet } = await import('./ProgrammePickupSheet.jsx')
    const tree = ProgrammePickupSheet({ onSave: mocks.save })
    const continueButton = findElement(tree, node => node.props?.children === 'Continue')

    expect(continueButton.props.disabled).toBe(true)
  })
})
