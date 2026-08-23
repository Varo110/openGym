import { modeForSet, normalizePhase, normalizePhaseList, normalizeMode, normalizeTargetKind, amrapMinRepsFor, amrapTargetForSet as resolveAmrapTargetForSet, withoutWorkLoad, isWarmupOnlyTarget, isWarmupRow, isWorkRow, isAmrapRoleEligibleSet, normalizeWeightPrescription, amrapRoleForSet as resolveAmrapRoleForSet, normalizeAmrapRolesForSets } from './workout-model.js'
import { bestEligibleSetOf, percentage1RMForExercise } from './onerm.js'

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const finite = value => {
  if (value === '' || value == null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}
const positive = (value, fallback = null) => {
  const number = finite(value)
  return number == null || number < 0 ? fallback : number
}
const positiveInt = (value, fallback = 0) => {
  const number = finite(value)
  return number == null || number < 0 ? fallback : Math.round(number)
}
const round = value => Math.round(value * 10) / 10
const snap = (value, increment) => increment > 0 ? round(Math.round(value / increment) * increment) : round(value)
export const REST_PRESETS = [0, 60, 90, 120, 150, 180]

/** Whether the selected routine phases include a work phase; omitted means the normal mix. */
export function hasSelectedWorkPhase(config = {}) {
  const source = objectOf(config)
  const nestedTarget = objectOf(source.target)
  const phases = normalizePhaseList(source.phases ?? nestedTarget.phases)
  return phases == null || phases.includes('work')
}

/** Column controls and labels for one logged-row mode. */
export function setTableColumnsForMode(mode, unit = 'kg') {
  const resolved = normalizeMode(mode, 'reps')
  const weight = { f: 'w', field: 'w', step: 2.5, dec: true, label: 'Weight', unit }
  if (resolved === 'cardio') return {
    primary: { f: 'min', field: 'min', step: 1, dec: false, label: 'Duration (min)' },
    secondary: { f: 'speed', field: 'speed', step: 0.5, dec: true, label: 'Speed (km/h)' },
    timed: false
  }
  if (resolved === 'time') return {
    primary: { f: 'sec', field: 'sec', step: 5, dec: false, label: 'Seconds' },
    secondary: weight,
    timed: true
  }
  return {
    primary: weight,
    secondary: { f: 'r', field: 'r', step: 1, dec: false, label: 'Reps' },
    timed: false
  }
}

/** Preserve row order while identifying whether one entry needs row-specific table headings. */
export function tableModesForEntry(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const modes = sets.map(set => modeForSet(set, target))
  return [...new Set(modes.length ? modes : [modeForSet({}, target)])]
}

/** Whether an entry needs row-specific headings, including a singleton parent-mode conflict. */
export function tableModesRequirePerRowHeaders(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const modes = tableModesForEntry(source)
  if (modes.length > 1) return true
  return modes.length === 1 && modes[0] !== modeForSet({}, target)
}

/** Normalize phase-specific rest without inventing a warm-up default. */
export function normalizeRestSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    warmupRestSec: positiveInt(source.warmupRestSec ?? source.warmupRest, null),
    workRestSec: positiveInt(source.workRestSec ?? source.workRest ?? source.restSec, null)
  }
}

/** Resolve rest with set > exercise > routine > global precedence. */
export function restSecondsFor(set = {}, exercise = {}, routine = {}, globalRest = 90) {
  const field = (isWarmupRow(set) || set?.warmup === true) ? 'warmupRestSec' : 'workRestSec'
  const values = [set[field], set.restSec, exercise[field], routine[field], globalRest]
  for (const value of values) {
    const n = positiveInt(value, null)
    if (n != null) return n
  }
  return 0
}

/** Resolve a timed-set preparation countdown using the same override hierarchy as rest. */
export function prepSecondsFor(set = {}, exercise = {}, routine = {}, globalPrep = 5) {
  const values = [set.prepSec, exercise.prepSec, routine.prepSec, globalPrep]
  for (const value of values) {
    const n = positiveInt(value, null)
    if (n != null) return n
  }
  return 0
}

function prescriptionOf(target = {}) {
  const source = target && typeof target === 'object' ? target : {}
  return normalizeWeightPrescription(source, source.weight) || { kind: 'fixed', weight: positive(source.weight, 0) }
}

/**
 * Estimate a theoretical 1RM from eligible completed work sets. Warm-ups and timed sets are
 * deliberately excluded so a preparatory load cannot silently drive a percentage prescription.
 * A historical entry is preferred over a bare set array because its target is the parent-mode
 * authority for unannotated legacy rows.
 */
function theoretical1RM(history = [], fallbackTarget = {}, context = {}) {
  const source = normalizeWeightPrescription(fallbackTarget, fallbackTarget?.weight)?.source || 'adaptive'
  // A caller may keep `state` scoped for ordinary setup/history while explicitly providing the
  // canonical account history used by an e1RM percentage. Once either state is supplied, it is
  // authoritative: do not fall back to `history`, which may be a single latest entry and would
  // bypass Adaptive's median/retention contract.
  const percentageState = context.percentageState || context.state
  if (percentageState && context.exerciseId) {
    return percentage1RMForExercise(percentageState, context.exerciseId, source, { now: context.now }) || 0
  }
  return bestEligibleSetOf(history, undefined, null, objectOf(fallbackTarget))?.est || 0
}

function maxWorkWeight(input = []) {
  const source = objectOf(input)
  const sets = Array.isArray(input) ? input : (Array.isArray(source.sets) ? source.sets : [])
  let best = 0
  let found = false
  for (const set of sets) {
    if (!isWorkRow(set)) continue
    found = true
    const weight = positive(set?.w ?? set?.weight, 0)
    if (weight > best) best = weight
  }
  return found ? best : null
}

/** Resolve and freeze a fixed or percentage load for the current workout. */
export function resolveTargetLoad(target = {}, history = [], increment = 0, context = {}) {
  const prescription = prescriptionOf(target)
  if (prescription.kind === 'fixed') return round(prescription.weight)
  if (prescription.kind === 'workset_percent') {
    const sessionContext = objectOf(context)
    const hasSessionWorkSets = Object.prototype.hasOwnProperty.call(sessionContext, 'workSets')
    const sessionWorkWeight = maxWorkWeight(sessionContext.workSets)
    const historyWorkWeight = hasSessionWorkSets ? null : maxWorkWeight(history)
    const raw = sessionWorkWeight != null
      ? sessionWorkWeight * prescription.percent / 100
      : historyWorkWeight != null
        ? historyWorkWeight * prescription.percent / 100
        : prescription.fallbackWeight
    return snap(Math.max(0, raw), Math.max(0, finite(increment) || 0))
  }
  const max = theoretical1RM(history, target, context)
  const raw = max > 0 ? max * prescription.percent / 100 : prescription.fallbackWeight
  return snap(Math.max(0, raw), Math.max(0, finite(increment) || 0))
}

function warmupEntries(config = {}) {
  if (Array.isArray(config.warmup)) return config.warmup
  const count = positiveInt(config.warmupSets, 0)
  if (!count) return []
  const legacyMode = normalizeMode(config.warmupMode, config.warmupSec != null ? 'time' : 'reps')
  const legacyPrescription = config.warmupWeightPrescription || config.warmupLoad
  return Array.from({ length: count }, () => ({
    phase: 'warmup',
    mode: legacyMode,
    reps: config.warmupReps,
    sec: config.warmupSec,
    weight: config.warmupWeight,
    weightPrescription: legacyPrescription,
    ...(config.warmupRestSec != null ? { restSec: config.warmupRestSec } : {})
  }))
}

/** Editor shape for a warm-up row, retaining legacy fixed loads when no prescription exists. */
export function warmupDraftForEditor(row = {}, fallback = {}) {
  const source = objectOf(row)
  const base = objectOf(fallback)
  const prescription = normalizeWeightPrescription(source, base.weight)
  const workset = prescription?.kind === 'workset_percent'
  const percentage = prescription?.kind === 'percentage'
  const mode = source.mode === 'time' || source.sec != null || source.seconds != null || source.durationSec != null
    ? 'time'
    : source.mode === 'reps' || source.reps != null
      ? 'reps'
      : normalizeMode(base.mode, base.sec != null ? 'time' : 'reps')
  const fallbackWeight = positive(prescription?.fallbackWeight, positive(base.weight, 0))
  const fixedWeight = positive(prescription?.weight ?? source.weight, positive(base.weight, 0))
  return {
    phase: source.phase || '',
    mode,
    reps: Math.max(1, Math.round(Number(source.reps ?? base.reps ?? 8)) || 8),
    sec: Math.max(1, Math.round(Number(source.sec ?? source.seconds ?? base.sec ?? 30)) || 30),
    loadMode: workset ? 'workset' : percentage ? 'percentage' : 'fixed',
    loadSource: percentage ? (prescription?.source || 'adaptive') : undefined,
    loadPercent: workset || percentage ? positive(prescription?.percent, 50) : 50,
    loadFallback: workset || percentage ? fallbackWeight : 0,
    weight: workset || percentage ? 0 : fixedWeight,
    ...(source.restSec != null ? { restSec: source.restSec } : base.restSec != null ? { restSec: base.restSec } : {})
  }
}

function setForTarget(target, phase, history, increment, context = {}) {
  const mode = normalizeMode(target.mode, target.sec != null ? 'time' : 'reps')
  const resolvedPhase = normalizePhase(target.phase, normalizePhase(phase, 'work'))
  const weight = resolveTargetLoad(target, history, increment, context)
  const restSec = positiveInt(target.restSec, null)
  const kind = normalizeTargetKind(target.kind, 'fixed')
  if (mode === 'time') {
    return {
      phase: resolvedPhase, mode, w: weight, sec: positiveInt(target.sec, 0), done: false,
      ...(kind === 'amrap' ? { kind: 'amrap' } : {}),
      ...(positiveInt(target.prepSec, 0) > 0 ? { prepSec: positiveInt(target.prepSec, 0) } : {}),
      ...(restSec != null ? { restSec } : {})
    }
  }
  return {
    phase: resolvedPhase, mode, w: weight,
    r: positiveInt(kind === 'amrap' ? amrapMinRepsFor(target, target.reps) : target.reps, 0), done: false,
    ...(kind === 'amrap' ? { kind: 'amrap' } : {}),
    ...(restSec != null ? { restSec } : {})
  }
}

function modeForTarget(target = {}, entry = {}) {
  if (target.mode === 'cardio' || target.min != null || target.speed != null) return 'cardio'
  if (target.mode === 'time' || target.sec != null || target.seconds != null || target.durationSec != null) return 'time'
  if (entry.id && target.mode == null && (entry.min != null || entry.speed != null)) return 'cardio'
  return 'reps'
}

/** Build the next row without crossing an authoritative warm-up-only phase boundary. */
export function addSetForEntry(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const warmupOnly = isWarmupOnlyTarget(target, source)

  if (warmupOnly) {
    const lastWarmup = [...sets].reverse().find(set => isWarmupRow(set))
    if (lastWarmup) return { ...lastWarmup, phase: 'warmup', done: false }
    const configured = Array.isArray(target.warmup) ? target.warmup[target.warmup.length - 1] : null
    const warmupTarget = configured
      ? { ...objectOf(configured.target), ...objectOf(configured), phase: 'warmup' }
      : { ...target, phase: 'warmup' }
    return setForTarget(warmupTarget, 'warmup', [], 0)
  }

  const last = sets[sets.length - 1]
  const lastWork = [...sets].reverse().find(set => isWorkRow(set))
  const workSource = lastWork || last
  const mode = modeForTarget(target, source)
  if (mode === 'cardio') {
    return { phase: 'work', min: workSource ? workSource.min : (target.min || 20), speed: workSource ? workSource.speed : (target.speed || 8), done: false }
  }
  if (mode === 'time') {
    return { phase: 'work', sec: workSource ? workSource.sec : (target.sec || 45), w: workSource ? (workSource.w || 0) : (target.weight || 0), done: false }
  }
  return { phase: 'work', w: workSource ? workSource.w : (target.weight || 0), r: workSource ? workSource.r : target.reps, done: false }
}

/** Append one set while freezing existing inferred roles and leaving the new work row unmarked. */
export function appendSetForEntry(entry = {}) {
  const source = objectOf(entry)
  const existing = Array.isArray(source.sets) ? source.sets : []
  const next = addSetForEntry(source)
  if (!isWorkRow(next)) return { ...source, sets: [...existing.map(set => ({ ...set })), next] }
  const candidate = { ...source, sets: [...existing, next] }
  const cleanUnsupportedRole = (set, index) => {
    const out = { ...set }
    if (!isAmrapRoleEligibleSet(candidate, index)) delete out.amrapRole
    return out
  }
  if (!isAmrapRoleEligibleSet(candidate, existing.length)) {
    return { ...source, sets: candidate.sets.map(cleanUnsupportedRole) }
  }
  const roleAware = isAmrapEntry(source)
    || existing.some((set, index) => isAmrapRoleEligibleSet(source, index)
      && Object.prototype.hasOwnProperty.call(set, 'amrapRole'))
  if (!roleAware) return { ...source, sets: [...existing.map(set => ({ ...set })), next] }
  const materialized = existing.map((set, index) => isAmrapRoleEligibleSet(source, index)
    ? { ...set, amrapRole: amrapRoleForSet(source, index) || 'none' }
    : cleanUnsupportedRole(set, index))
  return { ...source, sets: [...materialized, { ...next, amrapRole: 'none' }] }
}

/** Prepend explicitly configured warm-ups to work sets, retaining phase on every logged row. */
export function prependWarmupSets(config = {}, workSets = [], history = [], increment = 0, context = {}) {
  const phases = normalizePhaseList(config.phases)
  const selected = phases == null ? null : new Set(phases)
  const warmupContext = { ...objectOf(context), workSets }
  const warmups = warmupEntries(config)
    .map(target => setForTarget(target, 'warmup', history, increment, warmupContext))
    .filter(set => selected == null || selected.has(set.phase))
  const work = (Array.isArray(workSets) ? workSets : []).map(set => {
    const mode = modeForSet(set, config)
    return {
      ...set,
      phase: normalizePhase(set.phase, 'work'),
      mode,
      ...(positiveInt(config.prepSec, 0) > 0 && mode === 'time'
        ? { prepSec: positiveInt(config.prepSec, 0) } : {})
    }
  }).filter(set => selected == null || selected.has(set.phase))
  const lastWork = work.reduce((last, set, index) => isWorkRow(set) ? index : last, -1)
  const explicitRoles = work.some(set => Object.prototype.hasOwnProperty.call(set, 'amrapRole'))
  const progressionPolicy = config.prog || config.progressionPolicy || null
  const progressionAllowed = progressionPolicy == null || AMRAP_AWARE_POLICIES.includes(progressionPolicy)
  const preparedWork = work.map((set, index) => {
    const legacyRole = config.kind === 'amrap' && index === lastWork
      ? (progressionAllowed ? 'progression' : 'amrap')
      : 'none'
    const amrapRole = explicitRoles
      ? (set.amrapRole === 'progression' && !progressionAllowed
          ? 'amrap'
          : set.amrapRole === 'amrap' || set.amrapRole === 'progression' ? set.amrapRole : 'none')
      : config.kind === 'amrap' ? legacyRole : null
    const prepared = {
      ...set,
      ...(config.kind === 'amrap' && index === lastWork ? { kind: 'amrap' } : {}),
      ...(amrapRole ? { amrapRole } : {})
    }
    return amrapRole && amrapRole !== 'none'
      ? { ...prepared, amrapTarget: set.amrapTarget ?? seedAmrapTargetForSet({ target: config, sets: work }, index) }
      : prepared
  })
  return [...warmups, ...normalizeAmrapRolesForSets(preparedWork, config)]
}

/** Build an editor target that mirrors the active warm-up rows, including manually added rows. */
export function warmupConfigForEntry(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target)
  const configured = Array.isArray(target.warmup) ? target.warmup : []
  const rows = (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => isWarmupRow(set))
  const warmup = rows.map((set, index) => {
    const mode = modeForSet(set, target)
    const derived = {
      phase: 'warmup',
      mode,
      ...(mode === 'time' ? { sec: positiveInt(set.sec, 30) } : { reps: positiveInt(set.r, 8) }),
      weightPrescription: { kind: 'fixed', weight: positive(set.w, 0) },
      ...(set.restSec != null ? { restSec: set.restSec } : {})
    }
    return { ...derived, ...objectOf(configured[index] || configured[configured.length - 1]), phase: 'warmup' }
  })
  return { ...target, warmup }
}

/** Apply a phase-config save to an active entry without rewriting completed warm-ups or work rows. */
export function applyWarmupConfigToEntry(entry = {}, config = {}, history = [], increment = 0, context = {}) {
  const source = objectOf(entry)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const oldWarmups = sets.filter(set => isWarmupRow(set))
  const workSets = sets.filter(set => isWorkRow(set))
  const target = { ...objectOf(source.target), ...objectOf(config) }
  const configuredWarmups = prependWarmupSets(target, workSets, history, increment, context)
    .filter(set => isWarmupRow(set))
  const completedCount = oldWarmups.filter(set => set.done === true).length
  const finalCount = Math.max(configuredWarmups.length, completedCount)
  const pendingWanted = finalCount - completedCount
  const rebuiltWarmups = []
  let generatedIndex = 0
  let pendingKept = 0
  oldWarmups.forEach(oldWarmup => {
    if (oldWarmup.done === true) {
      rebuiltWarmups.push(oldWarmup)
      generatedIndex++
    } else if (pendingKept < pendingWanted) {
      const generated = configuredWarmups[generatedIndex++] || configuredWarmups[configuredWarmups.length - 1]
      if (generated) rebuiltWarmups.push(generated)
      pendingKept++
    }
  })
  while (rebuiltWarmups.length < finalCount && generatedIndex < configuredWarmups.length) {
    rebuiltWarmups.push(configuredWarmups[generatedIndex++])
  }
  return {
    ...source,
    target,
    sets: [...rebuiltWarmups, ...workSets]
  }
}

/**
 * Merge one Work-settings save into a target without leaving a stale load union behind.
 *
 * `loadMode` is an editor-only discriminator. When it explicitly says fixed or percentage,
 * remove the legacy/canonical load aliases first and restore only the selected canonical shape.
 * Without that discriminator this remains a normal partial merge, so callers that only change
 * reps/rest can preserve an already-frozen percentage prescription.
 */
export function mergeWorkConfigIntoTarget(existing = {}, config = {}) {
  const base = objectOf(existing)
  const patch = objectOf(config)
  const { loadMode, ...fields } = patch
  const merged = { ...base, ...fields }
  if (fields.kind === 'fixed' || fields.kind === 'amrap') {
    for (const alias of ['targetKind', 'targetType', 'type', 'amrap', 'isAmrap']) delete merged[alias]
    if (fields.kind === 'fixed') {
      delete merged.amrapMinReps
      delete merged.amrapMaxSec
      delete merged.minReps
      delete merged.cap
      delete merged.maxDurationSec
      delete merged.maxSec
    } else if (fields.mode === 'reps') {
      delete merged.amrapMaxSec
      delete merged.minReps
      delete merged.cap
      delete merged.maxDurationSec
      delete merged.maxSec
    } else if (fields.mode === 'time') {
      delete merged.amrapMinReps
      delete merged.minReps
      delete merged.cap
      delete merged.maxDurationSec
      delete merged.maxSec
      if (!Object.prototype.hasOwnProperty.call(fields, 'amrapMaxSec')) delete merged.amrapMaxSec
    }
  }
  if (!['fixed', 'percentage', 'current_percentage'].includes(loadMode)) return merged

  const scrubbed = withoutWorkLoad(merged)
  if (loadMode === 'fixed') return {
    ...scrubbed,
    weight: positive(fields.weight, 0)
  }

  const prescription = normalizeWeightPrescription(fields, fields.weight)
    || normalizeWeightPrescription(base, base.weight)
  return prescription
    ? { ...scrubbed, weightPrescription: prescription }
    : scrubbed
}

function samePercentagePrescription(left, right) {
  if (left?.kind !== right?.kind) return false
  if (left?.kind === 'percentage') return left.source === right.source && left.percent === right.percent && left.fallbackWeight === right.fallbackWeight
  return false
}

export function applyWorkConfigToEntry(entry = {}, config = {}, history = [], increment = 0, context = {}) {
  const source = objectOf(entry)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const warmups = sets.filter(set => isWarmupRow(set))
  const workSets = sets.filter(set => isWorkRow(set))
  const configSource = objectOf(config)
  const explicitLoadMode = ['percentage', 'current_percentage', 'fixed'].includes(configSource.loadMode)
    ? configSource.loadMode
    : null
  const existingPrescription = normalizeWeightPrescription(source.target, source.target?.weight)
  const submittedPrescription = normalizeWeightPrescription(configSource, configSource.weight)
  const preserveFrozenPercentage = (explicitLoadMode === 'percentage' || explicitLoadMode === 'current_percentage')
    && samePercentagePrescription(submittedPrescription, existingPrescription)
    && (source.target?.resolvedWeight != null || source.target?.weight != null)
  let target = mergeWorkConfigIntoTarget(source.target, configSource)
  let rowTarget = target
  if (normalizeWeightPrescription(target, target.weight)?.kind === 'percentage') {
    if ((explicitLoadMode === 'percentage' || explicitLoadMode === 'current_percentage') && !preserveFrozenPercentage) {
      const resolvedWeight = resolveTargetLoad(target, history, increment, context)
      target = { ...target, weight: resolvedWeight, resolvedWeight }
      rowTarget = { ...target, weightPrescription: { kind: 'fixed', weight: resolvedWeight } }
    } else if (source.target?.resolvedWeight != null || source.target?.weight != null) {
      // A partial editor update preserves the already-frozen percentage result. Rebuild rows
      // from that frozen value without silently requiring a new history lookup.
      const frozenWeight = source.target.resolvedWeight != null ? source.target.resolvedWeight : source.target.weight
      rowTarget = { ...target, weight: frozenWeight, weightPrescription: { kind: 'fixed', weight: frozenWeight } }
      target = { ...target, weight: frozenWeight, resolvedWeight: frozenWeight }
    }
  }
  const count = Math.max(1, Math.round(Number(target.sets) || workSets.length || 3))
  const completedCount = workSets.filter(set => set.done === true).length
  const finalCount = Math.max(count, completedCount)
  const unfinishedWanted = finalCount - completedCount
  const roleAware = isAmrapEntry(source)
    || workSets.some(set => {
      const sourceIndex = sets.indexOf(set)
      return isAmrapRoleEligibleSet(source, sourceIndex)
        && Object.prototype.hasOwnProperty.call(set, 'amrapRole')
    })
  const sourceRoles = roleAware
    ? workSets.map(set => amrapRoleForSet(source, sets.indexOf(set)) || 'none')
    : []
  const preparedWorkRow = (set, role = null, sourceSet = null) => {
    const out = { ...set }
    if (role != null && isAmrapRoleEligibleSet({ target, sets: [out] }, 0)) out.amrapRole = role
    else delete out.amrapRole
    const originalMode = modeForSet(sourceSet || set, source.target || source)
    const nextMode = modeForSet(out, target)
    const sourceRole = role || (sourceSet && !roleAware
      ? amrapRoleForSet(source, sets.indexOf(sourceSet))
      : null)
    if (sourceSet?.amrapTarget != null && originalMode === nextMode
      && (sourceRole === 'amrap' || sourceRole === 'progression')
      && isAmrapRoleEligibleSet({ target, sets: [out] }, 0)) out.amrapTarget = sourceSet.amrapTarget
    else if (role && role !== 'none') out.amrapTarget = seedAmrapTargetForSet({ target, sets: [set] }, 0)
    else delete out.amrapTarget
    return out
  }
  const rebuilt = []
  let unfinishedSeen = 0
  workSets.forEach((set, index) => {
    if (set.done === true) {
      const sourceIndex = sets.indexOf(set)
      if (!isAmrapRoleEligibleSet(source, sourceIndex)) rebuilt.push(preparedWorkRow(set))
      else rebuilt.push(roleAware && !Object.prototype.hasOwnProperty.call(set, 'amrapRole')
        ? { ...set, amrapRole: sourceRoles[index] }
        : set)
      return
    }
    if (unfinishedSeen >= unfinishedWanted) return
    unfinishedSeen++
    rebuilt.push(preparedWorkRow({
      ...setForTarget(rowTarget, 'work', history, increment),
      ...(set.programmeRowId != null ? { programmeRowId: set.programmeRowId } : {})
    }, roleAware ? sourceRoles[index] : null, set))
  })
  while (rebuilt.length < finalCount) rebuilt.push(preparedWorkRow(
    setForTarget(rowTarget, 'work', history, increment),
    roleAware ? 'none' : null
  ))
  const effectivePolicy = target.prog || target.progressionPolicy || source.plan?.policy || null
  if (effectivePolicy != null) target = { ...target, prog: effectivePolicy, progressionPolicy: effectivePolicy }
  return demoteProgressionRolesForPolicy({
    ...source,
    target,
    plan: source.plan && effectivePolicy != null ? { ...source.plan, policy: effectivePolicy } : source.plan,
    sets: [...warmups, ...rebuilt]
  })
}

const isPercentageTarget = target => normalizeWeightPrescription(target, target?.weight)?.kind === 'percentage'

/** Apply a progression plan without replacing a load resolved from a percentage prescription. */
export function sessionConfigFor(target = {}, plan = {}) {
  const source = target && typeof target === 'object' ? target : {}
  const out = { ...source }
  if (plan?.policy) out.progressionPolicy = plan.policy
  // Greyskull is the backwards-compatible routine default. Freeze that decision into the
  // session target so finished history still knows that its final work row was AMRAP. An
  // explicit fixed target (or explicit `amrap: false` from an older plan) wins.
  if (out.kind == null && out.targetKind == null && out.amrap !== false && plan?.policy === 'greyskull') out.kind = 'amrap'
  else if (out.kind == null && out.targetKind == null && out.amrap === false) out.kind = 'fixed'
  if (!isPercentageTarget(source) && plan?.weight != null) out.weight = plan.weight
  if (plan?.reps != null) out.reps = plan.reps
  if (plan?.sec != null) out.sec = plan.sec
  if (plan?.amrapMissPolicy) out.amrapMissPolicy = plan.amrapMissPolicy
  if (normalizeTargetKind(out.kind ?? out.targetKind, 'fixed') === 'amrap'
    && normalizeMode(out.mode, out.sec != null ? 'time' : 'reps') === 'reps') {
    const minimum = amrapMinRepsFor(out, out.reps)
    if (minimum != null) {
      out.amrapMinReps = minimum
      // `reps` is retained as a read-only legacy alias; all consumers use amrapMinReps.
      out.reps = minimum
    }
  }
  if (isPercentageTarget(source) && out.resolvedWeight == null) out.resolvedWeight = out.weight
  return hasSelectedWorkPhase(source) ? out : withoutWorkLoad(out)
}

/** Keep the progression explanation while preventing its weight field from overriding a resolved load. */
export function sessionPlanFor(target = {}, plan) {
  if (!plan) return plan
  if (!hasSelectedWorkPhase(target)) return withoutWorkLoad(plan)
  if (!isPercentageTarget(target) || plan.weight == null) return plan
  return { ...plan, weight: undefined }
}

export function isAmrapEntry(entry = {}) {
  if (Array.isArray(entry?.sets) && entry.sets.some((set, index) => isAmrapRoleEligibleSet(entry, index)
    && (set.amrapRole === 'amrap' || set.amrapRole === 'progression'))) return true
  const target = entry?.target || {}
  const mode = modeForSet({}, target)
  if (mode !== 'reps' && mode !== 'time') return false
  const explicit = target.kind ?? target.targetKind
  if (explicit === 'fixed' || target.amrap === false) return false
  if (explicit === 'amrap' || target.amrap === true) return true
  return target.kind === 'amrap' || target.targetKind === 'amrap'
    || target.prog === 'greyskull' || entry?.plan?.policy === 'greyskull'
}

export const AMRAP_AWARE_POLICIES = ['greyskull']

/** The edited target is authoritative; persisted plan metadata is a legacy fallback. */
export function effectiveAmrapPolicyForEntry(entry = {}) {
  const target = objectOf(entry?.target || entry)
  return target.prog || target.progressionPolicy || entry?.plan?.policy || null
}

export function isAmrapProgressionAllowed(entry = {}) {
  return AMRAP_AWARE_POLICIES.includes(effectiveAmrapPolicyForEntry(entry))
}

/** Policy changes retain AMRAP logging intent while removing progression authority. */
export function demoteProgressionRolesForPolicy(entry = {}) {
  const source = objectOf(entry)
  const sets = Array.isArray(source.sets) ? source.sets : []
  if (effectiveAmrapPolicyForEntry(source) == null || isAmrapProgressionAllowed(source)) {
    return { ...source, sets: [...sets] }
  }
  return { ...source, sets: sets.map(set => set?.amrapRole === 'progression'
    ? { ...set, amrapRole: 'amrap' }
    : set) }
}

/** Row role with backwards-compatible final-work-set fallback for legacy AMRAP entries. */
export function amrapRoleForSet(entry = {}, setIndex) {
  return resolveAmrapRoleForSet(entry, setIndex, isAmrapEntry(entry))
}

/** Canonical per-row AMRAP target, with legacy entry-level fallback. */
export function amrapTargetForSet(entry = {}, setIndex) {
  return resolveAmrapTargetForSet(entry, setIndex)
}

/** Restore routine-saved row targets by work-row ordinal without touching actual results. */
export function applyPersistedAmrapTargets(entry = {}, targets = []) {
  const source = objectOf(entry)
  if (!Array.isArray(targets)) return { ...source, sets: (source.sets || []).map(set => ({ ...set })) }
  let workIndex = 0
  const sets = (Array.isArray(source.sets) ? source.sets : []).map((set, index) => {
    const out = { ...set }
    if (!isWorkRow(set)) return out
    const value = Number(targets[workIndex++])
    const role = isAmrapRoleEligibleSet(source, index) ? amrapRoleForSet(source, index) : null
    if ((role === 'amrap' || role === 'progression') && Number.isFinite(value) && value > 0) out.amrapTarget = Math.max(1, Math.round(value))
    return out
  })
  return { ...source, sets }
}

function seedAmrapTargetForSet(entry = {}, setIndex) {
  const set = Array.isArray(entry.sets) ? entry.sets[setIndex] || {} : {}
  // An unfinished row still contains its prescribed r/sec. Once a legacy row is completed,
  // prefer the entry-level target so its actual result cannot silently become the target.
  if (set.done !== true) {
    const mode = modeForSet(set, entry.target || entry)
    const prescribed = mode === 'time' ? Number(set.sec) : Number(set.r)
    if (Number.isFinite(prescribed) && prescribed > 0) return Math.max(1, Math.round(prescribed))
  }
  return resolveAmrapTargetForSet(entry, setIndex)
}

/** Pure three-state role cycle; promotion demotes the previous driver to ordinary AMRAP. */
export function cycleAmrapRole(entry = {}, setIndex) {
  const source = objectOf(entry)
  const sets = Array.isArray(source.sets) ? source.sets : []
  if (!sets[setIndex] || !isAmrapRoleEligibleSet(source, setIndex)) return { ...source, sets: sets.map(set => ({ ...set })) }
  const policyEntry = demoteProgressionRolesForPolicy(source)
  const progressionAllowed = isAmrapProgressionAllowed(source)
  const materialized = policyEntry.sets.map((set, index) => isAmrapRoleEligibleSet(policyEntry, index)
    ? { ...set, amrapRole: set.amrapRole || amrapRoleForSet(source, index) || 'none' }
    : { ...set })
  const current = materialized[setIndex].amrapRole
  if (current === 'none') materialized[setIndex].amrapRole = 'amrap'
  else if (current === 'amrap' && progressionAllowed) {
    materialized.forEach((set, index) => {
      if (index !== setIndex && set.amrapRole === 'progression') set.amrapRole = 'amrap'
    })
    materialized[setIndex].amrapRole = 'progression'
  } else materialized[setIndex].amrapRole = 'none'
  if (materialized[setIndex].amrapRole !== 'none' && materialized[setIndex].amrapTarget == null) {
    materialized[setIndex].amrapTarget = seedAmrapTargetForSet(source, setIndex)
  }
  return { ...source, sets: materialized }
}

/** Explicit ordinary/starred AMRAP rows, with the legacy final-work-row fallback. */
export function isAmrapResult(entry = {}, setIndex) {
  if (!isAmrapEntry(entry) || !Array.isArray(entry.sets) || !entry.sets[setIndex]) return false
  if (!isAmrapRoleEligibleSet(entry, setIndex)) return false
  const role = amrapRoleForSet(entry, setIndex)
  return role === 'amrap' || role === 'progression'
}

export function amrapCapFor(_entry = {}, _setIndex) {
  // Kept as a compatibility export for callers from the cap-based implementation. Rep AMRAP
  // never has a maximum, so this intentionally always returns null.
  return null
}

/** Timer duration for one row; an AMRAP safety cap belongs only to the final work row. */
export function timerDurationForSet(entry = {}, setIndex) {
  const set = Array.isArray(entry.sets) ? entry.sets[setIndex] || {} : {}
  const target = objectOf(entry.target || entry)
  const isResult = isAmrapResult(entry, setIndex)
  return timerDurationFor({
    ...target,
    sec: set.sec ?? target.sec ?? 45,
    kind: isResult ? target.kind : 'fixed',
    amrapMaxSec: isResult ? target.amrapMaxSec : null
  })
}

/** Return a completed starred AMRAP result, or the last ordinary AMRAP when no driver exists. */
export function amrapResultFor(entry = {}) {
  if (!isAmrapEntry(entry) || !Array.isArray(entry.sets)) return null
  const progressionIndex = entry.sets.findIndex((_set, index) => isAmrapRoleEligibleSet(entry, index) && amrapRoleForSet(entry, index) === 'progression')
  const index = progressionIndex >= 0
    ? progressionIndex
    : entry.sets.findLastIndex((_set, setIndex) => isAmrapRoleEligibleSet(entry, setIndex) && isAmrapResult(entry, setIndex))
  if (index < 0) return null
  const set = entry.sets[index]
  if (!set || set.done !== true) return null
  const target = entry.target || entry
  const mode = modeForSet(set, target)
  if (mode !== 'reps' && mode !== 'time') return null
  const actual = mode === 'time' ? positive(set.sec ?? set.seconds ?? set.actualSec, 0) : positive(set.r ?? set.reps ?? set.actualReps, 0)
  const targetValue = amrapTargetForSet(entry, index)
  return { index, phase: 'work', mode, actual, target: targetValue, amrapMinReps: mode === 'reps' ? targetValue : null }
}

/** A fixed timer ends at its target; a timed AMRAP may use an explicit duration limit. */
export function timerDurationFor(target = {}) {
  const sec = positiveInt(target.sec, 0)
  const kind = normalizeTargetKind(target.kind ?? target.targetKind, 'fixed')
  const maxSec = positiveInt(target.amrapMaxSec, 0)
  return Math.max(1, kind === 'amrap' && maxSec > 0 ? Math.max(sec, maxSec) : sec)
}

export function hasWorkRows(entry = {}) {
  return Array.isArray(entry.sets) && entry.sets.some(set => isWorkRow(set))
}

/** Completed-state-independent work rows whose authoritative mode matches the requested mode. */
export function workRowsForMode(entry = {}, mode = 'reps') {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const expectedMode = normalizeMode(mode, 'reps')
  return (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => isWorkRow(set) && modeForSet(set, target) === expectedMode)
}

// Heaviest weight lifted to the FULL target in this entry: done work sets that hit
// their goal (reps >= target reps, or time held >= target sec) count. A set where the
// last few reps were missed does not set the default weight. Falls back to all done
// sets when nothing hit the full target, so there is still a sensible default.
export function bestFullSetWeight(entry = {}, target = null) {
  const rows = workRowsForMode(entry, 'reps').filter(s => s.done)
  if (!rows.length) return 0
  const t = objectOf(target || entry?.target || entry)
  const goal = t.reps > 0 ? t.reps : 0
  const full = goal > 0 ? rows.filter(s => (s.r || 0) >= goal) : []
  const pool = full.length ? full : rows
  return Math.max(0, ...pool.map(s => s.w || 0))
}

export function shouldConfirmWorkingWeight(entry = {}, _mode = null) {
  // The row mode is authoritative. A mixed entry may open this sheet because it contains a
  // reps work row, but a timed-only entry never does even when its target still says `reps`.
  return workRowsForMode(entry, 'reps').length > 0
}

/** Guard asynchronous timer callbacks against finish, discard, navigation, and deletion. */
export function canApplyTimedResult(active, workoutId, entryIdx, setIdx) {
  if (!active || active.id !== workoutId || !Array.isArray(active.entries)) return false
  const entry = active.entries[entryIdx]
  const set = entry && Array.isArray(entry.sets) ? entry.sets[setIdx] : null
  return !!set && set.done !== true
}

/** Remove a set, or remove the exercise when it was the last remaining set. */
// Remove a whole exercise from the active session. The set rows' "Remove exercise" action
// (single-set exercises) lands here instead of silently doing nothing.
export function removeActiveExercise(active, entryIdx) {
  if (!active || !Array.isArray(active.entries)) return
  if (entryIdx < 0 || entryIdx >= active.entries.length) return
  active.entries.splice(entryIdx, 1)
  if (active.cur >= active.entries.length) active.cur = Math.max(0, active.entries.length - 1)
}

export function removeActiveSet(active, entryIdx, setIdx, stopTimersForRemoval = () => {}) {
  if (!active || !Array.isArray(active.entries)) return { removed: false, removedExercise: false }
  const entry = active.entries[entryIdx]
  if (!entry || !Array.isArray(entry.sets) || !entry.sets[setIdx]) return { removed: false, removedExercise: false }
  stopTimersForRemoval()
  if (entry.sets.length === 1) {
    active.entries.splice(entryIdx, 1)
    active.cur = Math.min(Math.max(0, Number(active.cur) || 0), Math.max(0, active.entries.length - 1))
    return { removed: true, removedExercise: true }
  }
  entry.sets.splice(setIdx, 1)
  return { removed: true, removedExercise: false }
}

/** Stop asynchronous timer work before changing the active exercise cursor. */
export function navigateActiveExercise(active, nextCur, stopTimers = () => {}) {
  const next = Number(nextCur)
  if (!active || !Array.isArray(active.entries) || !Number.isInteger(next)
    || next < 0 || next >= active.entries.length) return false
  stopTimers()
  active.cur = next
  return true
}
