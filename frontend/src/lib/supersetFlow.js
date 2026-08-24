// Pure decisions for the active-workout superset flow. Keeping these independent of React and
// the stores makes the uneven-round and re-check rules explicit and directly testable.
import { normalizePhase } from './workout-model.js'

const hasWork = (entries, idx) => !!entries[idx]?.sets?.some(set => !set.done)
const phaseOf = set => normalizePhase(set?.phase)
const hasPhaseWork = (entries, idx, phase) => !!entries[idx]?.sets?.some(set => !set.done && phaseOf(set) === phase)

// A completion is new progress only when it takes this exercise beyond the largest number of
// simultaneously completed sets seen in this mounted session. Uncheck/re-check therefore does
// not repeat navigation or rest side effects, while completing an added set still can.
export function setProgressHighWater(entry, previous = 0) {
  const done = entry?.sets?.reduce((count, set) => count + (set.done ? 1 : 0), 0) || 0
  return { isNew: done > previous, highWater: Math.max(previous, done) }
}

// Decide where a newly completed superset set goes next. Candidates stay in the completed row's
// normalized phase, with legacy rows without a phase treated as work. When that phase is spent,
// the next row starts at the first remaining entry in unit order after a round boundary.
export function supersetFlowStep(entries, unit, fromIdx, completedSetIdx, completedPhase) {
  if (!Array.isArray(entries) || !Array.isArray(unit) || unit.length <= 1) return null
  const pos = unit.indexOf(fromIdx)
  if (pos < 0) return null

  const phase = normalizePhase(completedPhase ?? entries[fromIdx]?.sets?.[completedSetIdx]?.phase)
  const unitDone = !unit.some(idx => hasWork(entries, idx))
  if (unitDone) return { unitDone: true, roundDone: false, nextIdx: null }

  const laterSamePhase = unit.slice(pos + 1).some(idx => hasPhaseWork(entries, idx, phase))
  const wrapped = [...unit.slice(pos + 1), ...unit.slice(0, pos + 1)]
  const nextIdx = wrapped.find(idx => hasPhaseWork(entries, idx, phase)) ?? null
  if (nextIdx != null) {
    return { unitDone: false, roundDone: !laterSamePhase, nextIdx }
  }

  const firstRemaining = unit.find(idx => hasWork(entries, idx)) ?? null
  return { unitDone: false, roundDone: true, nextIdx: firstRemaining }
}
