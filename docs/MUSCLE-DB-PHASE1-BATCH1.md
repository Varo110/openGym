# Muscle database phase 1 — compound-lift batch 1

Status: repaired implementation artifact for owner review; no deployment, live-tree edits, commit, or push were performed.

## What changed

- Added an explicit multi-primary model: `primaries: string[]` and `secondaries: string[]`.
- Primary muscles contribute weight `1`; secondary muscles contribute supporting weight `0.4`. Duplicate/alias names are canonicalized and de-duplicated.
- Added the `full body` body-part value and localized it in all 11 non-English locale dictionaries. The UI-facing body-part list is derived from the runtime catalogue, so it is available to the filters without changing the upstream generated data.
- Kept `frontend/src/lib/exercises-data.js` as the raw/upstream-compatible export. The runtime `CATALOGUE`/`EXIDX` apply the batch overlay, and `allExercises()` exposes the enriched catalogue to pickers.
- Existing `tg`, `mg`, `sm`, `muscleGroups`, `muscles`, `targetMuscles`, and `muscleWeights` records remain readable. Records without recognized explicit primary/secondary metadata use the existing legacy/body-part fallback.
- Completed-workout snapshots retain canonical `primaries` and `secondaries`, in addition to the existing weighted snapshot fields.

## Batch artifact

`frontend/src/lib/exercise-muscle-batch-1.json` contains exactly 104 built-in exercise IDs across these families:

- squat: 21
- deadlift: 17
- bench press: 16
- overhead/shoulder/military press: 15
- row: 20
- pull-up/chin-up: 15

The rows use canonical slugs from `frontend/src/lib/muscles.js`. `full body` is limited to movements that visibly span regions in the source movement: overhead squat, squat jerk, conventional/sumo/side/cable/Smith/trap-bar deadlift variants, and L-pull-up. The twisting overhead press remains `shoulders`; its stable-hip instructions do not justify a lower-body body-part label.

## Source and mapping policy

The source basis is the ExRx exercise library and target-muscle directory. The cited family pages are:

- Exercise directory: https://exrx.net/Lists/Directory
- Muscle directory: https://exrx.net/Lists/Muscle
- Squat / quadriceps: https://exrx.net/WeightExercises/Quadriceps/BBSquat
- Squat / gluteus maximus view: https://exrx.net/WeightExercises/GluteusMaximus/BBSquat
- Deadlift / erector spinae: https://exrx.net/WeightExercises/ErectorSpinae/BBDeadlift
- Bench press / pectoral sternal: https://exrx.net/WeightExercises/PectoralSternal/BBBenchPress
- Military press / anterior deltoid: https://exrx.net/WeightExercises/DeltoidAnterior/BBMilitaryPress
- Bent-over row / back: https://exrx.net/WeightExercises/BackGeneral/BBBentOverRow
- Pull-up / latissimus dorsi: https://exrx.net/WeightExercises/LatissimusDorsi/BWPullup

All 104 rows were audited under this policy:

1. ExRx `Target` is a primary muscle when it maps to a drawable catalogue slug.
2. A directly force-producing `Synergist` is primary only when the family movement uses it as a principal mover (for example quadriceps/gluteal/adductors in the squat template and gluteal/hamstring/lower-back in the floor deadlift template); otherwise it is a secondary supporting muscle.
3. A drawable `Dynamic Stabilizer` that directly contributes to the family movement is secondary. This keeps bench-press biceps and pull-up posterior deltoids represented without promoting them to primary load.
4. `Stabilizer` and `Antagonist Stabilizer` entries are not copied wholesale. Only source-backed, movement-relevant trunk bracing is retained as secondary for the squat/deadlift families and the twisting-press variant (`abs`/`obliques`). Passive or undrawable stabilizers are omitted so the recovery overlap guard does not treat every listed stabilizer as a hard collision.
5. Every emitted name must be one of `MUSCLES`; source names that collapse to the same drawable region are de-duplicated, and undrawable source muscles are intentionally not guessed.

The resulting family templates are:

| family | primary template | secondary template |
|---|---|---|
| squat | `quadriceps`, `gluteal`, `adductors` | `hamstring`, `calves`, `lower-back`, `abs`, `obliques` |
| floor deadlift | `gluteal`, `hamstring`, `lower-back` | `quadriceps`, `adductors`, `calves`, `abs`, `obliques` |
| hinge deadlift | `gluteal`, `hamstring` | `lower-back`, `quadriceps`, `adductors`, `calves` |
| bench press | `chest` | `triceps`, `deltoids`, `biceps` |
| close-grip bench | `triceps` | `chest`, `deltoids`, `biceps` |
| overhead/shoulder press | `deltoids` | `chest`, `triceps`, `trapezius`, `serratus` |
| row | `upper-back` | `biceps`, `deltoids`, `forearm` |
| pull-up/chin-up | `upper-back` | `biceps`, `deltoids`, `forearm` |

The source-known exceptions are deliberate: ID `0587` keeps its raw `upper chest` as drawable `chest`; ID `0414` keeps raw `core` as secondary rather than primary; ID `1012` is a shoulder press with `abs`/`obliques` secondary rather than a full-body exercise; and ID `0786` retains the jerk's shoulder/triceps contribution while inheriting the squat bracing muscles.

## Override and history precedence

1. A completed-history `muscleWeights` snapshot is authoritative inside `musclesOf()` and `loadOf()` when present.
2. Explicit `primaries`/`secondaries` on an exercise take precedence over legacy `tg`/`mg`/`sm` fields.
3. `USER_EXERCISE_MUSCLE_OVERRIDES` is an empty compile-time owner-correction table for built-in catalogue corrections; it is separate from registered custom exercises.
4. A registered custom exercise in `EXIDX` replaces a colliding built-in catalogue record for runtime lookups. `registerCustom([])` restores the enriched built-in from `CATALOGUE`; this is a runtime collision mechanism, not an entry in the owner-correction table.
5. The ExRx-informed batch overlays the raw catalogue only where an ID is listed. Exercises with no recognized explicit metadata continue through the existing legacy fields and body-part fallback.
6. `recovery.js` and `strength-exercises.js` intentionally resolve catalogue-first and only fall back to historical snapshots when the catalogue entry is unavailable. The report's snapshot-authority statement therefore applies to the shared muscle helpers, not as a claim that those existing consumers were changed in phase 1.

The raw dataset remains untouched so imports and legacy consumers retain their upstream shape; source validation and representative-family assertions live in `frontend/src/lib/exercise-muscle-batch-1.test.js`, while the runtime body-part key inventory is checked in `frontend/src/locales.test.js`.
