# Traccia — working notes for Claude

Local-only desktop app that maps where an organisation's personal data goes.

**Spec:** `docs/superpowers/specs/2026-07-30-data-flow-mapper-design.md`
**Plan:** `docs/superpowers/plans/2026-07-30-data-flow-mapper-phase1.md`

## Non-negotiables

- No outbound network traffic except a scan of a URL the user explicitly entered. No telemetry, no
  crash reporting, no update check, no CDN. Everything bundled.
- `src/core/` is pure: no `fs`, no `path`, no `electron`, no `Date.now()`, no `Math.random()`.
  Timestamps and IDs are parameters.
- Gaps are computed on demand, never stored in the project file, never edited by a user.
- Copy about unknowns stays neutral: "not yet identified", never "violation" or "non-compliant".
- `tests/core` = 96 as of the final whole-branch review of 2026-08-01 external-map v0.1. This is a
  baseline, not a freeze — it moved deliberately during that plan and once more in the final
  review, with the count accounted for per task, and it may move again the same way. It is not a
  ceiling on `src/core/`.

## Commands

- `npm test` — Vitest, all suites
- `npm run typecheck` — tsc, no emit
- `npm run dev` — Tauri in development
- `cargo test` / `cargo clippy --all-targets -- -D warnings` — from `src-tauri/`

## Working method

One task at a time from the plan. coder implements, reviewer reviews, security-auditor gates any task
touching network, filesystem, IPC or preload. Commit after review passes.
