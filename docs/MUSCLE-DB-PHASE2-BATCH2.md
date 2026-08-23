# Muscle database phase 2 — machine batch 2

Status: implementation artifact for owner review; no deployment, live-tree edits, commit, or push were performed.

## What changed

- Added `frontend/src/lib/exercise-muscle-batch-2.json` with exactly 119 explicit machine/cable/sled/Smith-machine mappings.
- Added `frontend/src/lib/exercise-muscle-batch-2.js`, exporting the auditable `MACHINE_BATCH_2` artifact.
- Extended the existing `exerciseMuscleMetadataFor(id)` resolver in `exercise-muscle-batch-1.js` without changing its public interface. Precedence is compound batch 1, machine batch 2, then `USER_EXERCISE_MUSCLE_OVERRIDES`.
- Kept `frontend/src/lib/exercises-data.js` unchanged. The raw generated records retain their upstream `tg`, `mg`, `sm`, and `bp` shape; the runtime `CATALOGUE`/`EXIDX` receive the explicit metadata overlay.
- Added `frontend/src/lib/exercise-muscle-batch-2.test.js` covering count/range, catalogue membership, canonical slugs, representative family mappings, raw-record preservation, custom-collision precedence, and restoration.
- No new body-part key was introduced. Every batch row retains its existing upstream `bp`, and the existing locale inventory therefore remains complete without locale-file changes.

## Batch artifact

The 119 rows are grouped as follows:

| family | count | primary template | secondary template |
|---|---:|---|---|
| lever pec deck | 1 | `chest` | `deltoids`, `biceps`, `serratus` |
| machine chest press | 8 | `chest` | `deltoids`, `triceps`, `biceps` |
| cable fly/crossover | 9 | `chest` | `upper-back`, `trapezius` |
| assisted chest dip | 2 | `chest` | `triceps`, `deltoids` |
| assisted triceps dip | 2 | `upper arms` | `deltoids`, `chest`, `upper-back`, `trapezius`, `biceps` |
| lever triceps extension | 1 | `triceps` | none |
| machine/cable lat pulldown | 17 | `upper-back` | `biceps`, `deltoids`, `forearm`, `trapezius`, `triceps` |
| machine/cable row | 17 | `upper-back` | `biceps`, `deltoids`, `forearm`, `trapezius`, `chest`, `triceps` |
| sled/lever/Smith leg press, hack squat, split squat | 16 | `quadriceps`, `gluteal`, `adductors` | `hamstring`, `calves` |
| lever leg extension | 1 | `quadriceps` | none |
| lever leg curl | 5 | `hamstring` | `calves`, `adductors` |
| machine/Smith shoulder press | 6 | `deltoids` | `chest`, `triceps`, `trapezius`, `serratus`, `biceps` |
| rear-delt/side-delt machine or cable | 7 | `deltoids` | `trapezius`, `upper-back` |
| machine/cable calf raise | 14 | `calves` | none |
| hip abduction | 1 | `gluteal` | `hamstring` |
| hip adduction | 2 | `adductors` | `gluteal`, `hamstring` |
| cable hip extension/pull-through | 2 | `gluteal` | `hamstring` |
| machine back extension | 1 | `lower-back` | `gluteal`, `hamstring` |
| reverse hyperextension | 1 | `gluteal`, `hamstring` | `lower-back` |
| machine good morning | 1 | `gluteal`, `hamstring`, `lower-back` | none |
| machine/cable biceps isolation | 5 | `biceps` | `forearm` |

The artifact contains no phase-1 ID, and all rows use one of the existing equipment families in `exercises-data.js` (`cable`, `leverage machine`, `sled machine`, or `smith machine`).

## Source and mapping policy

The source basis is the ExRx exercise directory, muscle directory, and the inspected family pages:

- Exercise directory: https://exrx.net/Lists/Directory
- Muscle directory: https://exrx.net/Lists/Muscle
- Lever seated fly / pec deck: https://exrx.net/WeightExercises/PectoralSternal/LVSeatedFly
- Lever isolateral bench press: https://exrx.net/WeightExercises/PectoralSternal/LVBenchPressH
- Cable standing fly/crossover: https://exrx.net/WeightExercises/PectoralSternal/CBStandingFly
- Lever front pulldown: https://exrx.net/WeightExercises/LatissimusDorsi/LVFrontPulldown
- Lever seated row: https://exrx.net/WeightExercises/BackGeneral/LVSeatedRow
- Lever shoulder press: https://exrx.net/WeightExercises/DeltoidAnterior/LVShoulderPress
- Exercised machine family index, including lever/sled/Smith quadriceps and hamstring entries: https://exrx.net/Lists/ExList/ThighWt
- Sled 45-degree leg press: https://exrx.net/WeightExercises/Quadriceps/SL45LegPress
- Lever leg extension: https://exrx.net/WeightExercises/Quadriceps/LVLegExtension
- Lever seated leg curl: https://exrx.net/WeightExercises/Hamstrings/LVSeatedLegCurl
- Assisted triceps dip (kneeling): https://exrx.net/WeightExercises/Triceps/ASTriDipKneeling
- Lever triceps dip: https://exrx.net/WeightExercises/Triceps/LVTriDip
- Lever triceps extension: https://exrx.net/WeightExercises/Triceps/LVTriExt

All 119 rows were audited under the phase-1 policy:

1. ExRx `Target` becomes a primary muscle when it maps to a drawable catalogue slug.
2. A directly force-producing `Synergist` is primary only when the machine family uses it as a principal mover. This is why leg press/hack/squat rows use the multi-primary `quadriceps`/`gluteal`/`adductors` template; their `hamstring` and `calves` contributions remain secondary.
3. A drawable `Dynamic Stabilizer` that directly contributes to the movement is secondary. Pulldowns and rows retain the established arm/shoulder/forearm support template; leg press retains hamstrings and calves.
4. `Stabilizer` and `Antagonist Stabilizer` entries are not copied wholesale. The cable-fly page, for example, lists arm and trunk stabilizers; the overlay keeps only the source-backed upper-back synergist rather than turning every stabilizer into recovery debt. Supported machine seats likewise do not inherit compound-lift trunk bracing.
5. Every emitted name is present in `MUSCLES`; source names that collapse to the same drawable region are canonicalized, while undrawable source muscles are omitted rather than guessed.
6. The batch does not infer a new `bp`: each row retains the existing generated body-part key, so the locale/body-part contract is unchanged.

The machine-specific representative assertions intentionally cover pec deck (`0596`), chest press (`0577`), cable crossover (`0155`), lat pulldown (`0579`), seated row (`1350`), triceps dip (`0019` and `1451`), triceps extension (`0607`), sled leg press (`0739`), leg extension (`0585`), seated leg curl (`0599`), and shoulder press (`0603`).

## Override and history precedence

1. A completed-history `muscleWeights` snapshot remains authoritative inside `musclesOf()`/`loadOf()` when present.
2. Explicit `primaries`/`secondaries` on an exercise take precedence over legacy `tg`/`mg`/`sm` fields.
3. The machine batch is applied after compound batch 1 and before `USER_EXERCISE_MUSCLE_OVERRIDES`.
4. A registered custom exercise in `EXIDX` replaces a colliding built-in runtime record. `registerCustom([])` restores the enriched machine record; this is tested with ID `0577`.
5. Exercises not listed in either explicit batch continue through the existing legacy/body-part fallback.

## Verification

- `npx vitest run src/lib/exercise-muscle-batch-2.test.js` — 15 passed.
- `npx vitest run src/lib/exercise-muscle-batch-1.test.js src/lib/muscles.test.js src/locales.test.js src/lib/recovery.test.js src/lib/strength-exercises.test.js src/lib/exercises.test.js src/lib/programmes.test.js` — 103 passed.
- `git diff --check` — passed.

## Sources

[1] https://exrx.net/Lists/Directory
[2] https://exrx.net/Lists/Muscle
[3] https://exrx.net/WeightExercises/PectoralSternal/LVSeatedFly
[4] https://exrx.net/WeightExercises/PectoralSternal/LVBenchPressH
[5] https://exrx.net/WeightExercises/PectoralSternal/CBStandingFly
[6] https://exrx.net/WeightExercises/LatissimusDorsi/LVFrontPulldown
[7] https://exrx.net/WeightExercises/BackGeneral/LVSeatedRow
[8] https://exrx.net/WeightExercises/DeltoidAnterior/LVShoulderPress
[9] https://exrx.net/Lists/ExList/ThighWt
[10] https://exrx.net/WeightExercises/Quadriceps/SL45LegPress
[11] https://exrx.net/WeightExercises/Quadriceps/LVLegExtension
[12] https://exrx.net/WeightExercises/Hamstrings/LVSeatedLegCurl
