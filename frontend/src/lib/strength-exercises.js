// Per-exercise rows for the Strength view: best historical estimated 1RM from the user's own
// logged sets, plus the canonical Adaptive e1RM (median of recent session-best estimates with
// retention). The body map keeps its per-muscle model;
// the exercise list deliberately reads per-exercise, so an old exercise shows its own
// decline even when its muscle is kept fresh by other work. Muscle mapping is
// catalogue-first (EXIDX), exactly like the fatigue/strength maps, falling back to the
// logged snapshot (muscleWeights) for exercises no longer in the catalogue.
import { best1RM, percentage1RMDetailsForExercise } from './onerm.js'
import { musclesOf } from './muscles.js'
import { EXIDX } from './exercises.js'
import { historyUnitCompatible } from './workout-model.js'

const round1 = value => Math.round(value * 10) / 10

function snapshotWeights(entry) {
  const catalogue = entry && typeof entry === 'object' ? EXIDX[entry.id] : null
  if (catalogue) {
    const weights = musclesOf(catalogue)
    if (Object.keys(weights).length) return weights
  }
  const direct = entry && typeof entry === 'object' ? entry.muscleWeights : null
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && Object.keys(direct).length) {
    return direct
  }
  return musclesOf(entry)
}

// Highest-weight muscle of an exercise - used for the primary/secondary badge and the
// per-muscle link, not for the decay (the exercise's own decay is what the row shows).
export function primaryMuscleOf(entry) {
  const weights = snapshotWeights(entry)
  let best = null
  for (const [slug, weight] of Object.entries(weights)) {
    if (!best || weight > best.weight) best = { slug, weight }
  }
  return best
}

function exerciseName(entry) {
  // Imported history often has no name snapshot (entries are { id, sets, topW }) - the
  // catalogue (or the registered custom) is the canonical name source.
  const ex = entry && typeof entry === 'object' ? EXIDX[entry.id] : null
  if (ex?.n) return ex.n
  return entry && typeof entry === 'object' && entry.n ? entry.n : null
}

function firstEntryWithId(S, id) {
  for (const workout of S?.workouts || []) {
    if (!historyUnitCompatible(workout, S.unit)) continue
    const entry = (workout.entries || []).find(e => e.id === id)
    if (entry) return entry
  }
  return null
}

/**
 * Strength rows for every exercise with an estimate: best historical estimated 1RM (work sets
 * only, warm-ups excluded), the estimate's date, the exercise's primary muscle, and the
 * canonical Adaptive e1RM with its retention.
 * Sorted by expected current 1RM, strongest first. Exercises without a usable estimate are
 * omitted - a made-up number is worse than no number.
 */
export function strengthExerciseRows(S, now) {
  const workouts = S?.workouts || []
  const ids = [...new Set(workouts.flatMap(w => (w.entries || []).map(e => e.id)))]
  const rows = []
  for (const id of ids) {
    const best = best1RM(S, id)
    if (!best) continue
    const entry = firstEntryWithId(S, id)
    const adaptive = percentage1RMDetailsForExercise(S, id, 'adaptive', { now })
    if (!adaptive) continue
    const decay = adaptive.retention
    const current = round1(adaptive.estimate)
    rows.push({
      id,
      name: exerciseName(entry) || id,
      est: best.est,
      estDate: best.d,
      primary: primaryMuscleOf(entry) ? primaryMuscleOf(entry).slug : null,
      decay,
      current,
    })
  }
  return rows.sort((a, b) => b.current - a.current || String(a.name).localeCompare(String(b.name)))
}

/**
 * Strength rows for the exercises whose logged snapshot includes `slug` (primary 1 /
 * secondary 0.4 badge), each with the canonical Adaptive e1RM - the tapped muscle filters the
 * list, the row still speaks for the exercise.
 */
export function strengthExerciseRowsForMuscle(S, now, slug) {
  const workouts = S?.workouts || []
  const seen = new Map()
  for (const workout of workouts) {
    if (!historyUnitCompatible(workout, S.unit)) continue
    for (const entry of workout.entries || []) {
      if (seen.has(entry.id)) continue
      const weights = snapshotWeights(entry)
      const weight = weights[slug]
      if (!weight) continue
      const best = best1RM(S, entry.id)
      if (!best) continue
      const adaptive = percentage1RMDetailsForExercise(S, entry.id, 'adaptive', { now })
      if (!adaptive) continue
      const decay = adaptive.retention
      const primary = primaryMuscleOf(entry)
      seen.set(entry.id, {
        id: entry.id,
        name: exerciseName(entry) || entry.id,
        weight,
        primary: primary ? primary.slug : null,
        est: best.est,
        estDate: best.d,
        decay,
        current: round1(adaptive.estimate),
      })
    }
  }
  return [...seen.values()].sort((a, b) => b.current - a.current || String(a.name).localeCompare(String(b.name)))
}
