import { muscleGroupsOf, musclesOf } from './muscles.js'

// Programme scheduling is calendar- and history-derived. Keep the clock at the boundary so
// tests, imports, and callers rendering more than one surface can use one snapshot of `now`.
export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR
export const RECOVERY_HOURS = 48
export const RECOVERY_WINDOW = RECOVERY_HOURS * HOUR
export const PROGRAMME_INSTANCE_VERSION = 1

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_NAMES = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7
}

const finite = value => Number.isFinite(Number(value))
const numberOr = (value, fallback) => finite(value) ? Number(value) : fallback

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function millis(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return NaN
}

function validTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function timeZoneOrLocal(value) {
  return validTimeZone(value) || validTimeZone(deviceTimeZone()) || 'UTC'
}

function partsAt(value, timeZone) {
  const at = millis(value)
  if (!Number.isFinite(at)) return null
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZoneOrLocal(timeZone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hourCycle: 'h23'
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(at))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]))
  // A few ICU versions render midnight as 24 even with h23. Date.UTC needs 0–23.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour)
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour, minute: Number(parts.minute), second: Number(parts.second),
    weekday: WEEKDAY_NAMES[String(parts.weekday || '').toLowerCase()] || 1
  }
}

function isoFromParts(parts) {
  if (!parts || !finite(parts.year) || !finite(parts.month) || !finite(parts.day)) return null
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function validISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
  const parsed = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null
}

function isoAt(value, timeZone) {
  const existing = validISODate(value)
  return existing || isoFromParts(partsAt(value, timeZone))
}

function dateDays(value) {
  const date = validISODate(value)
  return date == null ? NaN : Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY
}

function isoFromDays(days) {
  if (!Number.isFinite(days)) return null
  return new Date(days * DAY).toISOString().slice(0, 10)
}

function addDays(value, amount) {
  const days = dateDays(value)
  return isoFromDays(days + Number(amount || 0))
}

function compareDates(a, b) {
  const left = validISODate(a) || '9999-12-31'
  const right = validISODate(b) || '9999-12-31'
  return left < right ? -1 : left > right ? 1 : 0
}

function maxDate(a, b) {
  return compareDates(a, b) >= 0 ? a : b
}

function weekdayOf(value) {
  const days = dateDays(value)
  if (!Number.isFinite(days)) return null
  return ((new Date(days * DAY).getUTCDay() + 6) % 7) + 1
}

/**
 * The date/weekday anchor for a new cycle. Week 1 is the current Monday only when today
 * is Monday; any other start date anchors to the following Monday. Calendar arithmetic is
 * performed on plain ISO dates, not local midnight, so DST never changes a week boundary.
 */
export function week1StartDate({ now = Date.now(), timeZone } = {}) {
  const zone = timeZoneOrLocal(timeZone)
  const today = isoAt(now, zone)
  if (!today) return null
  const weekday = weekdayOf(today)
  return addDays(today, weekday === 1 ? 0 : 8 - weekday)
}

/** Return the device-local IANA zone, offset at this instant, and calendar date. */
export function scheduleWriteContext(value = {}, explicitTimeZone) {
  let now = value
  let timeZone = explicitTimeZone
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    now = value.now == null ? Date.now() : value.now
    timeZone = value.timeZone ?? value.timezone ?? explicitTimeZone
  }
  const zone = timeZoneOrLocal(timeZone)
  const at = millis(now)
  const parts = partsAt(at, zone)
  const wallClockUTC = parts
    ? Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    : NaN
  const offsetMinutes = Number.isFinite(wallClockUTC) && Number.isFinite(at)
    ? Math.round((wallClockUTC - Math.trunc(at / 1000) * 1000) / 60000)
    : null
  return {
    timeZone: zone,
    offsetMinutes,
    calendarDate: isoFromParts(parts),
    recordedAt: Number.isFinite(at) ? new Date(at).toISOString() : null
  }
}

/** Return a compact marker suitable for both active state and completed/partial history. */
export function programmeInstanceMarker(value) {
  if (!value || typeof value !== 'object') return null
  const nested = value.programmeInstance && typeof value.programmeInstance === 'object'
    ? value.programmeInstance
    : value
  const instanceId = nested.instanceId ?? value.instanceId
  if (typeof instanceId !== 'string' || !instanceId.trim()) return null
  const marker = { version: PROGRAMME_INSTANCE_VERSION, instanceId }
  const fields = [
    'programmeId', 'cycleId', 'sessionTemplateId', 'weekIndex', 'weekday', 'ordinal',
    'nominalDate', 'locationId'
  ]
  for (const field of fields) {
    const source = nested[field] ?? value[field] ?? (field === 'sessionTemplateId' ? nested.sessionId ?? value.sessionId : undefined)
    if (source !== undefined && source !== null && source !== '') marker[field] = clone(source)
  }
  return marker
}

function cycleStatus(cycle) {
  return String(cycle?.status || '').toLowerCase()
}

function cycleCreatedAt(cycle) {
  const value = millis(cycle?.createdAt ?? cycle?.startedAt ?? cycle?.id)
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function cycleComparator(a, b) {
  const date = cycleCreatedAt(a.cycle || a) - cycleCreatedAt(b.cycle || b)
  if (date) return date
  const aId = String((a.cycle || a).id || '')
  const bId = String((b.cycle || b).id || '')
  return aId.localeCompare(bId)
}

function weekNumber(week, index) {
  return numberOr(week?.weekIndex ?? week?.index, index + 1)
}

function normalizeWeekday(value, fallback) {
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isInteger(numeric)) value = numeric
    else value = WEEKDAY_NAMES[value.trim().toLowerCase()]
  }
  if (value === 0) return 7
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 7
    ? Number(value)
    : fallback
}

function dayEntries(week) {
  const days = week?.days
  if (Array.isArray(days)) return days.map((day, index) => [day, normalizeWeekday(day?.weekday, index + 1)])
  if (!days || typeof days !== 'object') return []
  return Object.entries(days).map(([key, day], index) => [day, normalizeWeekday(day?.weekday ?? key, index + 1)])
}

function sessionEntries(day) {
  if (!day || typeof day !== 'object' || day.mode === 'rest' || day.rest === true) return []
  if (!Array.isArray(day.sessions)) return []
  return day.sessions
}

function snapshotWeeks(cycle) {
  const snapshot = cycle?.snapshot
  if (Array.isArray(snapshot)) return snapshot
  if (Array.isArray(snapshot?.weeks)) return snapshot.weeks
  if (Array.isArray(cycle?.weeks)) return cycle.weeks
  return []
}

function routineSnapshotOf(session) {
  return session?.routineSnapshot || session?.routine || session?.snapshot || null
}

function generatedTemplateCounts(cycle) {
  const counts = new Map()
  for (const week of snapshotWeeks(cycle)) {
    for (const [day] of dayEntries(week)) {
      for (const session of sessionEntries(day)) {
        const templateId = session?.sessionTemplateId ?? session?.templateId ?? session?.id
        if (typeof templateId !== 'string' || !templateId || typeof session?.instanceId === 'string') continue
        counts.set(templateId, (counts.get(templateId) || 0) + 1)
      }
    }
  }
  return counts
}

function cycleAnchor(cycle, now, timeZone) {
  const stored = validISODate(cycle?.week1StartDate)
  if (stored) return stored
  const zone = cycle?.timeZone || timeZone
  return week1StartDate({ now: cycle?.startedAt ?? now, timeZone: zone })
}

function materializeCycleInstancesWithDiagnostics(cycle, options = {}) {
  const diagnostics = []
  if (!cycle || typeof cycle !== 'object' || typeof cycle.id !== 'string' || !cycle.id) {
    return { items: [], diagnostics: [{ reason: 'invalid-cycle', cycleId: cycle?.id ?? null }] }
  }
  const anchor = cycleAnchor(cycle, options.now ?? Date.now(), options.timeZone)
  if (!anchor) return { items: [], diagnostics: [{ reason: 'missing-calendar-anchor', cycleId: cycle.id }] }
  const items = []
  const ordinals = new Map()
  const generatedCounts = generatedTemplateCounts(cycle)
  snapshotWeeks(cycle).forEach((week, weekIndex) => {
    const index = weekNumber(week, weekIndex)
    for (const [day, weekday] of dayEntries(week)) {
      if (String(week?.mode || '').toLowerCase() === 'rest' || day?.rest === true || day?.mode === 'rest') continue
      const ordinalKey = `${index}:${weekday}`
      const priorSessions = ordinals.get(ordinalKey) || 0
      sessionEntries(day).forEach((session, sessionIndex) => {
        const sessionTemplateId = session?.sessionTemplateId ?? session?.templateId ?? session?.id
        if (typeof sessionTemplateId !== 'string' || !sessionTemplateId) {
          diagnostics.push({ reason: 'missing-session-template-id', cycleId: cycle.id, weekIndex: index, weekday })
          return
        }
        const routineSnapshot = routineSnapshotOf(session)
        const routineId = session.routineId ?? routineSnapshot?.id ?? sessionTemplateId
        const ordinal = numberOr(session.ordinal, priorSessions + sessionIndex + 1)
        const explicitInstanceId = typeof session.instanceId === 'string' && session.instanceId
          ? session.instanceId
          : null
        const instanceId = explicitInstanceId || (generatedCounts.get(sessionTemplateId) > 1
          ? `pi:${cycle.id}:w${index}:d${weekday}:o${ordinal}:${sessionTemplateId}`
          : `pi:${cycle.id}:${sessionTemplateId}`)
        const nominalDate = addDays(anchor, (index - 1) * 7 + weekday - 1)
        items.push({
          instanceId,
          source: 'programme',
          routineId,
          routineSnapshot: clone(routineSnapshot),
          programmeId: cycle.programmeId ?? null,
          cycleId: cycle.id,
          sessionTemplateId,
          weekIndex: index,
          weekday,
          ordinal,
          nominalDate,
          projectedDate: nominalDate,
          locationId: session.locationId ?? null,
          cycleCreatedAt: cycleCreatedAt(cycle),
          cycleTimeZone: cycle.timeZone ?? options.timeZone ?? null,
          status: 'pending',
          partial: false,
          owed: false,
          miss: false,
          blocked: false,
          _sourceOrder: items.length,
          _session: clone(session)
        })
      })
      ordinals.set(ordinalKey, priorSessions + sessionEntries(day).length)
    }
  })
  return { items, diagnostics }
}

/** Materialize immutable per-cycle instances; no derived dates are written back to the cycle. */
export function materializeCycleInstances(cycle, options = {}) {
  return materializeCycleInstancesWithDiagnostics(cycle, options).items
}

function recordTime(record) {
  for (const field of ['end', 'start', 'completedAt', 'recordedAt', 'updatedAt']) {
    const value = millis(record?.[field])
    if (Number.isFinite(value)) return value
  }
  return NaN
}

function explicitCompletionRatio(record) {
  const completion = record?.completion
  if (!completion || !finite(completion.completedWorkSets) || !finite(completion.prescribedWorkSets)) return null
  const prescribed = Number(completion.prescribedWorkSets)
  if (prescribed <= 0) return null
  return Number(completion.completedWorkSets) / prescribed
}

function classifyRecord(record) {
  if (!record || typeof record !== 'object') return { status: 'pending', partial: false, owed: false, rank: 0 }
  const partial = record.partial === true
  const explicitOwed = typeof record.owed === 'boolean' ? record.owed : null
  const schedule = typeof record.schedule === 'string' ? record.schedule.toLowerCase() : null
  const ratio = explicitCompletionRatio(record)
  const thresholdMet = record.completion && typeof record.completion.thresholdMet === 'boolean'
    ? record.completion.thresholdMet
    : ratio == null ? null : ratio >= 0.3

  const explicitExit = String(record.exitIntent ?? record.completion?.exitIntent ?? record.completion?.disposition ?? '').toLowerCase()
  const overrideOwed = explicitExit === 'continue' ? true : explicitExit === 'skip' ? false : null

  if (!partial && record.plannedComplete === false) {
    return { status: 'incomplete', partial: false, owed: false, rank: 2 }
  }

  if (!partial) {
    if (record.owed === true || schedule === 'repeat' || record.complete === false) {
      return { status: 'invalid', partial: false, owed: false, rank: 1, reason: 'contradictory-completion' }
    }
    return { status: 'completed', partial: false, owed: false, rank: 4 }
  }
  if (record.complete === true) {
    return { status: 'invalid', partial: true, owed: false, rank: 1, reason: 'contradictory-partial' }
  }
  const scheduleOwed = schedule === 'repeat' ? true : schedule === 'advance' ? false : null
  if (overrideOwed != null) {
    if ((explicitOwed != null && explicitOwed !== overrideOwed) ||
        (scheduleOwed != null && scheduleOwed !== overrideOwed)) {
      return { status: 'invalid', partial: true, owed: false, rank: 1, reason: 'contradictory-exit-intent' }
    }
    return overrideOwed
      ? { status: 'owed', partial: true, owed: true, rank: 3 }
      : { status: 'partial-advanced', partial: true, owed: false, rank: 2 }
  }
  if ((explicitOwed === true && schedule === 'advance') ||
      (explicitOwed === false && schedule === 'repeat')) {
    return { status: 'invalid', partial: true, owed: false, rank: 1, reason: 'contradictory-partial' }
  }
  const thresholdOwed = thresholdMet == null ? null : !thresholdMet
  if ((explicitOwed != null && thresholdOwed != null && explicitOwed !== thresholdOwed) ||
      (scheduleOwed != null && thresholdOwed != null && scheduleOwed !== thresholdOwed)) {
    return { status: 'invalid', partial: true, owed: false, rank: 1, reason: 'contradictory-threshold' }
  }

  const owed = explicitOwed ?? scheduleOwed ?? (thresholdOwed == null ? null : thresholdOwed)
  if (owed === true) return { status: 'owed', partial: true, owed: true, rank: 3 }
  if (owed === false) return { status: 'partial-advanced', partial: true, owed: false, rank: 2 }
  return { status: 'invalid', partial: true, owed: false, rank: 1, reason: 'unclassified-record' }
}

function recordMarkerId(record) {
  return programmeInstanceMarker(record)?.instanceId || null
}

function stableText(value) {
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableText(value[key])}`).join(',')}}`
}

function recordsByInstance(workouts) {
  const grouped = new Map()
  ;(Array.isArray(workouts) ? workouts : []).forEach((record, index) => {
    const instanceId = recordMarkerId(record)
    if (!instanceId) return
    const entry = { record, index, classification: classifyRecord(record), at: recordTime(record) }
    const list = grouped.get(instanceId) || []
    list.push(entry)
    grouped.set(instanceId, list)
  })
  const latest = new Map()
  for (const [instanceId, list] of grouped) {
    list.sort((a, b) => {
      const at = (Number.isFinite(a.at) ? a.at : -Infinity) - (Number.isFinite(b.at) ? b.at : -Infinity)
      if (at) return at
      const rank = a.classification.rank - b.classification.rank
      if (rank) return rank
      const text = stableText(a.record).localeCompare(stableText(b.record))
      if (text) return text
      return a.index - b.index
    })
    latest.set(instanceId, { ...list[list.length - 1], attemptCount: list.length })
  }
  return latest
}

function latestClassicRecord(item, workouts) {
  if (!item || item.source !== 'classic' || !item.routineId) return null
  const entries = []
  for (const [index, record] of (Array.isArray(workouts) ? workouts : []).entries()) {
    if (recordMarkerId(record)) continue
    const routineId = record?.routineId ?? record?.routine?.id
    if (routineId !== item.routineId) continue
    const recordDate = validISODate(record?.d) || validISODate(record?.date) || validISODate(record?.calendarDate)
    const timestampDate = recordDate || isoAt(record?.end ?? record?.start, 'UTC')
    if (timestampDate !== item.nominalDate) continue
    entries.push({ record, index, classification: classifyRecord(record), at: recordTime(record) })
  }
  if (!entries.length) return null
  entries.sort((a, b) => {
    const at = (Number.isFinite(a.at) ? a.at : -Infinity) - (Number.isFinite(b.at) ? b.at : -Infinity)
    if (at) return at
    const rank = a.classification.rank - b.classification.rank
    if (rank) return rank
    const text = stableText(a.record).localeCompare(stableText(b.record))
    return text || a.index - b.index
  })
  return { ...entries[entries.length - 1], attemptCount: entries.length }
}

function latestForItem(item, latestRecords, workouts) {
  const mapped = latestRecords.get(item.instanceId)
  if (mapped) return mapped
  if (item.source === 'classic') {
    const rid = item._claimedRecord
    if (!rid) return null
    const list = Array.isArray(workouts) ? workouts : []
    const index = list.findIndex(r => r?.id === rid)
    if (index < 0) return null
    const record = list[index]
    return { record, index, classification: classifyRecord(record), at: recordTime(record), attemptCount: 1 }
  }
  return null
}

function explicitMuscleWeights(value) {
  if (!value || typeof value !== 'object') return {}
  const result = {}
  const canonicalNames = names => muscleGroupsOf({ muscleGroups: names })
  const add = (name, weight) => {
    const amount = Number(weight)
    if (!Number.isFinite(amount) || amount <= 0) return
    for (const canonical of canonicalNames([name])) {
      result[canonical] = Math.max(result[canonical] || 0, amount)
    }
  }
  for (const key of ['muscleWeights', 'muscles']) {
    const source = value[key]
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      for (const [name, weight] of Object.entries(source)) add(name, weight)
    }
  }
  for (const key of ['primaries', 'primaryMuscles', 'primary', 'muscleGroups', 'muscles']) {
    const source = value[key]
    if (Array.isArray(source)) canonicalNames(source).forEach(name => add(name, 1))
  }
  for (const key of ['secondaries', 'secondaryMuscles', 'secondary']) {
    const source = value[key]
    if (Array.isArray(source)) canonicalNames(source).forEach(name => add(name, 0.4))
  }
  return result
}

function mergeWeights(target, source) {
  for (const [name, weight] of Object.entries(source || {})) {
    if (Number(weight) > 0) target[name] = Math.max(target[name] || 0, Number(weight))
  }
  return target
}

function weightsForExercise(value) {
  const explicit = explicitMuscleWeights(value)
  if (Object.keys(explicit).length) return explicit
  try {
    return musclesOf(value || {})
  } catch {
    return {}
  }
}

function weightsForSession(item) {
  const target = {}
  const session = item?._session || {}
  mergeWeights(target, explicitMuscleWeights(session))
  const routine = item?.routineSnapshot
  for (const exercise of Array.isArray(routine?.ex) ? routine.ex : []) {
    mergeWeights(target, weightsForExercise(exercise))
  }
  return target
}

function isWorkSet(set) {
  return !!set && set.done === true && set.phase !== 'warmup' && set.phase !== 'warm-up' && set.warmup !== true
}

function workoutWeights(workout) {
  const target = {}
  mergeWeights(target, explicitMuscleWeights(workout))
  for (const entry of Array.isArray(workout?.entries) ? workout.entries : []) {
    const source = entry?.exercise || entry
    if (!(Array.isArray(entry?.sets) && entry.sets.some(isWorkSet))) continue
    mergeWeights(target, weightsForExercise(source))
  }
  return target
}

function hasCompletedWorkSet(workout) {
  return Array.isArray(workout?.entries) && workout.entries.some(entry =>
    Array.isArray(entry?.sets) && entry.sets.some(isWorkSet))
}

function overlaps(left, right) {
  return Object.keys(left || {}).filter(name => Number(left[name]) > 0 && Number(right?.[name]) > 0)
}

function recoveryGuard(item, workouts, now) {
  const target = weightsForSession(item)
  if (!Object.keys(target).length) return null
  const atNow = millis(now)
  if (!Number.isFinite(atNow)) return { reason: 'invalid-clock', bypassed: false }
  let latest = null
  for (const workout of Array.isArray(workouts) ? workouts : []) {
    const at = recordTime(workout)
    if (!Number.isFinite(at) || at > atNow || !hasCompletedWorkSet(workout)) continue
    const overlap = overlaps(target, workoutWeights(workout))
    if (!overlap.length) continue
    if (!latest || at > latest.at || (at === latest.at && stableText(workout) > stableText(latest.workout))) {
      latest = { workout, at, overlap }
    }
  }
  if (!latest) return null
  const guardUntil = latest.at + RECOVERY_WINDOW
  if (atNow < guardUntil) {
    return {
      reason: 'recovery-overlap',
      bypassed: false,
      lastCompletedAt: new Date(latest.at).toISOString(),
      guardUntil: new Date(guardUntil).toISOString(),
      overlapMuscles: [...latest.overlap]
    }
  }
  return null
}

function isUnsettled(item) {
  return item.status !== 'completed'
    && item.status !== 'incomplete'
    && item.status !== 'partial-advanced'
    && item.status !== 'duplicate'
}

function itemComparator(a, b) {
  const date = compareDates(a.projectedDate, b.projectedDate)
  if (date) return date
  // A Programme queue head is authoritative when it shares a calendar date with a classic
  // session. This deterministic source tie-break also covers legacy cycles without createdAt.
  if (a.source !== b.source) return a.source === 'programme' ? -1 : 1
  if (String(a.cycleId || '') === String(b.cycleId || '')) {
    const week = numberOr(a.weekIndex, 0) - numberOr(b.weekIndex, 0)
    if (week) return week
    const weekday = numberOr(a.weekday, 0) - numberOr(b.weekday, 0)
    if (weekday) return weekday
    const ordinal = numberOr(a.ordinal, 0) - numberOr(b.ordinal, 0)
    if (ordinal) return ordinal
  } else {
    const cycle = (a.cycleCreatedAt ?? Number.MAX_SAFE_INTEGER) - (b.cycleCreatedAt ?? Number.MAX_SAFE_INTEGER)
    if (cycle) return cycle
    const cycleId = String(a.cycleId || '').localeCompare(String(b.cycleId || ''))
    if (cycleId) return cycleId
  }
  const week = numberOr(a.weekIndex, 0) - numberOr(b.weekIndex, 0)
  if (week) return week
  const weekday = numberOr(a.weekday, 0) - numberOr(b.weekday, 0)
  if (weekday) return weekday
  const ordinal = numberOr(a.ordinal, 0) - numberOr(b.ordinal, 0)
  if (ordinal) return ordinal
  return String(a.instanceId || '').localeCompare(String(b.instanceId || ''))
}

function nominalComparator(a, b) {
  const date = compareDates(a.nominalDate, b.nominalDate)
  if (date) return date
  return itemComparator(a, b)
}

function settleAndSlide(items, latestRecords, workouts, options) {
  const now = options.now ?? Date.now()
  const currentDate = isoAt(now, options.timeZone)
  const ordered = [...items].sort(nominalComparator)
  let previousUnsettled = null
  for (const item of ordered) {
    const latest = latestForItem(item, latestRecords, workouts)
    const classification = latest?.classification || (item.status === 'completed'
      ? { status: 'completed', partial: false, owed: false, rank: 4 }
      : { status: 'pending', partial: false, owed: false, rank: 0 })
    item.status = classification.status
    item.partial = classification.partial
    item.owed = classification.owed
    item.miss = classification.status === 'owed'
    item.blocked = classification.status === 'invalid'
    item.blockedReason = classification.reason || null
    item.sameInstance = !!latest
    item.attemptCount = latest?.attemptCount || 0
    item.recordId = latest?.record?.id || null
    item.latestRecord = latest?.record ? clone(latest.record) : null

    const unsettled = isUnsettled(item)
    let projected = item.nominalDate
    if (unsettled && compareDates(item.nominalDate, currentDate) <= 0) projected = maxDate(item.nominalDate, currentDate)
    if (previousUnsettled && unsettled && item.nominalDate !== previousUnsettled.nominalDate) {
      const previousShifted = previousUnsettled.projectedDate !== previousUnsettled.nominalDate ||
        compareDates(previousUnsettled.nominalDate, currentDate) < 0 || previousUnsettled.status === 'owed' || previousUnsettled.status === 'invalid'
      if (previousShifted && compareDates(projected, previousUnsettled.projectedDate) <= 0) {
        projected = addDays(previousUnsettled.projectedDate, 1)
      }
    }
    item.projectedDate = projected
    item.guardUntil = null
    if (unsettled) previousUnsettled = item
  }

  // Attach recovery data only to the current candidate. It is deliberately not used to
  // reorder the queue: a guarded owed head is still the head and later work cannot bypass it.
  const queue = ordered.filter(isUnsettled).sort((a, b) => {
    const aFront = a.status === 'owed' || a.status === 'invalid' ? 0 : 1
    const bFront = b.status === 'owed' || b.status === 'invalid' ? 0 : 1
    return aFront - bFront || itemComparator(a, b)
  })
  const front = queue[0] || null
  let blocked = null
  let eligible = []
  if (front) {
    if (front.status === 'invalid') {
      blocked = { reason: front.blockedReason || 'unclassified-record', bypassed: false }
      front.blocked = true
    } else if (compareDates(front.projectedDate, currentDate) > 0) {
      blocked = null
    } else {
      const guard = recoveryGuard(front, workouts, now)
      if (guard) {
        blocked = guard
        front.guardUntil = guard.guardUntil
        front.blocked = true
      } else {
        eligible = [front]
      }
    }
    for (const item of queue) {
      if (item !== front) item.bypassed = true
    }
  }
  const owed = queue.filter(item => item.status === 'owed')
  return { ordered, queue, front, owed, eligible, blocked }
}

function classicItems(source, options) {
  const slots = source?.classicSessions || source?.classicSlots || []
  const conversion = source?.programmeCreatedFromWeek ?? source?.programmes?.programmeCreatedFromWeek ?? options.programmeCreatedFromWeek
  const items = []
  for (const [index, slot] of (Array.isArray(slots) ? slots : []).entries()) {
    if (!slot || typeof slot !== 'object') continue
    if (slot.rest === true || String(slot.mode || slot.kind || '').toLowerCase() === 'rest') continue
    if (conversion && slot.convertedWeekKey && slot.convertedWeekKey === conversion) continue
    const date = validISODate(slot.projectedDate) || validISODate(slot.nominalDate) || validISODate(slot.date)
    if (!date) continue
    const instanceId = slot.instanceId || slot.id || `classic:${date}:${slot.routineId || index}`
    items.push({
      instanceId,
      source: 'classic',
      routineId: slot.routineId ?? null,
      programmeId: null,
      cycleId: null,
      sessionTemplateId: null,
      weekIndex: null,
      weekday: weekdayOf(date),
      ordinal: numberOr(slot.ordinal, index + 1),
      nominalDate: date,
      projectedDate: date,
      locationId: slot.locationId ?? null,
      cycleCreatedAt: millis(slot.createdAt) || Number.MAX_SAFE_INTEGER,
      routineSnapshot: clone(slot.routineSnapshot || slot.routine || null),
      _session: clone(slot),
      status: slot.completed === true ? 'completed' : 'pending',
      partial: false,
      owed: false,
      miss: false,
      blocked: false,
      sameInstance: false,
      attemptCount: 0,
      recordId: null,
      latestRecord: null,
      bypassed: false,
      guardUntil: null
    })
  }
  return items
}

function sourceCycles(source) {
  if (Array.isArray(source)) return source
  if (Array.isArray(source?.cycles)) return source.cycles
  if (Array.isArray(source?.programmes?.cycles)) return source.programmes.cycles
  return []
}

function sourceWorkouts(source) {
  return Array.isArray(source?.workouts) ? source.workouts : []
}

/**
 * Adapt the persisted store shape to the pure queue projection. Legacy `S.programmes` arrays are
 * intentionally not interpreted as cycles; only the versioned object namespace is eligible here.
 */

function classicSlotsFromWeek(source, options = {}) {
  const week = (source?.week && typeof source.week === 'object' && !Array.isArray(source.week)) ? source.week : {}
  const dayPlan = (source?.dayPlan && typeof source.dayPlan === 'object' && !Array.isArray(source.dayPlan)) ? source.dayPlan : {}
  const marker = source?.programmes?.programmeCreatedFromWeek ?? source?.programmeCreatedFromWeek ?? options.programmeCreatedFromWeek
  const now = options.now ?? Date.now()
  const tz = options.timeZone || deviceTimeZone()
  const today = isoAt(now, tz)
  const wd = weekdayOf(today)
  const monday = addDays(today, wd === 1 ? 0 : 1 - wd)
  const slots = []
  for (let d = 0; d < 7; d++) {
    const iso = addDays(monday, d)
    const wday = d + 1
    let entries = []
    if (Array.isArray(dayPlan[iso])) {
      entries = dayPlan[iso].map((entry, i) => ({ routineId: entry?.routineId ?? entry, ordinal: i + 1 }))
    } else if (week[wday]) {
      entries = [{ routineId: week[wday], ordinal: 1 }]
    }
    for (const e of entries) {
      if (!e.routineId) continue
      slots.push({
        instanceId: 'classic:' + iso + ':' + e.routineId,
        nominalDate: iso,
        projectedDate: iso,
        routineId: e.routineId,
        ordinal: e.ordinal,
        ...(marker ? { convertedWeekKey: marker } : {})
      })
    }
  }
  return slots
}

export function projectStateQueue(state = {}, options = {}) {
  const source = state?.S && typeof state.S === 'object' ? state.S : state
  const programmes = source?.programmes && !Array.isArray(source.programmes) && typeof source.programmes === 'object'
    ? source.programmes
    : {}
  const programmeTimeZone = options.timeZone || programmes.timeZone || source?.timeZone
  const resolvedOptions = { ...options, ...(programmeTimeZone ? { timeZone: programmeTimeZone } : {}) }
  const provided = options.classicSessions ?? source?.classicSessions ?? source?.classicSlots
  const classicSessions = Array.isArray(provided)
    ? clone(provided)
    : classicSlotsFromWeek(source, resolvedOptions)
  return projectProgrammeQueue({
    programmes: { ...clone(programmes), cycles: Array.isArray(programmes.cycles) ? clone(programmes.cycles) : [] },
    workouts: clone(source?.workouts || []),
    programmeDispositions: clone(source?.programmeDispositions || null),
    classicSessions
  }, resolvedOptions)
}

function dedupeInstances(items, diagnostics) {
  const seen = new Map()
  const result = []
  for (const item of [...items].sort(itemComparator)) {
    if (!seen.has(item.instanceId)) {
      seen.set(item.instanceId, item)
      result.push(item)
      continue
    }
    diagnostics.push({ reason: 'duplicate-instance', instanceId: item.instanceId, kept: seen.get(item.instanceId).cycleId, dropped: item.cycleId })
  }
  return result
}

/**
 * Project active Programme cycles and classic slots without persisting queue position.
 * `items` contains settled and unsettled rows for diagnostics. Each active cycle gets its own
 * ordered queue/front/guard state; the aggregate fields are convenience projections for callers
 * that render one mixed schedule surface.
 */
export function projectProgrammeQueue(source = {}, options = {}) {
  const resolved = {
    now: options.now ?? Date.now(),
    timeZone: options.timeZone || source.timeZone || source.programmes?.timeZone || deviceTimeZone(),
    ...options
  }
  const diagnostics = []
  const cycles = sourceCycles(source)
    .filter(cycle => cycleStatus(cycle) === 'active')
    .sort((a, b) => cycleComparator({ cycle: a }, { cycle: b }))
  const candidates = []
  for (const cycle of cycles) {
    const materialized = materializeCycleInstancesWithDiagnostics(cycle, resolved)
    candidates.push(...materialized.items)
    diagnostics.push(...materialized.diagnostics)
  }
  candidates.push(...classicItems(source, resolved))
  const unique = dedupeInstances(candidates, diagnostics)
  const latestRecords = recordsByInstance(sourceWorkouts(source))
  const byCycle = new Map()
  for (const item of unique) {
    if (item.source !== 'programme') continue
    const list = byCycle.get(item.cycleId) || []
    list.push(item)
    byCycle.set(item.cycleId, list)
  }
  const cycleResults = cycles.map(cycle => {
    const settled = settleAndSlide(byCycle.get(cycle.id) || [], latestRecords, sourceWorkouts(source), {
      ...resolved,
      timeZone: cycle.timeZone || resolved.timeZone
    })
    return { cycle, ...settled }
  })
  // Cross-cycle slide-collision resolution (owner D2: never double-book). Deliberate
  // nominal-date sessions are always retained; overdue fronts that slid to the same date
  // keep the oldest cycle on that date and shift newer cycles forward one day per collision.
  {
    const claimedSlideDates = new Set()
    for (const result of cycleResults) {
      const frontItem = result.front
      if (!frontItem) continue
      if (frontItem.nominalDate === frontItem.projectedDate) continue
      let delta = 0
      while (claimedSlideDates.has(addDays(frontItem.projectedDate, delta))) delta += 1
      if (delta > 0) {
        for (const item of result.ordered) item.projectedDate = addDays(item.projectedDate, delta)
      }
      claimedSlideDates.add(frontItem.projectedDate)
    }
  }
  const cycleQueues = cycleResults.map(result => ({
    cycleId: result.cycle.id,
    items: result.ordered,
    queue: result.queue,
    owed: result.owed,
    front: result.front,
    eligible: result.eligible,
    blocked: result.blocked
  }))
  const programmeFronts = cycleResults.map(result => result.front).filter(Boolean)
  const programmeQueue = cycleResults.flatMap(result => result.queue)
  const programmeOwed = cycleResults.flatMap(result => result.owed)
  const programmeEligible = cycleResults.flatMap(result => result.eligible)
  const blockedByCycle = Object.fromEntries(cycleResults
    .filter(result => result.blocked)
    .map(result => [result.cycle.id, result.blocked]))
  const classic = unique.filter(item => item.source === 'classic')
  {
    const claimed = new Set()
    for (const item of [...classic].sort((a, b) => a.ordinal - b.ordinal)) {
      const found = latestClassicRecord(item, sourceWorkouts(source))
      if (found && !claimed.has(found.record.id)) {
        claimed.add(found.record.id)
        item._claimedRecord = found.record.id
      } else {
        item._claimedRecord = null
      }
    }
  }
    const classicResult = settleAndSlide(classic, latestRecords, sourceWorkouts(source), resolved)
  const classicSettled = classicResult.ordered
  const classicQueue = classicResult.queue
  const classicFront = classicResult.front
  const classicBlocked = classicResult.blocked
  const classicEligible = classicResult.eligible
  const fronts = [...programmeFronts, classicFront].filter(Boolean).sort((a, b) => {
    const aFront = a.status === 'owed' || a.status === 'invalid' ? 0 : 1
    const bFront = b.status === 'owed' || b.status === 'invalid' ? 0 : 1
    return aFront - bFront || itemComparator(a, b)
  })
  const front = fronts[0] || null
  const globalQueue = [...programmeQueue, ...classicQueue].sort((a, b) => {
    const aFront = a.status === 'owed' || a.status === 'invalid' ? 0 : 1
    const bFront = b.status === 'owed' || b.status === 'invalid' ? 0 : 1
    return aFront - bFront || itemComparator(a, b)
  })
  for (const item of globalQueue) item.bypassed = item !== front
  const blockedBySource = { ...blockedByCycle, ...(classicBlocked ? { classic: classicBlocked } : {}) }
  const frontResult = front?.source === 'programme'
    ? cycleResults.find(result => result.cycle.id === front.cycleId)
    : front?.source === 'classic' ? classicResult : null
  const frontIsEligible = !!frontResult?.eligible?.some(item => item.instanceId === front.instanceId)
  // The mixed queue has one authority: a guarded or invalid head blocks every later source.
  // Per-cycle `eligible` values remain available in cycleQueues for diagnostics only.
  const eligible = frontIsEligible ? [front] : []
  const allItems = [...cycleResults.flatMap(result => result.ordered), ...classicSettled].sort(itemComparator)
  return {
    now: resolved.now,
    timeZone: timeZoneOrLocal(resolved.timeZone),
    items: allItems,
    queue: globalQueue,
    cycleQueues,
    programmeFronts,
    fronts,
    owed: [...programmeOwed, ...classicResult.owed].sort(itemComparator),
    front,
    eligible,
    blocked: front?.source === 'programme'
      ? blockedByCycle[front.cycleId] || null
      : front?.source === 'classic' ? classicBlocked : null,
    blockedByCycle,
    blockedBySource,
    dispositions: {
      ...(Array.isArray(source?.programmes?.skippedInstanceIds)
        ? source.programmes.skippedInstanceIds.reduce((acc, id) => {
          if (typeof id !== 'string' || !id) return acc
          acc[id] = { version: 1, disposition: 'skip', instanceId: id }
          return acc
        }, {})
        : {}),
      ...(source?.programmeDispositions?.entries ?? {})
    },
    diagnostics
  }
}

/** Return projected rows on one calendar date while retaining source immutability. */
export function projectedSessionsForDate(source = {}, date, options = {}) {
  const result = projectProgrammeQueue(source, options)
  const target = validISODate(date)
  return target ? result.items.filter(item => item.projectedDate === target) : []
}

// Named aliases keep the per-cycle seam explicit for callers that already have one cycle.
export const projectCycleQueue = (cycle, options = {}) =>
  projectProgrammeQueue({ cycles: [cycle], workouts: options.workouts || [] }, options)

export const isProgrammeSessionOwed = record => classifyRecord(record).status === 'owed'


/** Build the durable 'finish and skip' disposition record for a programme instance. */
export function buildProgrammeSkipDisposition(active = {}, options = {}) {
  const now = options.now ?? Date.now()
  const timeZone = options.timeZone || deviceTimeZone()
  const nominalDate = validISODate(active?.nominalDate) || null
  const context = scheduleWriteContext({ now, timeZone })
  return {
    version: 1,
    disposition: 'skip',
    instanceId: active?.instanceId || null,
    programmeId: active?.programmeId || null,
    cycleId: active?.cycleId || null,
    ...(nominalDate ? { nominalDate } : {}),
    ...context,
    timeZone: context.timeZone,
    calendarDate: context.calendarDate,
    recordedAt: context.recordedAt
  }
}

/** Return the still-visible skip/finish dispositions from a queue projection. */
export function visibleProgrammeDispositions(result = {}, options = {}) {
  const entries = result?.dispositions || {}
  const list = []
  for (const [instanceId, disposition] of Object.entries(entries)) {
    if (!disposition || typeof disposition !== 'object') continue
    const raw = disposition.disposition
    if (raw !== 'skip' && raw !== 'finish') continue
    const status = raw === 'skip' ? 'skipped' : 'finished'
    list.push({ instanceId, status, ...disposition })
  }
  return list
}


/** Start surface for the workout chooser: the aggregate queue projection with the
 * programme front exposed as the authoritative head (guarded/owed heads never
 * bypassed by classic routines). */
export function programmeStartSurface(state = {}, options = {}) {
  return projectStateQueue(state, options)
}
