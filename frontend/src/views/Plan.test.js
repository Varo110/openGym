import { describe, expect, it } from 'vitest'
import { planRowRoutineIds } from './Plan.jsx'

const iso = '2026-02-23'
const day = new Date(iso + 'T12:00:00').getDay()
const state = overrides => ({
  routines: [{ id: 'weekly', name: 'Weekly' }, { id: 'other', name: 'Other' }],
  week: { [day]: 'weekly' },
  dayPlan: overrides
})

describe('Plan weekly schedule rows', () => {
  it('renders an explicit rest override instead of falling back to the weekly routine', () => {
    expect(planRowRoutineIds(state({ [iso]: ['rest'] }), iso)).toEqual([])
    expect(planRowRoutineIds(state({ [iso]: [] }), iso)).toEqual([])
  })

  it('uses the weekly routine only when there is no date override', () => {
    expect(planRowRoutineIds(state({}), iso)).toEqual(['weekly'])
    expect(planRowRoutineIds(state({ [iso]: ['other'] }), iso)).toEqual(['other'])
  })
})
