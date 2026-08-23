import { isWorkRow } from './workout-model.js'

export const PARTIAL_THRESHOLD_PERCENT = 30
export const EXIT_INTENTS = ['default', 'continue', 'skip', 'discard', 'finish']

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const entriesOf = source => Array.isArray(source?.entries) ? source.entries : []

/**
 * Return the stable identity for one exercise occurrence in a workout instance.
 *
 * Exercise ids identify catalogue entries, not rows in a routine: the same exercise may be
 * prescribed twice with different loads or targets.  The ordinal is therefore part of the
 * persisted identity and is assigned in source order at workout start.  Explicit identities
 * survive reloads; the fallback keeps legacy active shapes deterministic while they are being
 * written through the Programme boundary.
 */
export function occurrenceIdForEntry(entry = {}, index = 0, seen = new Map()) {
  const explicit = entry?.occurrenceId ?? entry?.entryInstanceId ?? entry?.entryKey
  const base = explicit != null && String(explicit).trim()
    ? String(explicit)
    : String(entry?.id ?? `entry-${index + 1}`)
  const count = (seen.get(base) || 0) + 1
  seen.set(base, count)
  if (explicit != null && count === 1) return base
  return `${base}#${count}`
}

function keyedEntries(entries) {
  const seen = new Map()
  return (Array.isArray(entries) ? entries : []).map((entry, index) => ({
    entry,
    occurrenceId: occurrenceIdForEntry(entry, index, seen)
  }))
}

function baselineOf(source) {
  const baseline = objectOf(source?.partialExitBaseline)
  const declaredWorkSets = Number(baseline.prescribedWorkSets)
  if (!Number.isFinite(declaredWorkSets) || declaredWorkSets < 0) return null
  const removedRowIds = new Set(Array.isArray(baseline.removedWorkRowIds)
    ? baseline.removedWorkRowIds.map(String)
    : [])
  const entries = Array.isArray(baseline.entries)
    ? keyedEntries(baseline.entries.filter(entry => entry && entry.id != null)).map(({ entry, occurrenceId }) => ({
      ...entry,
      id: entry.id,
      occurrenceId: entry.occurrenceId || occurrenceId,
      sets: Array.isArray(entry.sets)
        ? entry.sets
          .filter(set => !removedRowIds.has(String(set?.programmeRowId ?? '')))
          .map(set => ({ ...set, done: false }))
        : []
    }))
    : []
  const prescribedWorkSets = entries.length
    ? entries.reduce((total, entry) => total + entry.sets.length, 0)
    : declaredWorkSets
  return { version: Number(baseline.version) || 1, prescribedWorkSets, entries, removedRowIds }
}

/** Capture the prescribed work rows before a Programme session can be edited in place. */
export function partialExitBaseline(entries = []) {
  const snapshots = keyedEntries(entries).map(({ entry, occurrenceId }) => {
    let workOrdinal = 0
    const sets = (Array.isArray(entry?.sets) ? entry.sets : [])
      .filter(isWorkRow)
      .map(set => {
        workOrdinal++
        const programmeRowId = set.programmeRowId || `${occurrenceId}:work:${workOrdinal}`
        // Active rows carry their start-of-session identity.  This is not a catalogue identity:
        // it lets an explicit removal revise exactly one planned row even with duplicate exercises.
        set.programmeRowId = programmeRowId
        return { ...set, programmeRowId, done: false }
      })
    return { id: entry?.id, occurrenceId, sets }
  }).filter(entry => entry.id != null)
  return {
    version: 2,
    prescribedWorkSets: snapshots.reduce((total, entry) => total + entry.sets.length, 0),
    entries: snapshots,
    removedWorkRowIds: []
  }
}

/** Mark one originally prescribed Programme work row as intentionally removed before deleting it. */
export function recordProgrammeSetRemoval(active = {}, entryIdx, setIdx) {
  const entry = active?.entries?.[entryIdx]
  const set = entry?.sets?.[setIdx]
  const baseline = objectOf(active?.partialExitBaseline)
  if (!entry || !set || !isWorkRow(set) || !Array.isArray(baseline.entries)) return false
  const occurrenceId = entry.occurrenceId || keyedEntries(active.entries)[entryIdx]?.occurrenceId
  const snapshot = baseline.entries.find(candidate => String(candidate?.occurrenceId) === String(occurrenceId))
  const rowId = set.programmeRowId
  if (!snapshot || !rowId || !snapshot.sets?.some(candidate => candidate?.programmeRowId === rowId)) return false
  const removed = new Set(Array.isArray(baseline.removedWorkRowIds) ? baseline.removedWorkRowIds.map(String) : [])
  removed.add(String(rowId))
  baseline.version = Math.max(2, Number(baseline.version) || 0)
  baseline.removedWorkRowIds = [...removed]
  baseline.prescribedWorkSets = baseline.entries.reduce((total, candidate) => total
    + (candidate.sets || []).filter(candidateSet => !removed.has(String(candidateSet?.programmeRowId ?? ''))).length, 0)
  return true
}

/** Keep prescribed rows in a partial record even if the active editor removed them. */
export function entriesForProgrammeExit(source = {}) {
  const current = entriesOf(source)
  const baseline = baselineOf(source)
  if (!baseline?.entries.length) return current
  const currentByOccurrence = new Map(keyedEntries(current).map(({ entry, occurrenceId }) => [occurrenceId, entry]))
  const merged = baseline.entries.map(snapshot => {
    const entry = currentByOccurrence.get(snapshot.occurrenceId)
    if (!entry) return {
      id: snapshot.id,
      occurrenceId: snapshot.occurrenceId,
      sets: snapshot.sets.map(set => ({ ...set, done: false }))
    }
    const sets = (Array.isArray(entry.sets) ? entry.sets : []).map(set => ({ ...set }))
    const currentRowIds = new Set(sets.map(set => String(set?.programmeRowId ?? '')).filter(Boolean))
    for (const prescribed of snapshot.sets) {
      if (prescribed.programmeRowId && currentRowIds.has(String(prescribed.programmeRowId))) continue
      if (prescribed.programmeRowId) {
        sets.push({ ...prescribed, done: false })
        currentRowIds.add(String(prescribed.programmeRowId))
      } else if (sets.filter(isWorkRow).length < snapshot.sets.length) {
        sets.push({ ...prescribed, done: false })
      }
    }
    return { ...entry, occurrenceId: snapshot.occurrenceId, sets }
  })
  const known = new Set(baseline.entries.map(entry => entry.occurrenceId))
  return [...merged, ...keyedEntries(current)
    .filter(({ occurrenceId }) => !known.has(occurrenceId))
    .map(({ entry, occurrenceId }) => ({ ...entry, occurrenceId }))]
}

function countsForExit(source) {
  const current = entriesOf(source)
  const baseline = baselineOf(source)
  if (!baseline) return keyedEntries(current).map(({ entry, occurrenceId }) => ({
    id: entry.id,
    occurrenceId,
    ...workSetCounts(entry)
  }))

  const currentByOccurrence = new Map(keyedEntries(current).map(({ entry, occurrenceId }) => [occurrenceId, entry]))
  const baselineByOccurrence = new Map(baseline.entries.map(entry => [entry.occurrenceId, entry]))
  const counts = []
  // Rows added after start are retained for the partial record, but cannot alter this exit
  // classification: only the prescribed-at-start row set is eligible for the anchored ratio.
  for (const [occurrenceId, snapshot] of baselineByOccurrence) {
    const current = currentByOccurrence.get(occurrenceId) || {}
    const rowIds = new Set(snapshot.sets.map(set => set?.programmeRowId).filter(Boolean))
    const currentCounts = rowIds.size
      ? {
          prescribed: snapshot.sets.length,
          completed: new Set((current.sets || [])
            .filter(set => isWorkRow(set) && set.done === true && rowIds.has(set.programmeRowId))
            .map(set => set.programmeRowId)).size
        }
      : workSetCounts(current)
    counts.push({
      id: snapshot.id,
      occurrenceId,
      prescribed: snapshot.sets.length,
      completed: Math.min(currentCounts.completed, snapshot.sets.length)
    })
  }
  if (!baseline.entries.length) {
    const completed = current.reduce((total, entry) => total + workSetCounts(entry).completed, 0)
    return [{ id: null, prescribed: baseline.prescribedWorkSets, completed: Math.min(completed, baseline.prescribedWorkSets) }]
  }
  return counts
}

/** Count only prescribed work-phase rows; warm-up rows never affect the D4 denominator. */
export function workSetCounts(entry = {}) {
  const rows = (Array.isArray(entry.sets) ? entry.sets : []).filter(isWorkRow)
  return {
    prescribed: rows.length,
    completed: rows.filter(set => set.done === true).length
  }
}

/** A Programme marker is explicit; routine/classic sessions must keep their legacy exit path. */
export function isProgrammeSession(active = {}) {
  const source = objectOf(active)
  return source.sessionType === 'programme'
    || source.kind === 'programme'
    || source.programmeSession === true
    || (source.programmeId != null && source.programmeId !== '')
    || !!source.programme
    || (source.cycleId != null && source.cycleId !== '')
    || !!source.cycle
}

function entryProgression(counts, branch, defaultBranch) {
  if (!counts.prescribed) return 'none'
  if (branch === 'continue' && defaultBranch === 'continue') return 'miss'
  if (counts.completed >= counts.prescribed) return 'progress'
  // A partial exercise is retained in the record but never receives an automatic advance.
  return 'none'
}

/**
 * Resolve the D4 exit state without relying on floating-point percentages.
 *
 * `default` is the implicit close/reload policy. Explicit `continue` and `skip` override the
 * threshold. `finish` is retained for the classic/full-completion writer. Zero work never writes
 * a record; an explicit skip may still advance a Programme schedule without creating history.
 */
export function classifyWorkoutExit(source = {}, intent = 'default') {
  const requested = EXIT_INTENTS.includes(intent) ? intent : 'default'
  const counts = countsForExit(source)
  const baseline = baselineOf(source)
  const prescribedWorkSets = baseline
    ? baseline.prescribedWorkSets
    : counts.reduce((total, item) => total + item.prescribed, 0)
  const completedWorkSets = counts.reduce((total, item) => total + item.completed, 0)
  const full = prescribedWorkSets > 0 && completedWorkSets >= prescribedWorkSets
  const thresholdMet = prescribedWorkSets > 0
    && completedWorkSets * 100 >= prescribedWorkSets * PARTIAL_THRESHOLD_PERCENT

  if (requested === 'discard') {
    return {
      intent: requested,
      outcome: 'discard',
      record: false,
      partial: false,
      complete: false,
      owed: false,
      scheduling: 'discard',
      thresholdMet,
      completedWorkSets,
      prescribedWorkSets,
      ratio: prescribedWorkSets ? completedWorkSets / prescribedWorkSets : 0,
      prescribedWorkSetsAtStart: prescribedWorkSets,
      entries: counts.map(item => ({ ...item, progression: 'none' }))
    }
  }

  if (completedWorkSets === 0) {
    return {
      intent: requested,
      outcome: 'discard',
      record: false,
      partial: false,
      complete: false,
      owed: false,
      scheduling: requested === 'skip' ? 'advance' : 'discard',
      thresholdMet: false,
      completedWorkSets,
      prescribedWorkSets,
      ratio: 0,
      prescribedWorkSetsAtStart: prescribedWorkSets,
      entries: counts.map(item => ({ ...item, progression: 'none' }))
    }
  }

  if (full || requested === 'finish') {
    return {
      intent: requested,
      outcome: 'complete',
      record: true,
      partial: false,
      complete: true,
      owed: false,
      scheduling: 'advance',
      thresholdMet: true,
      completedWorkSets,
      prescribedWorkSets,
      ratio: completedWorkSets / prescribedWorkSets,
      prescribedWorkSetsAtStart: prescribedWorkSets,
      entries: counts.map(item => ({ ...item, progression: entryProgression(item, 'finish', null) }))
    }
  }

  const defaultBranch = thresholdMet ? 'skip' : 'continue'
  const branch = requested === 'default' ? defaultBranch : requested
  const owed = branch === 'continue'
  return {
    intent: requested,
    outcome: 'partial',
    record: true,
    partial: true,
    complete: false,
    owed,
    scheduling: owed ? 'repeat' : 'advance',
    thresholdMet,
    completedWorkSets,
    prescribedWorkSets,
    ratio: completedWorkSets / prescribedWorkSets,
    prescribedWorkSetsAtStart: prescribedWorkSets,
    entries: counts.map(item => ({
      ...item,
      progression: entryProgression(item, branch, defaultBranch)
    }))
  }
}
