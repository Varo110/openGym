# OpenGym publication archive and contribution branches

Generated 2026-08-23 from the verified accepted integration lineage.

## Authority and base

- Accepted source: `da8d68c6f48a6634e7963c5c3e55279023a43189` (`236f115ebe5e25560341a16d87a906a7345ca7d7` tree).
- Accepted lineage: `80e5d04fe9182f9867b2ff22527d6dda63446721` → `f3da92ac136ea87c934eb196574f0b11c676228b` → `da8d68c6f48a6634e7963c5c3e55279023a43189`.
- Re-verified GitLab main: `f8024d344debd556ad589c92eb71e77017a5445f` (`401c4234069d2a8b593e2844eb0d5655d7a3c874` tree).
- Release tag readback: `v1.2.9` at `04ea5f2570c4ab041ac07a111f59ed79c64e136a`.

The source snapshot is an orphan branch so the publication archive does not make private or operational accepted-tree blobs reachable. The accepted commit and tree remain provenance metadata only.

## Archive boundary

`archive/public-source-2026-08-23` contains public application source, focused tests, public docs/licensing, and source-only Android/iOS/Capacitor files. The following were removed from the archive index:

- `artifacts/`, `docs/integration/`, `docs/R2-*`
- `DEPLOY-D2-20260806.md`, `DEVELOPMENT-TODO.md`, `PHASE1-IMPLEMENTATION.md`
- `docker-compose.tailscale.yml`
- `frontend/public/mockup*.html`
- internal migration/audit scripts under `scripts/`

No account state, private backups, credentials, notification keys, generated APK/bundle output, host overlays, or live deployment mutation is part of this packet.

## Contribution order

1. `contrib/exercise-catalogue-and-logging`
2. `contrib/programme-lifecycle-and-completion`
3. `contrib/home-weekly-planning`
4. `contrib/phase-aware-workouts`
5. `contrib/canonical-units-and-plan-interchange`
6. `contrib/exercise-groups-and-setup`
7. `contrib/progression-amrap-and-strength`
8. `contrib/session-navigation-and-timers`
9. `contrib/pwa-sync-and-mobile-runtime`

The branch tips and full machine-readable scope, dependencies, evidence anchors, allowed paths, exclusions, and verification caveats are in `publication/BRANCH_MANIFEST.json`.

Branches are stacked for reviewability: each branch's own commit is contribution-sized relative to its declared parent, while every stack starts at the refreshed GitLab main. Home and phase are sibling branches; groups and units consume phase; progression consumes units; timers consumes phase; mobile consumes timers and is additionally gated on progression.

## Authority follow-ups

- `da8d68c` is assigned once to the catalogue branch as the accepted Stats duplicate-list correction; it is not a new capability row.
- `f3da92a` is retained as accepted local-only presentation work and is intentionally excluded from the functional progression branch.

## Verification status

The packet creation checks branch reachability, `git diff --check`, and forbidden-path scans. The verified application checks are: API 2/2, MCP 38/38, sanitized-archive frontend 1208/1208, focused timer tests 15/15, frontend production build, MCP plain-node import graph, and fatigue probes. The full frontend run emitted one non-failing happy-dom AbortError diagnostic and the build emitted chunk-size warnings. Remote pushes and live/account behavior are not claimed here; they remain downstream review gates.
