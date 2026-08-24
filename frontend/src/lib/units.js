// Pure helpers for the canonical weight representation.
//
// Persisted weights are kilograms. A profile's display unit is a boundary concern: callers use
// kgFromStored when accepting a value in a profile/file unit and storedFromKg when rendering it.
// This module deliberately has no React, store, or browser dependencies.

export const CANONICAL_UNIT = 'kg'
export const LB_TO_KG = 0.45359237
export const KG_TO_LB = 1 / LB_TO_KG
export const UNIT_SCHEMA_VERSION = 1

const UNIT_FIELDS = new Set([
  'unit', 'u', 'weightUnit', 'storedUnit', 'weight_unit', 'loadUnit',
  'targetUnit', 'bodyweightUnit', 'bwUnit',
])
const WEIGHT_FIELDS = new Set([
  'w', 'weight', 'topW', 'fallbackWeight', 'resolvedWeight',
  'bw', 'workW', 'workWeight', 'workResolvedWeight', 'loadFallback', 'fallback'
])
const MODES = new Set(['reps', 'time', 'cardio'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isPounds(unit) {
  return /^(?:lb|lbs|pound|pounds)$/i.test(String(unit ?? '').trim())
}

/** Normalize the supported display/source spellings without making unknown values hazardous. */
export function normalizeUnit(unit) {
  return isPounds(unit) ? 'lb' : CANONICAL_UNIT
}

/** Convert a stored/display weight into canonical kilograms. Unknown units are treated as kg. */
export function kgFromStored(value, unit = CANONICAL_UNIT) {
  const n = numeric(value)
  if (n === null) return value
  return isPounds(unit) ? n * LB_TO_KG : n
}

/** Convert canonical kilograms to a profile/file unit without display rounding. */
export function storedFromKg(value, unit = CANONICAL_UNIT) {
  const n = numeric(value)
  if (n === null) return value
  return isPounds(unit) ? n / LB_TO_KG : n
}

/**
 * Round a value for display controls before passing it to fmtNum.
 *
 * The app uses half-kilogram display increments and whole-pound increments. The larger 2.5 kg
 * and 5 lb progression jumps are policy increments, not a reason to lose precision in display
 * conversion.
 */
export function unitRound(value, unit = CANONICAL_UNIT) {
  const n = numeric(value)
  if (n === null) return value
  const step = isPounds(unit) ? 1 : 0.5
  return Math.round(n / step) * step
}

/** Bodyweight is already canonical after the state migration; the display unit is irrelevant. */
export function kgBodyweight(bwKg, _unit) {
  return bwKg
}

function unitOf(record, inheritedUnit) {
  if (isRecord(record)) {
    for (const key of UNIT_FIELDS) {
      if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') {
        return record[key]
      }
    }
  }
  return inheritedUnit
}

function convertWeight(value, unit) {
  return kgFromStored(value, unit)
}

function modeOf(record, inheritedMode) {
  if (!isRecord(record)) return inheritedMode
  if (MODES.has(record.mode)) return record.mode
  if (isRecord(record.target) && MODES.has(record.target.mode)) return record.target.mode
  if (record.sec != null || record.seconds != null || record.durationSec != null) return 'time'
  if (record.min != null || record.minutes != null || record.speed != null) return 'cardio'
  return inheritedMode
}

function migrateNode(value, inheritedUnit = CANONICAL_UNIT, inheritedMode) {
  if (Array.isArray(value)) return value.map(item => migrateNode(item, inheritedUnit, inheritedMode))
  if (!isRecord(value)) return value

  const localUnit = unitOf(value, inheritedUnit)
  const localMode = modeOf(value, inheritedMode)
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    // Unit metadata is a one-time migration input, never a field we write into canonical state.
    if (UNIT_FIELDS.has(key)) continue

    if (key === 'vol') {
      // Volume is recomputed from canonical rows below when possible. Keep a converted fallback
      // for legacy records that only carried the derived number.
      out[key] = numeric(child) === null ? child : convertWeight(child, localUnit)
      continue
    }

    // `inc` is a load increment for reps, but seconds for timed progression. Converting a timed
    // increment as a weight changes the user's progression rule on every load and is not
    // recoverable after the unit stamp is consumed.
    if (key === 'inc' && numeric(child) !== null) {
      out[key] = localMode === 'time' ? child : convertWeight(child, localUnit)
      continue
    }

    if (WEIGHT_FIELDS.has(key) && numeric(child) !== null) {
      out[key] = convertWeight(child, localUnit)
      continue
    }

    // A direct numeric `bodyweight` is a weigh-in; the boolean bodyweight flag is not a load.
    if (key === 'bodyweight' && numeric(child) !== null) {
      out[key] = convertWeight(child, localUnit)
      continue
    }

    out[key] = migrateNode(child, localUnit, localMode)
  }

  if (Array.isArray(out.entries)) {
    const rows = out.entries.flatMap(entry => Array.isArray(entry?.sets) ? entry.sets : [])
    if (rows.length) {
      out.vol = rows.reduce((total, set) => {
        if (!set || set.done !== true) return total
        const w = numeric(set.w)
        const reps = numeric(set.r)
        return w === null || reps === null ? total : total + w * reps
      }, 0)
    }
  }

  return out
}

/**
 * Convert legacy workout records to canonical kilograms without mutating the input.
 *
 * Missing unit metadata is deliberately interpreted as kg: that is the representation used by
 * every pre-canonical openGym profile. Existing unit metadata may live on a workout, entry, set,
 * target, warm-up row, or weight prescription; it is consumed and removed. Therefore the result
 * has no per-set unit stamps and running this function again is a no-op.
 */
export function migrateWorkoutsToKg(workouts, inheritedUnit = CANONICAL_UNIT) {
  if (!Array.isArray(workouts)) return []
  return workouts.map(workout => migrateNode(workout, inheritedUnit))
}

const clone = value => JSON.parse(JSON.stringify(value))

/**
 * Normalize the complete persisted profile at the storage boundary.
 *
 * Pre-canonical backups used the profile's selected unit as their storage unit, while canonical
 * profiles carry `unitsVersion` and always store weights in kg. Explicit nested stamps win over
 * the legacy profile default in both cases. The output keeps `unit` as the display preference,
 * removes consumed stamps, and is safe to run repeatedly.
 */
export function migrateStateToKg(state) {
  if (!isRecord(state)) return {}
  const out = clone(state)
  const profileUnit = normalizeUnit(state.unit)
  const isCanonical = Number(state.unitsVersion) >= UNIT_SCHEMA_VERSION
  const legacyUnit = isCanonical ? CANONICAL_UNIT : profileUnit

  out.unit = profileUnit
  out.unitsVersion = UNIT_SCHEMA_VERSION
  out.targetW = numeric(state.targetW) === null
    ? state.targetW
    : kgFromStored(state.targetW, state.targetUnit || legacyUnit)
  delete out.targetUnit
  out.bodyweight = Array.isArray(state.bodyweight)
    ? migrateNode(state.bodyweight, legacyUnit)
    : []
  out.exWeights = isRecord(state.exWeights)
    ? migrateNode(state.exWeights, legacyUnit)
    : {}
  out.routines = Array.isArray(state.routines)
    ? migrateNode(state.routines, legacyUnit)
    : []
  out.workouts = migrateWorkoutsToKg(state.workouts, legacyUnit)
  out.active = state.active == null ? null : migrateNode(state.active, legacyUnit)
  return out
}

export const normalizeStateToKg = migrateStateToKg

// Descriptive aliases are useful to boundary callers while the canonical names remain the
// public contract for this slice.
export const toKg = kgFromStored
export const fromKg = storedFromKg
