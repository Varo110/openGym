// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX, isBodyweightEq } from './exercises.js'
import { modeOf, fmtSec, isBw, isPerSide, sideReps } from './history.js'
import { uid, todayISO, DAYN, fmtNum, exCount } from './format.js'
import { t } from './i18n-core.js'
import { normalizePhase, normalizePhaseList, normalizeWeightUnit, normalizeWeightPrescription } from './workout-model.js'
import { storedFromKg } from './units.js'
import { normalizeMuscleGroups, hasExplicitMuscleMetadata } from './muscles.js'
import { normalizeExerciseAnnotations, normalizeRoutineGroupMeta } from './annotations.js'

const PLAN_FMT = 1
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]   // Mon-first, matching the Plan screen
export const PLAN_UNIT_ERROR_KEYS = Object.freeze({
  unknownBundle: 'Plan import rejected: the bundle weight unit is missing or unknown.',
  missingBundle: 'Plan import rejected: the bundle weight unit is missing; refusing to guess kg or lb.',
  unknownDescendant: 'Plan import rejected: descendant weight unit at {0} is missing or unknown.',
  conflictingDescendant: 'Plan import rejected: descendant weight unit at {0} conflicts with the bundle unit ({1}).'
})

function planUnitError(key, ...args) {
  const error = new Error(t(key, ...args))
  error.code = 'OPEN_GYM_PLAN_UNIT_ERROR'
  error.translationKey = key
  error.translationArgs = args
  return error
}

export function planErrorMessage(error) {
  if (error?.code === 'OPEN_GYM_PLAN_UNIT_ERROR' && error.translationKey) {
    return t(error.translationKey, ...(error.translationArgs || []))
  }
  return error?.message || String(error)
}

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const cloneJSON = value => value == null ? value : JSON.parse(JSON.stringify(value))
const normalizeUnit = value => normalizeWeightUnit(value)
const UNIT_MARKERS = ['unit', 'weightUnit', 'loadUnit']
const WEIGHT_FIELDS = new Set([
  'w', 'weight', 'topW', 'resolvedWeight',
  'warmupWeight', 'fallbackWeight', 'warmupFallbackWeight',
  'loadWeight', 'loadFallback', 'workW', 'workWeight', 'workResolvedWeight', 'workLoadFallback'
])
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const explicitUnitMarkers = source => Object.fromEntries(
  UNIT_MARKERS.filter(key => own(source, key)).map(key => [key, cloneJSON(source[key])])
)
const PLAN_REPS_FIELDS = ['reps', 'targetReps', 'minReps', 'amrapMinReps', 'r', 'actualReps']

function planUnit(value) {
  return typeof value === 'string' ? normalizeUnit(value) : null
}

function planModeOf(value, inherited = 'reps') {
  const source = objectOf(value)
  if (source.mode === 'reps' || source.mode === 'time' || source.mode === 'cardio') return source.mode
  if (source.sec != null || source.seconds != null || source.durationSec != null) return 'time'
  if (source.min != null || source.speed != null) return 'cardio'
  if (PLAN_REPS_FIELDS.some(key => source[key] != null)) return 'reps'
  return inherited
}

function finiteNumber(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function nonNegativeNumber(value, fallback = null) {
  const n = finiteNumber(value)
  return n == null || n < 0 ? fallback : n
}

function optionalSeconds(source, names) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue
    const n = nonNegativeNumber(source[name])
    if (n != null) return Math.round(n)
  }
  return undefined
}

function cleanPrescription(input, fallbackWeight = 0) {
  const raw = objectOf(input)
  if (!Object.keys(raw).length) return Object.keys(input || {}).length ? cloneJSON(raw) : null
  const marker = typeof (raw.kind ?? raw.type) === 'string'
    ? String(raw.kind ?? raw.type).trim().toLowerCase() : ''
  const percentValue = raw.percent ?? raw.percentage
  if (marker === 'current_1rm_percentage') {
    const percent = finiteNumber(raw.currentPercent ?? raw.currentPercentage ?? percentValue)
    const fallback = nonNegativeNumber(raw.fallbackWeight ?? raw.fallback ?? raw.weight,
      nonNegativeNumber(fallbackWeight, 0))
    return {
      kind: 'percentage',
      source: 'adaptive',
      percent: percent != null && percent > 0 ? Math.min(200, Math.max(1, Math.round(percent))) : 50,
      fallbackWeight: fallback ?? 0,
      ...explicitUnitMarkers(raw)
    }
  }
  const workset = marker === 'workset_percent' || marker === 'workset'
  if (workset || marker === 'percentage' || marker === 'percent' || percentValue != null) {
    const percent = finiteNumber(percentValue)
    const fallback = nonNegativeNumber(
      raw.fallbackWeight ?? raw.fallback ?? raw.weight,
      nonNegativeNumber(fallbackWeight, 0)
    )
    return {
      kind: workset ? 'workset_percent' : 'percentage',
      ...(workset ? {} : { source: ['latest', 'latest-session', 'latest_session'].includes(String(raw.source ?? '').trim().toLowerCase()) ? 'latest' : 'adaptive' }),
      percent: percent != null && percent > 0 ? Math.min(200, percent) : 50,
      fallbackWeight: fallback ?? 0,
      ...explicitUnitMarkers(raw)
    }
  }
  if (!marker && raw.weight == null && raw.w == null) return cloneJSON(raw)
  return {
    kind: 'fixed',
    weight: nonNegativeNumber(raw.weight ?? raw.w, nonNegativeNumber(fallbackWeight, 0)) ?? 0,
    ...explicitUnitMarkers(raw)
  }
}

function targetKindOf(source, mode) {
  if (source.amrap === true || source.isAmrap === true) return 'amrap'
  const marker = source.kind ?? source.targetKind ?? source.targetType ?? source.type
  const kind = typeof marker === 'string' ? marker.trim().toLowerCase() : ''
  if (kind === 'amrap' || kind === 'as-many-as-possible' || kind === 'as_many_as_possible') return 'amrap'
  if (kind === 'fixed') return 'fixed'
  const value = mode === 'time'
    ? source.sec ?? source.seconds ?? source.durationSec ?? source.targetSec ?? source.minSec
    : source.reps ?? source.targetReps ?? source.minReps ?? source.amrapMinReps
  if (typeof value === 'string' && value.trim().toLowerCase() === 'amrap') return 'amrap'
  return null
}

function removeRepAmrapCap(target) {
  const mode = modeOf(target)
  if (mode !== 'reps') return target
  delete target.cap
  delete target.amrapMaxSec
  if (target.amrapMinReps == null) {
    const minimum = target.reps ?? target.targetReps ?? target.minReps
    if (minimum != null && !(typeof minimum === 'string' && minimum.trim().toLowerCase() === 'amrap')) target.amrapMinReps = minimum
  }
  return target
}

// Keep only the meaningful config fields, so the file stays small and readable.
function cleanTarget(input, phaseFallback = null) {
  const source = objectOf(input)
  const mode = modeOf(source)
  const kind = targetKindOf(source, mode)
  const o = {}
  if (source.phase != null) o.phase = normalizePhase(source.phase, phaseFallback || 'work')
  if (source.mode != null || mode !== 'reps') o.mode = mode
  if (mode === 'cardio') {
    if (source.min != null) o.min = source.min
    if (source.speed != null) o.speed = source.speed
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    const sec = source.sec ?? source.seconds ?? source.durationSec ?? source.targetSec ?? source.minSec
    if (sec != null && !(typeof sec === 'string' && sec.trim().toLowerCase() === 'amrap')) o.sec = sec
    const weight = source.weight ?? source.w
    if (weight != null) o.weight = weight
  } else {
    const reps = source.reps ?? source.targetReps ?? source.minReps
    const minimum = source.amrapMinReps ?? source.minReps ?? reps
    if (kind === 'amrap') {
      if (minimum != null && !(typeof minimum === 'string' && minimum.trim().toLowerCase() === 'amrap')) o.amrapMinReps = minimum
    } else if (reps != null && !(typeof reps === 'string' && reps.trim().toLowerCase() === 'amrap')) o.reps = reps
    const weight = source.weight ?? source.w
    if (weight != null) o.weight = weight
  }
  if (kind) o.kind = kind
  if (kind === 'amrap' && mode === 'time') {
    const maxSec = source.amrapMaxSec ?? source.maxDurationSec ?? source.cap ?? source.maxSec
    if (maxSec != null) o.amrapMaxSec = maxSec
  }
  if (source.prepSec != null) o.prepSec = source.prepSec
  if (source.restSec != null) o.restSec = source.restSec
  const prescriptionCandidates = [source.weightPrescription, source.load, source.prescription]
    .filter(value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length)
  const prescription = prescriptionCandidates[0]
  if (prescription) {
    o.weightPrescription = cleanPrescription(prescription, source.weight ?? source.w ?? 0)
  } else {
    const legacyPrescription = normalizeWeightPrescription(source, source.weight ?? source.w)
    if (legacyPrescription) o.weightPrescription = legacyPrescription
  }
  if (source.sets != null) o.sets = source.sets
  return o
}

function cleanWarmup(input) {
  const source = { ...objectOf(input?.target), ...objectOf(input) }
  const phase = source.phase == null ? 'warmup' : normalizePhase(source.phase, 'warmup')
  const out = { ...cloneJSON(objectOf(input)), ...cleanTarget(source, phase), phase }
  const restSec = optionalSeconds(source, ['restSec'])
  if (restSec !== undefined) out.restSec = restSec
  if (source.prepSec != null) out.prepSec = source.prepSec
  return out
}

function legacyWarmupRows(source) {
  const count = Math.max(0, Math.round(Number(source.warmupSets)) || 0)
  if (!count) return []
  const warmupMode = typeof source.warmupMode === 'string' ? source.warmupMode.trim().toLowerCase() : ''
  const mode = ['time', 'seconds', 'duration'].includes(warmupMode) ? 'time' : 'reps'
  const reps = Math.max(1, Math.round(Number(source.warmupReps)) || 8)
  const sec = Math.max(1, Math.round(Number(source.warmupSec)) || 30)
  const weight = nonNegativeNumber(source.warmupWeight, 0) ?? 0
  const rawPrescription = objectOf(source.warmupWeightPrescription || source.warmupLoad)
  const workset = source.warmupLoadMode === 'workset' || rawPrescription.kind === 'workset_percent'
  const percentage = !workset && (source.warmupLoadMode === 'percentage' || rawPrescription.kind === 'percentage' || rawPrescription.percent != null)
  const prescription = workset
    ? cleanPrescription({
        kind: 'workset_percent',
        percent: source.warmupLoadPercent ?? source.warmupPercent ?? rawPrescription.percent,
        fallbackWeight: source.warmupFallbackWeight ?? rawPrescription.fallbackWeight ?? weight
      }, weight)
    : percentage
    ? cleanPrescription({
        kind: 'percentage',
        percent: source.warmupLoadPercent ?? source.warmupPercent ?? rawPrescription.percent,
        fallbackWeight: source.warmupFallbackWeight ?? rawPrescription.fallbackWeight ?? weight
      }, weight)
    : cleanPrescription(rawPrescription, weight) || { kind: 'fixed', weight }
  const restSec = optionalSeconds(source, ['warmupRestSec', 'warmupRest'])
  const row = {
    phase: 'warmup', mode,
    ...(mode === 'time' ? { sec } : { reps }),
    weight,
    weightPrescription: prescription,
    ...(restSec === undefined ? {} : { restSec })
  }
  return Array.from({ length: count }, () => ({ ...row }))
}

function cleanEx(input) {
  const e = objectOf(input)
  const source = { ...objectOf(e.target), ...e }
  const o = { ...cloneJSON(e), id: e.id }
  Object.assign(o, cleanTarget(source, source.phase != null ? 'work' : null))
  removeRepAmrapCap(o)
  if (o.target && typeof o.target === 'object' && !Array.isArray(o.target)) removeRepAmrapCap(o.target)
  const warmup = Array.isArray(e.warmup) ? e.warmup : legacyWarmupRows(source)
  if (warmup.length) o.warmup = warmup.map(cleanWarmup)
  if (source.warmupRestSec != null) o.warmupRestSec = source.warmupRestSec
  if (source.workRestSec != null) o.workRestSec = source.workRestSec
  // Progression settings travel with the plan — a shared Greyskull routine that arrives
  // without its rule is just a list of weights.
  if (source.prog) o.prog = source.prog
  if (source.amrapMissPolicy) o.amrapMissPolicy = source.amrapMissPolicy
  if (source.inc > 0) o.inc = source.inc
  if (source.repsMin != null) o.repsMin = source.repsMin
  if (source.sg) o.sg = source.sg
  // How the exercise is logged travels too (issues #31/#32) — the bodyweight flag only when
  // it disagrees with the catalogue, since agreeing is what the other end already assumes.
  if (source.bodyweight != null && source.bodyweight !== isBodyweightEq(e.id)) o.bodyweight = source.bodyweight
  // Only on reps work — `side` counts reps, and a timed hold has none to split.
  const entryMode = modeOf(source)
  if (source.side && entryMode !== 'time' && entryMode !== 'cardio') o.side = true
  if (source.repsMax != null) o.repsMax = source.repsMax
  return o
}

function cleanRoutine(input) {
  const source = objectOf(input)
  const out = { ...source }
  const phases = normalizePhaseList(source.phases)
  if (phases == null) delete out.phases
  else out.phases = phases
  const warmupRestSec = optionalSeconds(source, ['warmupRestSec', 'warmupRest'])
  const workRestSec = optionalSeconds(source, ['workRestSec', 'workRest', 'restSec'])
  delete out.warmupRest
  delete out.workRest
  delete out.restSec
  if (warmupRestSec === undefined) delete out.warmupRestSec
  else out.warmupRestSec = warmupRestSec
  if (workRestSec === undefined) delete out.workRestSec
  else out.workRestSec = workRestSec
  return normalizeRoutineGroupMeta(out)
}

function cleanCustom(input) {
  const c = objectOf(input)
  const { cues: _legacyPersonalCues, ...withoutPersonalCues } = cloneJSON(c)
  const explicit = hasExplicitMuscleMetadata(c)
  const muscleGroups = explicit ? normalizeMuscleGroups(c) : []
  return {
    ...withoutPersonalCues, id: c.id, n: c.n, bp: c.bp,
    ...(muscleGroups.length
      ? { tg: muscleGroups[0], sm: muscleGroups.slice(1), muscleGroups }
      : {
          ...(c.tg != null ? { tg: c.tg } : {}),
          ...(c.sm != null ? { sm: cloneJSON(c.sm) } : {})
        }),
    ...(c.desc ? { desc: c.desc } : {})
  }
}

/** Build the shareable bundle: every routine, the week schedule, referenced customs. */
export function buildPlanBundle(S, name, { includePersonalCues = false } = {}) {
  const routines = (S.routines || []).map(r => {
    const phases = normalizePhaseList(r.phases)
    const warmupRestSec = optionalSeconds(r, ['warmupRestSec', 'warmupRest'])
    const workRestSec = optionalSeconds(r, ['workRestSec', 'workRest', 'restSec'])
    return {
      ...cloneJSON(r),
      id: r.id, name: r.name, emoji: r.emoji,
      ...(phases == null ? {} : { phases }),
      ...(r.prog != null ? { prog: cloneJSON(r.prog) } : {}),
      ...(r.amrapMissPolicy != null ? { amrapMissPolicy: cloneJSON(r.amrapMissPolicy) } : {}),
      ...(warmupRestSec === undefined ? {} : { warmupRestSec }),
      ...(workRestSec === undefined ? {} : { workRestSec }),
      ex: (r.ex || []).map(cleanEx)
    }
  })
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(cleanCustom)
  const week = {}
  WEEK_ORDER.forEach(d => { if (S.week?.[d]) week[d] = S.week[d] })
  const annotations = includePersonalCues
    ? Object.fromEntries(Object.entries(normalizeExerciseAnnotations(S.exerciseAnnotations, S.customEx))
      .filter(([id]) => usedIds.has(id)))
    : {}
  return {
    opengym_plan: PLAN_FMT, exported: todayISO(), name: name || '', unit: 'kg', weightUnit: 'kg', week, routines, customEx,
    ...(Object.keys(annotations).length ? { exerciseAnnotations: annotations } : {})
  }
}

/**
 * Validate + normalise an imported file. Throws with a friendly message if it isn't one.
 *
 * Every exercise id has to resolve — either to the built-in library or to a custom
 * exercise carried in the same file. An id that resolves to neither (a hand-edited file,
 * an export from a build with a different exercise dataset) is dropped here: kept, it
 * would sit invisibly in the routine and only surface as a blank screen when the routine
 * is trained.
 */
export function parsePlan(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || !data.opengym_plan || !Array.isArray(data.routines)) {
    throw new Error(t('this isn’t an openGym plan file'))
  }
  const rawUnit = data.unit ?? data.weightUnit
  const parsedUnit = rawUnit == null || rawUnit === '' ? null : planUnit(rawUnit)
  if (rawUnit != null && rawUnit !== '' && !parsedUnit) {
    throw planUnitError(PLAN_UNIT_ERROR_KEYS.unknownBundle)
  }
  const customEx = (Array.isArray(data.customEx) ? data.customEx : [])
    .filter(c => c && c.id).map(cleanCustom)
  const known = new Set(customEx.map(c => c.id))
  const week = objectOf(data.week)
  const exerciseAnnotations = normalizeExerciseAnnotations(data.exerciseAnnotations)
  let dropped = 0
  const routines = data.routines.filter(r => r && Array.isArray(r.ex)).map(r => cleanRoutine({
    ...r,
    ex: r.ex.filter(e => {
      const ok = !!e && (known.has(e.id) || !!EXIDX[e.id])
      if (!ok) dropped++
      return ok
    }).map(cleanEx)
  }))
  return {
    ...cloneJSON(data),
    name: String(data.name || '').trim(),
    unit: parsedUnit,
    sourceUnit: parsedUnit,
    routines,
    week: cloneJSON(week),
    customEx,
    dropped,
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: WEEK_ORDER.filter(d => week[d]).length,
    ...(Object.keys(exerciseAnnotations).length ? { exerciseAnnotations } : {})
  }
}

const LB_TO_KG = 0.45359237
const convertWeight = (value, sourceUnit, destinationUnit) => {
  const n = finiteNumber(value)
  if (n == null || sourceUnit === destinationUnit) return value
  const converted = sourceUnit === 'lb' ? n * LB_TO_KG : n / LB_TO_KG
  return converted
}

function visitPlanDescendants(bundle, visitor) {
  const visit = (value, path, inheritedMode = 'reps', isRoot = false) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`, inheritedMode, false))
      return
    }
    if (!value || typeof value !== 'object') return
    const mode = planModeOf(value, inheritedMode)
    for (const key of UNIT_MARKERS) {
      if (isRoot && key === 'unit') continue
      if (own(value, key)) visitor.unit(value[key], `${path}.${key}`)
    }
    for (const [key, child] of Object.entries(value)) {
      if (isRoot && key === 'unit') continue
      if (UNIT_MARKERS.includes(key)) continue
      visitor.value?.(key, child, mode, `${path}.${key}`)
      visit(child, `${path}.${key}`, mode, false)
    }
  }

  visit(bundle, 'bundle', 'reps', true)
}

function hasWeightedPlan(bundle) {
  let found = false
  visitPlanDescendants(bundle, {
    unit() {},
    value(key, value, mode) {
      const n = finiteNumber(value)
      if (n != null && n > 0 && WEIGHT_FIELDS.has(key)) found = true
      if (key === 'inc' && mode === 'reps' && n != null && n > 0) found = true
    }
  })
  return found
}

function descendantUnits(bundle) {
  const units = []
  visitPlanDescendants(bundle, {
    unit(raw, path) { units.push({ raw, unit: planUnit(raw), path }) },
    value() {}
  })
  return units
}

function validateDescendantUnits(bundle, sourceUnit) {
  for (const { raw, unit, path } of descendantUnits(bundle)) {
    if (!unit) {
      throw planUnitError(PLAN_UNIT_ERROR_KEYS.unknownDescendant, path)
    }
    if (!sourceUnit) {
      throw planUnitError(PLAN_UNIT_ERROR_KEYS.missingBundle)
    }
    if (unit !== sourceUnit) {
      throw planUnitError(PLAN_UNIT_ERROR_KEYS.conflictingDescendant, path, sourceUnit)
    }
  }
}

function convertPlanWeights(bundle, sourceUnit, destinationUnit) {
  const visit = (value, inheritedMode = 'reps') => {
    if (Array.isArray(value)) return value.map(child => visit(child, inheritedMode))
    if (!value || typeof value !== 'object') return value
    const mode = planModeOf(value, inheritedMode)
    const copy = {}
    for (const [key, child] of Object.entries(value)) {
      if (UNIT_MARKERS.includes(key)) {
        copy[key] = destinationUnit
      } else if (WEIGHT_FIELDS.has(key)) {
        copy[key] = convertWeight(child, sourceUnit, destinationUnit)
      } else if (key === 'inc' && mode === 'reps') {
        copy[key] = convertWeight(child, sourceUnit, destinationUnit)
      } else {
        copy[key] = visit(child, mode)
      }
    }
    return copy
  }
  return visit(bundle)
}

/** Prepare a parsed plan for the destination profile without mutating the parsed source. */
export function preparePlanForDestination(bundle, destinationUnit) {
  const rawSource = bundle?.unit
  const sourceUnit = planUnit(rawSource)
  const destination = planUnit(destinationUnit) || 'kg'
  if (rawSource != null && rawSource !== '' && !sourceUnit) {
    throw planUnitError(PLAN_UNIT_ERROR_KEYS.unknownBundle)
  }
  const hasDescendantUnits = descendantUnits(bundle || {}).length > 0
  if (!sourceUnit && (hasWeightedPlan(bundle || {}) || hasDescendantUnits)) {
    throw planUnitError(PLAN_UNIT_ERROR_KEYS.missingBundle)
  }
  if (sourceUnit) validateDescendantUnits(bundle, sourceUnit)
  const converted = !!sourceUnit && sourceUnit !== destination
  return {
    bundle: sourceUnit ? convertPlanWeights(bundle, sourceUnit, destination) : cloneJSON(bundle),
    converted,
    sourceUnit,
    destinationUnit: destination
  }
}

/**
 * Merge a parsed bundle into a draft state `s` (call inside store.update).
 *  - customs: reuse one you already have with the same name + body part, else add it fresh
 *  - routines: always added as NEW routines (fresh ids) — never overwrites yours
 *  - schedule: optional; when on, the shared week REPLACES yours (days the shared plan
 *    leaves empty become rest days — a half-overwritten week would silently mix two plans)
 */
export function mergePlan(s, bundle, { schedule, importPersonalCues = false } = {}) {
  const prepared = preparePlanForDestination(bundle, s.unit)
  const sourceBundle = prepared.bundle
  s.customEx = s.customEx || []
  s.exerciseAnnotations = normalizeExerciseAnnotations(s.exerciseAnnotations, s.customEx)
  const exIdMap = {}
  sourceBundle.customEx.forEach(c => {
    const same = s.customEx.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap[c.id] = same.id; return }
    const nid = uid()
    exIdMap[c.id] = nid
    s.customEx.push({
      ...cloneJSON(c),
      id: nid, n: c.n, bp: c.bp,
      ...(c.tg != null ? { tg: c.tg } : {}),
      ...(c.sm != null ? { sm: cloneJSON(c.sm) } : {}),
      ...(c.muscleGroups?.length ? { muscleGroups: [...c.muscleGroups] } : {}),
      ...(c.desc ? { desc: c.desc } : {})
    })
  })
  if (importPersonalCues) {
    for (const [sourceId, annotation] of Object.entries(sourceBundle.exerciseAnnotations || {})) {
      const destinationId = exIdMap[sourceId] || sourceId
      if (destinationId && own(annotation, 'cues') && typeof annotation.cues === 'string') {
        s.exerciseAnnotations[destinationId] = { cues: annotation.cues }
      }
    }
  }
  const ridMap = {}
  sourceBundle.routines.forEach(r => {
    const nid = uid()
    ridMap[r.id] = nid
    const phases = normalizePhaseList(r.phases)
    const warmupRestSec = optionalSeconds(r, ['warmupRestSec', 'warmupRest'])
    const workRestSec = optionalSeconds(r, ['workRestSec', 'workRest', 'restSec'])
    s.routines.push({
      ...cloneJSON(r),
      id: nid,
      name: r.name || t('Shared routine'),
      emoji: r.emoji,
      ...(phases == null ? {} : { phases }),
      ...(r.prog != null ? { prog: cloneJSON(r.prog) } : {}),
      ...(r.amrapMissPolicy != null ? { amrapMissPolicy: cloneJSON(r.amrapMissPolicy) } : {}),
      ...(warmupRestSec === undefined ? {} : { warmupRestSec }),
      ...(workRestSec === undefined ? {} : { workRestSec }),
      ex: (r.ex || []).map(e => cloneJSON({ ...e, id: exIdMap[e.id] || e.id }))
    })
  })
  if (schedule) {
    WEEK_ORDER.forEach(d => { delete s.week[d] })
    Object.entries(bundle.week || {}).forEach(([d, oldId]) => {
      if (ridMap[oldId]) s.week[d] = ridMap[oldId]
    })
  }
  return {
    routines: sourceBundle.routines.length,
    converted: prepared.converted,
    sourceUnit: prepared.sourceUnit,
    destinationUnit: prepared.destinationUnit
  }
}

/* ------------------------------- printable PDF ------------------------------- */

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One exercise's scheme, e.g. "3 × 10 · 60 kg", "3 × 0:45" or "2 × 20 min @ 8 km/h".
function scheme(e, unit) {
  const sets = e.sets || 1
  const mode = modeOf(e)
  if (mode === 'cardio') {
    const body = `${e.min || 20} min @ ${fmtNum(e.speed || 8)} km/h`
    return sets > 1 ? `${sets} × ${body}` : body
  }
  let s = mode === 'time' ? `${sets} × ${fmtSec(e.sec || 45)}` : `${sets} × ${e.reps ?? 10}`
  if (e.weight) s += ` · ${isBw(e) ? '+' : ''}${fmtNum(storedFromKg(e.weight, unit))} ${unit}`
  // A printed plan is read at the rack, so the split earns its four characters.
  if (mode !== 'time' && isPerSide(e)) s += ` · ${t('{0}/side', fmtNum(sideReps(e.reps ?? 10)))}`
  return s
}

// Group consecutive exercises sharing a superset id into rendered units.
function units(ex) {
  const out = []
  ex.forEach((e, i) => {
    const prev = ex[i - 1]
    if (i > 0 && e.sg && prev?.sg === e.sg) out[out.length - 1].push(e)
    else out.push([e])
  })
  return out
}

function routineHTML(r, unit) {
  const rows = units(r.ex).map(u => {
    const items = u.map(e => {
      const ex = EXIDX[e.id]
      const name = ex ? ex.n : t('Unknown exercise')
      const part = ex && ex.bp && ex.bp !== 'cardio' ? `<span class="part">${esc(ex.bp)}</span>` : ''
      return `<div class="ex"><div class="ex-n">${esc(name)}${part}</div><div class="ex-s">${esc(scheme(e, unit))}</div></div>`
    }).join('')
    return u.length > 1
      ? `<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div><div class="ss-items">${items}</div></div>`
      : items
  }).join('')
  const count = exCount(r.ex.length)
  return `<section class="routine">
    <div class="r-head"><h2>${esc(r.name)}</h2><span class="r-count">${esc(count)}</span></div>
    <div class="ex-list">${rows || `<div class="ex empty">${esc(t('No exercises yet.'))}</div>`}</div>
  </section>`
}

function weekHTML(S) {
  const rows = WEEK_ORDER.map(d => {
    const r = S.routines.find(x => x.id === S.week?.[d])
    const val = r ? esc(r.name) : `<span class="rest">${esc(t('Rest'))}</span>`
    return `<div class="w-row"><div class="w-day">${esc(t(DAYN[d]))}</div><div class="w-r">${val}</div></div>`
  }).join('')
  return `<div class="week">${rows}</div>`
}

/** Full self-contained HTML for the print/PDF view. */
export function planPrintHTML(S, owner) {
  const unit = S.unit || 'kg'
  const routines = (S.routines || []).filter(r => r.ex && r.ex.length)
  const body = routines.length
    ? routines.map(r => routineHTML(r, unit)).join('')
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  const sub = [owner, todayISO()].filter(Boolean).map(esc).join(' · ')
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(t('Weekly Training Plan'))}</title>
<style>
  @page { margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #16181d; background: #fff;
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .doc { max-width: 720px; margin: 0 auto; }
  header { border-bottom: 2px solid #16181d; padding-bottom: 12px; margin-bottom: 20px; }
  header .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; }
  header h1 { font-size: 27px; letter-spacing: -.02em; margin: 3px 0 0; }
  header .sub { color: #6b7180; font-size: 13px; margin-top: 4px; }

  h3.block { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #8a90a0; margin: 0 0 8px; font-weight: 700; }

  .week { border: 1px solid #e4e6ec; border-radius: 10px; overflow: hidden; margin-bottom: 26px; break-inside: avoid; page-break-inside: avoid; }
  .w-row { display: flex; align-items: baseline; padding: 8px 14px; border-top: 1px solid #eef0f4; }
  .w-row:first-child { border-top: 0; }
  .w-day { width: 116px; font-weight: 600; color: #16181d; flex: none; }
  .w-r { text-transform: capitalize; }
  .rest, .w-r .rest { color: #a2a8b6; text-transform: none; }

  .routine { break-inside: avoid; page-break-inside: avoid; margin-bottom: 20px; padding: 14px 16px; border: 1px solid #e4e6ec; border-radius: 12px; }
  .r-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 1px solid #eef0f4; padding-bottom: 8px; margin-bottom: 8px; break-after: avoid; page-break-after: avoid; }
  .r-head h2 { font-size: 18px; letter-spacing: -.01em; margin: 0; text-transform: capitalize; }
  .r-count { font-size: 12px; color: #8a90a0; white-space: nowrap; }

  .ex-list { display: flex; flex-direction: column; }
  .ex { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 6px 0; break-inside: avoid; page-break-inside: avoid; }
  .ex + .ex, .ss + .ex, .ex + .ss { border-top: 1px solid #f2f3f6; }
  .ex-n { text-transform: capitalize; font-weight: 500; }
  .ex-n .part { text-transform: capitalize; color: #9aa0ae; font-weight: 400; font-size: 12px; margin-left: 8px; }
  .ex-s { color: #3d424e; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ex.empty, .none { color: #a2a8b6; }

  .ss { break-inside: avoid; page-break-inside: avoid; border-left: 3px solid #cfe08a; padding-left: 12px; margin: 4px 0; }
  .ss-tag { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; padding-top: 4px; }
  .ss .ex:first-of-type { padding-top: 2px; }

  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eef0f4; color: #a2a8b6; font-size: 11px; text-align: center; }
</style></head>
<body><div class="doc">
  <header>
    <div class="kicker">openGym</div>
    <h1>${esc(t('Weekly Training Plan'))}</h1>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </header>
  <h3 class="block">${esc(t('Week schedule'))}</h3>
  ${weekHTML(S)}
  <h3 class="block">${esc(t('Routines'))}</h3>
  ${body}
  <footer>${esc(t('Made with openGym'))} · opengym.duarte-santos.ch</footer>
</div></body></html>`
}

/**
 * Render the plan and open the browser's print dialog (→ Save as PDF).
 * Uses a hidden iframe so we never navigate away or trip a popup blocker.
 */
export function printPlan(S, owner) {
  const ifr = document.createElement('iframe')
  ifr.setAttribute('aria-hidden', 'true')
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
  document.body.appendChild(ifr)
  const cleanup = () => { try { ifr.remove() } catch (e) { /* */ } }
  const run = () => {
    const w = ifr.contentWindow
    if (!w) { cleanup(); return }
    w.onafterprint = cleanup
    setTimeout(cleanup, 60000)   // safety net if afterprint never fires
    w.focus()
    try { w.print() } catch (e) { cleanup() }
  }
  const doc = ifr.contentWindow.document
  doc.open(); doc.write(planPrintHTML(S, owner)); doc.close()
  // Give the iframe a tick to lay out before printing.
  if (doc.readyState === 'complete') setTimeout(run, 120)
  else ifr.onload = () => setTimeout(run, 120)
}
