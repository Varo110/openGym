import { EXDB } from './exercises.js'
import { keyOf, matchExercise, wordsOf } from './import-csv.js'
import { cachedWeightFor, normalizeWeightUnit } from './workout-model.js'

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const CATALOGUE_IDS = new Set(EXDB.map(ex => ex.id))
const CATALOGUE = EXDB.map(ex => {
  const words = wordsOf(ex.n)
  return { id: ex.id, words, set: new Set(words), key: keyOf(ex.n) }
})

function addUnique(out, id) {
  if (id && CATALOGUE_IDS.has(id) && !out.includes(id)) out.push(id)
}

/**
 * Return the closest built-in exercise ids for a custom/imported name.
 *
 * The first pass is deliberately conservative: aliases and the same word-bag/unique
 * contains-all rules used by the CSV importer get priority. The final pass only fills
 * remaining slots with a meaningful token overlap; a single incidental common word is
 * not enough to manufacture a suggestion for a long name.
 */
export function suggestMatches(name) {
  const queryWords = wordsOf(name)
  const querySet = new Set(queryWords)
  if (!querySet.size) return []
  const queryKey = keyOf(name)
  const out = []

  // Curated importer aliases are the strongest signal for names that the catalogue does
  // not spell the same way (for example, "ab wheel rollout" -> "wheel rollerout").
  addUnique(out, matchExercise(name))

  for (const candidate of CATALOGUE) {
    if (candidate.key === queryKey) addUnique(out, candidate.id)
  }

  // A lone generic token such as "press" or "row" is too ambiguous to expand into
  // longer catalogue names. Curated aliases and exact one-word catalogue matches above
  // remain eligible because they are explicit rather than overlap guesses.
  if (querySet.size === 1) return out

  const contains = CATALOGUE
    .filter(candidate => {
      if (candidate.set.size < querySet.size) return false
      if (candidate.words.length - querySet.size > 2) return false
      for (const word of querySet) if (!candidate.set.has(word)) return false
      return true
    })
    .sort((a, b) =>
      (a.words.length - querySet.size) - (b.words.length - querySet.size) ||
      a.id.localeCompare(b.id)
    )
  for (const candidate of contains) {
    addUnique(out, candidate.id)
    if (out.length === 3) return out
  }

  // Token overlap is intentionally a fallback, not a general fuzzy matcher. Jaccard
  // similarity rewards both coverage of the custom name and a short catalogue name, while
  // the overlap floor rejects names that happen to share only "press", "row", etc.
  const overlap = CATALOGUE
    .filter(candidate => !out.includes(candidate.id))
    .map(candidate => {
      let common = 0
      for (const word of querySet) if (candidate.set.has(word)) common++
      const score = common / (querySet.size + candidate.set.size - common)
      return { candidate, common, score }
    })
    .filter(({ candidate, common, score }) => {
      if (!common) return false
      if (querySet.size > 1 && common < 2 && candidate.words.length > 3) return false
      return score >= 0.34
    })
    .sort((a, b) => b.score - a.score || b.common - a.common || a.candidate.id.localeCompare(b.candidate.id))

  for (const { candidate } of overlap) {
    addUnique(out, candidate.id)
    if (out.length === 3) break
  }
  return out
}

function mappingEntries(mapping) {
  if (mapping instanceof Map) return [...mapping.entries()]
  return Object.entries(objectOf(mapping) || {})
}

function usableMoves(state, mapping) {
  const customIds = new Set((Array.isArray(state.customEx) ? state.customEx : [])
    .map(ex => ex && ex.id)
    .filter(Boolean))
  return mappingEntries(mapping).filter(([from, to]) =>
    typeof from === 'string' && typeof to === 'string' && from !== to &&
    customIds.has(from) && CATALOGUE_IDS.has(to)
  )
}

function remapId(reference, moves) {
  if (objectOf(reference) && moves.has(reference.id)) reference.id = moves.get(reference.id)
}

function remapEntries(entries, moves) {
  if (!Array.isArray(entries)) return entries
  entries.forEach(entry => {
    if (!objectOf(entry)) return
    remapId(entry, moves)
    remapId(entry.target, moves)
  })
  return entries
}

function recordWins(candidate, current, expectedUnit) {
  const candidateUnit = normalizeWeightUnit(candidate)
  const currentUnit = normalizeWeightUnit(current)

  if (candidateUnit !== currentUnit) {
    const expected = normalizeWeightUnit(expectedUnit)
    if (candidateUnit && candidateUnit === expected) return true
    if (currentUnit && currentUnit === expected) return false
    // An explicitly tagged cache remains usable in its own unit; an untagged cache is
    // deliberately unreadable. When neither record matches the profile, keep the existing
    // catalogue cache rather than guessing between two different units.
    return !!candidateUnit && !currentUnit
  }
  if (!candidateUnit) return false

  const candidateWeight = cachedWeightFor(candidate, candidateUnit)
  const currentWeight = cachedWeightFor(current, currentUnit)
  if (candidateWeight !== currentWeight) return candidateWeight > currentWeight
  return String(candidate?.d ?? '') > String(current?.d ?? '')
}

/**
 * Purely merge selected custom exercises into catalogue ids.
 *
 * The state is JSON-shaped persisted data, so cloning at the boundary keeps the caller's
 * object untouched and also preserves every unrelated user-owned field. Workout dates and
 * timestamps stay untouched: only exercise references and weight-cache records move.
 */
export function mergeCustomExercises(state, mapping) {
  const source = objectOf(state)
  if (!source) return clone(state)
  const next = clone(source)
  const moves = new Map(usableMoves(next, mapping))
  if (!moves.size) return next

  const remapWorkout = workout => {
    if (!objectOf(workout)) return
    remapEntries(workout.entries, moves)
    if (Array.isArray(workout.prs)) {
      workout.prs = workout.prs.map(id => moves.get(id) || id)
    }
  }
  if (Array.isArray(next.workouts)) next.workouts.forEach(remapWorkout)
  // The active session is persisted alongside history and can contain the same custom id.
  // Repointing it keeps the current workout coherent without changing its start timestamp.
  remapWorkout(next.active)

  if (Array.isArray(next.routines)) {
    next.routines.forEach(routine => {
      if (!objectOf(routine) || !Array.isArray(routine.ex)) return
      routine.ex.forEach(entry => {
        if (!objectOf(entry)) return
        remapId(entry, moves)
        remapId(entry.target, moves)
        if (Array.isArray(entry.warmup)) {
          entry.warmup.forEach(warmup => {
            remapId(warmup, moves)
            remapId(warmup?.target, moves)
          })
        }
      })
    })
  }

  if (objectOf(next.exWeights)) {
    for (const [from, to] of moves) {
      if (!has(next.exWeights, from)) continue
      const candidate = next.exWeights[from]
      const current = next.exWeights[to]
      if (!objectOf(current) || recordWins(candidate, current, next.unit)) next.exWeights[to] = candidate
      delete next.exWeights[from]
    }
  }

  if (Array.isArray(next.customEx)) {
    next.customEx = next.customEx.filter(ex => !objectOf(ex) || !moves.has(ex.id))
  }
  return next
}
