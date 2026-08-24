// Keep the API reminder resolver aligned with frontend/src/lib/history.js. The API only needs
// the first effective routine, but resolving the ordered list here makes the fallback contract
// explicit and keeps stale or malformed overrides from becoming accidental rest days.
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const asRoutineIds = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]

const validRoutineIds = (S, value) => {
  const known = new Set((S?.routines || []).map(r => r && r.id).filter(Boolean))
  return [...new Set(asRoutineIds(value).filter(id => id && id !== 'rest' && known.has(id)))]
}

export function effectiveRoutineIds(S, iso) {
  const dayPlan = S?.dayPlan || {}
  const hasOverride = hasOwn(dayPlan, iso)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const raw = hasOverride ? dayPlan[iso] : S?.week?.[wd]
  if (asRoutineIds(raw).includes('rest')) return []

  const ids = validRoutineIds(S, raw)
  if (ids.length || !hasOverride || (Array.isArray(raw) && raw.length === 0)) return ids
  return validRoutineIds(S, S?.week?.[wd])
}

export function effectiveRoutineId(S, iso) {
  return effectiveRoutineIds(S, iso)[0] || null
}