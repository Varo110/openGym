import { describe, expect, it } from 'vitest'
import { resolveRoutineDeepLinkTarget } from './RoutineEdit.jsx'

const row = exId => ({ dataset: { exId } })

describe('routine exercise deep-link target resolution', () => {
  it('uses the indexed row only when its exercise id still matches', () => {
    const rows = [row('reordered'), row('linked')]

    expect(resolveRoutineDeepLinkTarget(rows, '1', 'linked')).toBe(rows[1])
    expect(resolveRoutineDeepLinkTarget(rows, '0', 'linked')).toBe(rows[1])
  })

  it('resolves an id-only link without defaulting a missing index to row zero', () => {
    const rows = [row('first'), row('linked')]

    expect(resolveRoutineDeepLinkTarget(rows, null, 'linked')).toBe(rows[1])
  })

  it('returns no target when the linked exercise is not in the routine', () => {
    expect(resolveRoutineDeepLinkTarget([row('first')], '0', 'missing')).toBeNull()
  })

  it('uses the duplicate occurrence ordinal when the indexed row is stale after a reorder', () => {
    const rows = [row('ohp'), row('bench'), row('squat'), row('bench')]

    expect(resolveRoutineDeepLinkTarget(rows, '2', 'bench', '1')).toBe(rows[3])
  })

  it('fails closed instead of choosing the first duplicate when a legacy link has a stale index', () => {
    const rows = [row('ohp'), row('bench'), row('squat'), row('bench')]

    expect(resolveRoutineDeepLinkTarget(rows, '2', 'bench')).toBeNull()
  })
})
