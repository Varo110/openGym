// User-owned exercise annotations and routine-owned group instructions.
// Catalogue records deliberately do not participate: personal data belongs to account state.

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const stringOf = value => typeof value === 'string' ? value : ''
const owns = (value, key) => Object.prototype.hasOwnProperty.call(objectOf(value), key)

export function normalizeExerciseAnnotations(input, customEx = []) {
  const source = objectOf(input)
  const out = {}
  for (const [id, raw] of Object.entries(source)) {
    if (!id || !owns(raw, 'cues') || typeof raw.cues !== 'string') continue
    out[id] = { cues: raw.cues }
  }
  // A legacy customEx.cues value remains readable for one schema generation. Canonical
  // account annotations win and the legacy source is left untouched for old clients.
  for (const custom of Array.isArray(customEx) ? customEx : []) {
    const id = custom?.id
    const cues = stringOf(custom?.cues)
    if (id && cues && !out[id]) out[id] = { cues }
  }
  return out
}

export function cuesForExercise(state, id) {
  const canonical = objectOf(state?.exerciseAnnotations)[id]
  if (typeof canonical?.cues === 'string') return canonical.cues
  // Only account-owned custom exercises get the one-release legacy fallback. A built-in
  // catalogue record must never become an implicit source of private Personal cues.
  const custom = (Array.isArray(state?.customEx) ? state.customEx : [])
    .find(candidate => candidate?.id === id)
  return typeof custom?.cues === 'string' ? custom.cues : ''
}

function validGroups(exercises) {
  const valid = new Set()
  const rows = Array.isArray(exercises) ? exercises : []
  for (let index = 1; index < rows.length; index++) {
    const id = rows[index]?.sg
    if (id && rows[index - 1]?.sg === id) valid.add(id)
  }
  return valid
}

function cleanEntry(entry, valid) {
  const out = { ...objectOf(entry) }
  if (out.sg && !valid.has(out.sg)) delete out.sg
  return out
}

function cleanGroup(value) {
  const source = objectOf(value)
  const kind = source.kind === 'complex' ? 'complex' : 'superset'
  const label = stringOf(source.label)
  const cues = stringOf(source.cues)
  return { kind, ...(label ? { label } : {}), ...(cues ? { cues } : {}) }
}

export function normalizeGroupMeta(exercises, input) {
  const valid = validGroups(exercises)
  const source = objectOf(input)
  const out = {}
  for (const id of valid) out[id] = cleanGroup(source[id])
  return out
}

export function normalizeRoutineGroupMeta(input) {
  const source = objectOf(input)
  const valid = validGroups(source.ex)
  const ex = (Array.isArray(source.ex) ? source.ex : []).map(entry => cleanEntry(entry, valid))
  const groupMeta = normalizeGroupMeta(ex, source.groupMeta)
  const out = { ...source, ex }
  if (Object.keys(groupMeta).length) out.groupMeta = groupMeta
  else delete out.groupMeta
  return out
}
