import { describe, expect, it } from 'vitest'
import { setProgressHighWater, supersetFlowStep } from './supersetFlow.js'

const entry = done => ({ sets: done.map(value => ({ done: value })) })

describe('supersetFlowStep', () => {
  it('does not create navigation or rest flow for a normal singleton exercise', () => {
    const entries = [entry([true]), entry([false])]
    expect(supersetFlowStep(entries, [0], 0)).toBeNull()
  })

  it('does not count an uncheck/re-check of previously completed work as new progress', () => {
    const finished = entry([true, true, true])
    expect(setProgressHighWater(finished, 3)).toEqual({ isNew: false, highWater: 3 })
    expect(setProgressHighWater(finished, 2)).toEqual({ isNew: true, highWater: 3 })
  })

  it('keeps source-only warm-ups at their boundaries before handing work to the partner', () => {
    const entries = [
      { sets: [
        { phase: 'warmup', done: true },
        { phase: 'warmup', done: false },
        { phase: 'work', done: false },
        { phase: 'work', done: false }
      ] },
      { sets: [
        { phase: 'work', done: false },
        { phase: 'work', done: false }
      ] }
    ]

    expect(supersetFlowStep(entries, [0, 1], 0, 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })

    entries[0].sets[1].done = true
    expect(supersetFlowStep(entries, [0, 1], 0, 1)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })

    entries[0].sets[2].done = true
    expect(supersetFlowStep(entries, [0, 1], 0, 2)).toEqual({
      unitDone: false,
      roundDone: false,
      nextIdx: 1
    })
  })

  it('alternates warm-ups between both partners, then starts source work', () => {
    const entries = [
      { sets: [
        { phase: 'warmup', done: true },
        { phase: 'warmup', done: false },
        { phase: 'work', done: false },
        { phase: 'work', done: false }
      ] },
      { sets: [
        { phase: 'warmup', done: false },
        { phase: 'work', done: false }
      ] }
    ]

    expect(supersetFlowStep(entries, [0, 1], 0, 0)).toEqual({
      unitDone: false,
      roundDone: false,
      nextIdx: 1
    })

    entries[1].sets[0].done = true
    expect(supersetFlowStep(entries, [0, 1], 1, 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })

    entries[0].sets[1].done = true
    expect(supersetFlowStep(entries, [0, 1], 0, 1)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })

  it('keeps trailing surplus warm-ups on the later member', () => {
    const entries = [
      { sets: [{ phase: 'warmup', done: true }, { phase: 'work', done: false }] },
      { sets: [
        { phase: 'warmup', done: true },
        { phase: 'warmup', done: false },
        { phase: 'work', done: false }
      ] }
    ]

    expect(supersetFlowStep(entries, [0, 1], 1, 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 1
    })
  })

  it('preserves forward and wrap order in a three-member group', () => {
    const forward = [
      entry([true, false]),
      entry([true]),
      entry([false])
    ]
    expect(supersetFlowStep(forward, [0, 1, 2], 0, 0)).toEqual({
      unitDone: false,
      roundDone: false,
      nextIdx: 2
    })

    const wrapped = [
      entry([false]),
      entry([true]),
      entry([true, false])
    ]
    expect(supersetFlowStep(wrapped, [0, 1, 2], 2, 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })

  it.each([
    [4, 'snatch components'],
    [5, 'clean components'],
  ])('walks two exact rounds through %s %s without inter-component boundaries', (memberCount, _label) => {
    const entries = Array.from({ length: memberCount }, () => entry([false, false]))
    const unit = entries.map((_, index) => index)
    const trace = []

    for (let round = 0; round < 2; round++) {
      for (let member = 0; member < memberCount; member++) {
        entries[member].sets[round].done = true
        trace.push(supersetFlowStep(entries, unit, member, round, 'work'))
      }
    }

    expect(trace.slice(0, memberCount - 1)).toEqual(
      Array.from({ length: memberCount - 1 }, (_, member) => ({ unitDone: false, roundDone: false, nextIdx: member + 1 }))
    )
    expect(trace[memberCount - 1]).toEqual({ unitDone: false, roundDone: true, nextIdx: 0 })
    expect(trace.slice(memberCount, memberCount * 2 - 1)).toEqual(
      Array.from({ length: memberCount - 1 }, (_, member) => ({ unitDone: false, roundDone: false, nextIdx: member + 1 }))
    )
    expect(trace.at(-1)).toEqual({ unitDone: true, roundDone: false, nextIdx: null })
  })

  it('skips a spent short member and uses the last member with work as the round boundary', () => {
    // A has just completed set two of three; B's only set was completed last round.
    const entries = [entry([true, true, false]), entry([true])]
    expect(supersetFlowStep(entries, [0, 1], 0, 1)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })

  it('wraps to the next member with work at a normal round boundary', () => {
    const entries = [entry([true, false, false]), entry([true])]
    expect(supersetFlowStep(entries, [0, 1], 1, 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })
})
