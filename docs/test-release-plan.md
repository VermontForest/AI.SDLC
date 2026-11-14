# Test and release plan

Last updated: 2026-11-14

Carl Weiss retired the process gates on 2026-11-14. The rows below that describe
skill locks, stale scores, approval records, and completion paperwork are
history. They no longer block a commit, merge, or deploy. The checks that still
block are `npm test` and the GitHub jobs that run it: `validate`, plus the four
jobs for Ubuntu and Windows with Node 22 and Node 24. A skipped or failing test
command still fails. A portfolio file with invalid structure or a broken link
still fails when that check is run on purpose; it is not a merge job.

| Requirement | Verification |
| --- | --- |
| SDLC-1: Canonical product, package, CLI, and filenames | verify-repository scans maintained files and package entry points |
| SDLC-2: Existing Assess → Regress → Finish and genuine staged JSM methods | root config, operating instructions, lifecycle self-test, real jsm:verify and verify:completion |
| SDLC-3: Failed, skipped, stale, partial, or missing proof cannot close work | positive and negative lifecycle tests; nonzero Finish/completion exit status |
| SDLC-4: LEQ/JouleWork and external proof remain meaningful | completion gate reads current loop health and rejects pending proof |
| SDLC-5: Carl is not the assistant's assistant | root instructions, generated agent template, management SOP; human review of actual behavior |
| SDLC-6: Portfolio LEQ/JouleWork are continuously derived across task, project, and portfolio | portfolio sync tests, generated metrics diff gate, local hooks, PR/main CI, and daily drift |
| SDLC-7: Release and deployment transitions are gated and recorded | reusable workflow-call gates, pre-publication publish dependency, lifecycle-event tests, and automation-branch pull requests |
| SDLC-8: Invalid changes cannot merge directly to main | GitHub branch protection/ruleset API evidence plus required hosted checks |
| SDLC-9: Queued, dependency-waiting, active, and genuinely blocked work stay distinct | positive/negative state-contract tests, blocker-action ownership tests, portal counts and filters |
| SDLC-10: LEQ, JouleWork, and release fields never invent missing values | explicit data-quality schema, stale/dependency propagation tests, completion-stage failure tests, portal detail proof |
| SDLC-11: Hosted maintenance uses supported runtimes | pinned checkout/setup-node v7 assertions, Windows/Linux Node 22/24 matrix, Dependabot configuration, clean hosted run |
| SDLC-12: Metric models, denominators, pending checks, and freshness are honest | duplicate-type and undeclared-required-type regressions, model-separation tests, evidence-timestamp freshness tests, and portal detail assertions |
| SDLC-13: A release is not complete until hosted publication evidence exists | active publication work item, protected release gate, hosted tag and asset digest verification, and one reviewable ledger-update pull request |

Run `npm test` on Node 22 or newer. It checks maintained-file spelling, package
entry points, and the harness behavior, including the retired-gate warnings.
GitHub Actions runs the same command on Windows and Linux, with Node 22 and 24,
for pushes and pull requests. GitHub Action execution uses pinned v7 action
commits. It needs no premium skill bodies or credentials.

`npm run jsm:verify`, Assess, Regress, Finish, and `npm run verify:completion`
still exist. Since 2026-11-14 they warn instead of blocking when a skill is
missing, a score is stale, or the completion paperwork is incomplete. A test
command that fails, or that was skipped, still fails Regress.

CI validates enforcement behavior and configuration, not private local workflow
history or an agent's reasoning. GitHub branch protection is separate: adding a
workflow does not itself make its status a required merge check, so repository
rules must be verified through the GitHub API as release evidence. Rolling JSON
is inspectable but not tamper-evident. Human review must still assess honesty,
method quality, and whether responsibility was properly exercised. External
proof cannot be cleared merely by passing tests.

This repository has no product deployment step. Publishing a package or changing
access permissions is outside the spelling migration. Existing consumers must
update command names and package references to ai-sdlc and regenerate/review
their project instructions; no misspelled aliases remain.
