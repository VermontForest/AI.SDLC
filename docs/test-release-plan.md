# Test and release plan

Last updated: 2026-09-13

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

Run `npm test` on Node 20 or newer. It validates maintained-file spelling,
configuration routing, package/launcher references, and real temporary-project
lifecycle behavior. GitHub Actions runs the same command on Windows and Linux,
with Node 20 and 24, for pushes and pull requests. It needs no premium skill
bodies or credentials. CI fixture attestations are explicitly test data.

Real work requires `npm run jsm:verify`, Assess before implementation, Regress
after implementation, Finish, and `npm run verify:completion --
--intentional-files <paths>`. Use actual routed methods, not fabricated flags.
The gate checks current file/configuration hashes and stage identity, licensed
dependency integrity, JSM lifecycle, pending external proof, LEQ, and JouleWork.
Reassess changed scope/config; rerun Regress and Finish after content changes.

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
