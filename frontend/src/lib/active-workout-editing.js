import { cleanupSg, supersetUnits, unitOf } from './history.js'
import { normalizeGroupMeta } from './annotations.js'
import { isWorkRow, modeForSet, isAmrapRoleEligibleSet, amrapRoleForSet } from './workout-model.js'

function preserveCursor(active, selected) {
  const index = active.entries.indexOf(selected)
  active.cur = index < 0 ? Math.max(0, Math.min(Number(active.cur) || 0, active.entries.length - 1)) : index
}

function cleanGroups(active) {
  cleanupSg(active.entries)
  const groupMeta = normalizeGroupMeta(active.entries, active.groupMeta)
  if (Object.keys(groupMeta).length) active.groupMeta = groupMeta
  else delete active.groupMeta
}

/** Reorder canonical active-workout units while retaining object identity and cursor selection. */
export function reorderActiveWorkoutUnit(active, sourceIndex, targetSlot) {
  if (!active || !Array.isArray(active.entries) || !active.entries.length) return false
  const units = supersetUnits(active.entries)
  const sourcePosition = units.findIndex(unit => unit.includes(sourceIndex))
  if (sourcePosition < 0) return false
  const remaining = units.filter((_, index) => index !== sourcePosition)
  const slot = Math.max(0, Math.min(Number.isFinite(targetSlot) ? Math.trunc(targetSlot) : sourcePosition, remaining.length))
  if (slot === sourcePosition) return false
  const selected = active.entries[active.cur]
  const source = units[sourcePosition]
  const moved = active.entries.splice(source[0], source.length)
  const insertAt = remaining.slice(0, slot).reduce((count, unit) => count + unit.length, 0)
  active.entries.splice(insertAt, 0, ...moved)
  cleanGroups(active)
  preserveCursor(active, selected)
  return true
}

/** Swap two adjacent members of an existing group; a group can never be split by this control. */
export function moveActiveGroupMember(active, index, direction) {
  if (!active || !Array.isArray(active.entries)) return false
  const target = index + direction
  const member = active.entries[index]
  if (!member?.sg || !active.entries[target] || active.entries[target].sg !== member.sg) return false
  const selected = active.entries[active.cur]
  ;[active.entries[index], active.entries[target]] = [active.entries[target], active.entries[index]]
  preserveCursor(active, selected)
  return true
}

function hasCompletedSet(entry) {
  return Array.isArray(entry?.sets) && entry.sets.some(set => set?.done === true)
}

function replacementWithProgrammeIdentity(active, current, replacement) {
  const occurrenceId = current?.occurrenceId
  const baseline = Array.isArray(active?.partialExitBaseline?.entries)
    ? active.partialExitBaseline.entries.find(entry => String(entry?.occurrenceId) === String(occurrenceId))
    : null
  if (!occurrenceId || !baseline) return replacement

  const removed = new Set(Array.isArray(active.partialExitBaseline.removedWorkRowIds)
    ? active.partialExitBaseline.removedWorkRowIds.map(String)
    : [])
  const prescribed = (baseline.sets || []).filter(set => set?.programmeRowId != null)
  const available = prescribed.filter(set => !removed.has(String(set.programmeRowId)))
  const target = replacement.target || replacement
  const replacementSets = (replacement.sets || []).map(set => {
    const out = { ...set }
    delete out.programmeRowId
    return out
  })
  const claimed = new Set()
  for (const set of replacementSets) {
    if (!isWorkRow(set)) continue
    const replacementMode = modeForSet(set, target)
    const source = available.find(candidate => !claimed.has(String(candidate.programmeRowId))
      && modeForSet(candidate, current.target || current) === replacementMode)
    if (!source) continue
    set.programmeRowId = source.programmeRowId
    claimed.add(String(source.programmeRowId))
  }
  for (const set of available) {
    const rowId = String(set.programmeRowId)
    if (!claimed.has(rowId)) removed.add(rowId)
  }
  active.partialExitBaseline.removedWorkRowIds = [...removed]
  active.partialExitBaseline.prescribedWorkSets = prescribed
    .filter(set => !removed.has(String(set.programmeRowId))).length
  return { ...replacement, occurrenceId, sets: replacementSets }
}

/**
 * Replace only an unlogged entry. Once data was logged, retain the original entry and insert the
 * replacement after its unit unless the caller explicitly confirms it belongs in that group.
 */
export function replaceOrInsertActiveExercise(active, index, replacement, { inheritGroup = false } = {}) {
  if (!active || !Array.isArray(active.entries) || !replacement || index < 0 || index >= active.entries.length) return null
  const current = active.entries[index]
  if (!hasCompletedSet(current)) {
    active.entries[index] = { ...replacementWithProgrammeIdentity(active, current, replacement), ...(current.sg ? { sg: current.sg } : {}) }
    active.cur = index
    cleanGroups(active)
    return { inserted: false, index }
  }
  const unit = unitOf(supersetUnits(active.entries), index)
  const insertAt = inheritGroup && current.sg ? index + 1 : (unit.length > 1 ? unit[unit.length - 1] + 1 : index + 1)
  active.entries.splice(insertAt, 0, { ...replacement, ...(inheritGroup && current.sg ? { sg: current.sg } : {}) })
  active.cur = insertAt
  cleanGroups(active)
  return { inserted: true, index: insertAt }
}

function stableRoutineMap(active, routine) {
  const entries = active?.entries
  if (!Array.isArray(entries) || !Array.isArray(routine?.ex) || entries.length !== routine.ex.length) return null
  const explicit = Array.isArray(active.routineEntryMap) ? active.routineEntryMap : null
  const mapped = explicit
    ? explicit.map(item => ({ occurrenceId: item?.occurrenceId, routineIndex: item?.routineIndex, id: item?.id }))
    : entries.map(entry => ({ occurrenceId: entry?.occurrenceId, id: entry?.id, routineIndex: routine.ex.findIndex(candidate => candidate?.occurrenceId === entry?.occurrenceId) }))
  if (mapped.length !== entries.length || mapped.some(item => !item.occurrenceId || !Number.isInteger(item.routineIndex)
    || item.routineIndex < 0 || item.routineIndex >= routine.ex.length)) return null
  const seen = new Set()
  for (const item of mapped) {
    if (seen.has(item.routineIndex) || routine.ex[item.routineIndex]?.id !== item.id) return null
    seen.add(item.routineIndex)
  }
  return new Map(mapped.map(item => [item.occurrenceId, item.routineIndex]))
}

/** Apply an explicitly requested active order/group edit to its exact routine mapping, or fail closed. */
export function saveActiveOrderToRoutine(active, routine) {
  const map = stableRoutineMap(active, routine)
  if (!map) return false
  const reordered = active.entries.map(entry => {
    const source = routine.ex[map.get(entry.occurrenceId)]
    if (!source) return null
    const out = { ...source }
    if (entry.sg) out.sg = entry.sg
    else delete out.sg
    return out
  })
  if (reordered.some(value => !value)) return false
  routine.ex = reordered
  const groupMeta = normalizeGroupMeta(reordered, active.groupMeta)
  if (Object.keys(groupMeta).length) routine.groupMeta = groupMeta
  else delete routine.groupMeta
  if (Array.isArray(active.routineEntryMap)) {
    active.routineEntryMap = active.entries.map((entry, routineIndex) => ({ occurrenceId: entry.occurrenceId, routineIndex, id: entry.id }))
  }
  return true
}

/** Persist all selected per-row AMRAP targets through the stable routine occurrence map. */
export function saveActiveAmrapTargetsToRoutine(active, routine) {
  const map = stableRoutineMap(active, routine)
  if (!map) return false
  const updates = []
  for (const entry of active.entries) {
    const routineIndex = map.get(entry?.occurrenceId)
    const source = Number.isInteger(routineIndex) ? routine?.ex?.[routineIndex] : null
    if (!entry || !source || source.id !== entry.id) return false
    const workTargets = []
    let hasTarget = false
    for (let index = 0; index < (entry.sets || []).length; index++) {
      const set = entry.sets[index]
      if (!isWorkRow(set)) continue
      const role = isAmrapRoleEligibleSet(entry, index) ? amrapRoleForSet(entry, index) : null
      const value = role === 'amrap' || role === 'progression' ? Number(set.amrapTarget) : null
      if (value != null && Number.isFinite(value) && value > 0) {
        workTargets.push(Math.max(1, Math.round(value)))
        hasTarget = true
      } else workTargets.push(null)
    }
    updates.push({ routineIndex, source, workTargets: hasTarget ? workTargets : null })
  }
  updates.forEach(({ routineIndex, source, workTargets }) => {
    const out = { ...source }
    if (workTargets) out.amrapTargets = workTargets
    else delete out.amrapTargets
    routine.ex[routineIndex] = out
  })
  return true
}