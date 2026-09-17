# AI.SDLC Project Plan

## Purpose

This is the public roadmap and implementation plan for AI.SDLC itself. It
records approved product direction before implementation so repository changes,
tests, evidence, and releases can be traced back to an explicit plan.

## Current Priority: Executable Traceability And CI Enforcement

**Implementation status:** v0.2.0 was publicly verified and merged. v0.2.1 added
automatic task/project/portfolio metric rollups, current-clock portal staleness,
event-bound lifecycle recording through pull requests, and repository merge
enforcement. v0.2.2 hardens work-state semantics, metric/release data quality,
and the supported hosted CI runtime.

AI.SDLC will make the project plan the root record for delivery. The plan will
define numbered user requirements, functional requirements, work breakdown,
required test classes, evidence, approvals, release state, and production
proof. A machine-readable traceability ledger will connect those records.

The implementation provides:

1. a versioned plan and traceability schema;
2. validation commands that fail closed on missing or contradictory links;
3. generated human-readable traceability and project-management views;
4. GitHub CI gates for change, release, and production-proof transitions;
5. scheduled drift detection for stale plans, evidence, and project state; and
6. self-tests demonstrating both valid passage and intentional gate failure.

The release is not complete merely because these files exist. The public branch
must show a successful hosted change-gate run, and the operator portal must be
inspected at desktop and mobile widths without console errors.

## Enforcement Contract

The plan is the root record and the traceability ledger is its executable form.
CI validates the ledger; the portal reads the ledger. There is no independent
dashboard status copy to reconcile by hand.

- The `change` gate protects requirements, links, declared tests, evidence, and
  task-scoped status.
- The `release` gate protects completed work, exact artifact identity,
  approvals, rollback, and content-outcome claims.
- The `post-deploy` gate protects actual deployment and evidence-backed live
  proof.
- The `drift` gate protects freshness.

A passing build or a different delivery URL is not accepted as evidence that
content changed. Content claims require a hashed content artifact and passed
comparison evidence attached to that artifact.

The human portal and generated reports must read from the same authoritative
ledger that CI validates. They must not maintain separate status copies that can
silently drift.

The ledger remains the source of facts; `ops/portfolio-metrics.json` and the
human portal are deterministic derived artifacts. Hooks and CI recompute both
and fail when committed output is stale. This avoids a second hand-maintained
status source while still exposing task, project, and portfolio rollups.

GitHub lifecycle events never manufacture acceptance. Release publication may
record a passed release gate. A successful deployment event may record a
deployment only when the ledger already contains passed production tests and
evidence. Each event produces a pull request so branch rules and ordinary CI
remain in control of the authoritative ledger.

## v0.2.2 State And Data-Quality Contract

The dashboard separates delivery state from the quality of the data displayed:

- `queued` is a priority or capacity queue, not a blocker;
- `waiting_dependency` names the prerequisite and why work cannot proceed;
- `blocked` and `failed` require an evidenced impediment, a clearing action, and
  an owner;
- unverified or missing facts never count as blocked merely because they are
  unknown;
- LEQ, JouleWork, and release each declare definition, scope, source or missing
  inputs, freshness, owner, and next action through `valid`, `not_applicable`,
  `awaiting_inputs`, `stale`, or `error` states; and
- dependent aggregates remain awaiting, stale, or error until every applicable
  child is valid.

Hooks, pull-request CI, main CI, lifecycle-event updates, and the serving-time
portal recompute or invalidate derived state. Completion and post-deploy gates
require valid values only when those values are required at that lifecycle
stage. Ledger structure validity remains a separate claim and cannot imply
tested, complete, released, or production-proven work.

The hosted matrix is Node.js 22 and 24. Action execution uses pinned v7 action
commits so the deprecated Node.js 20 action runtime is removed independently of
the application test matrix. Weekly Dependabot checks keep both Action pins and
npm dependencies visible for maintenance.

## Planned: Optional Vibe Mode

**Status:** planned; not included in the first traceability-enforcement release.

Vibe Mode will support intentionally rapid, low-ceremony experimentation when
the operator wants to explore, rearrange, or prototype without the full
AI.SDLC gate stack.

The planned contract is:

- Vibe Mode is explicit and opt-in, never inferred.
- Its artifacts and dashboard state are visibly labeled `experimental`.
- It may relax planning, traceability, test, and evidence gates during local or
  isolated-branch exploration.
- It does not permit an ungated artifact to be labeled verified,
  release-ready, production-proven, or complete.
- Promotion out of Vibe Mode requires a deliberate re-entry step that creates
  or completes the normal plan, traceability, tests, evidence, and approvals.
- Re-entry must preserve useful prototypes without pretending that exploratory
  work already satisfied the standard lifecycle.

### Vibe Mode Acceptance Criteria

Before Vibe Mode can be released:

1. entering and leaving the mode must be explicit and recorded;
2. status output and the portal must make the experimental state unmistakable;
3. standard release and production gates must reject unreconciled Vibe Mode
   work;
4. re-entry must identify missing requirements, tests, evidence, and approvals;
5. automated tests must prove that Vibe Mode accelerates exploration without
   allowing false completion or production-readiness claims; and
6. documentation must explain when to use standard mode versus Vibe Mode in
   plain language.

## Release Order

1. Executable plan and traceability ledger
2. CI enforcement and generated portal
3. Public documentation, self-hosting proof, and release
4. Vibe Mode design and implementation
