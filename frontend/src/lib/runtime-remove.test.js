import { describe, expect, it } from 'vitest'
import { removeActiveExercise } from './workout-runtime.js'

const active = (nEntries, cur) => ({
  id: 'w1', cur,
  entries: Array.from({ length: nEntries }, (_, i) => ({ id: 'e' + i, sets: [{ w: 10 + i, r: 8 }] }))
})

describe('removeActiveExercise', () => {
  it('removes the entry and keeps cur in range', () => {
    const a = active(3, 2)
    removeActiveExercise(a, 2)
    expect(a.entries).toHaveLength(2)
    expect(a.cur).toBe(1)
  })
  it('removes the entry and leaves cur when still in range', () => {
    const a = active(3, 0)
    removeActiveExercise(a, 1)
    expect(a.entries).toHaveLength(2)
    expect(a.cur).toBe(0)
  })
  it('ignores out-of-range indexes', () => {
    const a = active(2, 0)
    removeActiveExercise(a, 5)
    expect(a.entries).toHaveLength(2)
  })
  it('last exercise removed -> cur 0 with empty list', () => {
    const a = active(1, 0)
    removeActiveExercise(a, 0)
    expect(a.entries).toHaveLength(0)
    expect(a.cur).toBe(0)
  })
})
