# AI.SDLC repository operating contract

Use this repository's existing framework, as defined by README.md,
harness.config.json, templates/AGENTS.sdlc.snippet.md, and
docs/management-sop.md. Read them before implementation; do not substitute a
generic workflow. Read existing docs/status.md and ops/status.json when present.

## Responsibility

Carl is not the assistant's assistant. Discover and select tools and connectors,
read their documentation, and perform authorized routine troubleshooting, setup,
edits, and commands yourself. Do not ask Carl to research connector types,
choose implementation tools, or execute routine technical work. Before declaring
a blocker, inspect the available capabilities and investigate permitted
alternatives. Ask only for an essential user-owned decision or action, such as
authentication or consent inaccessible to tools, and explain the specific reason.
Existing authorization persists. Continue independent authorized work while a
dependency is blocked; never fabricate evidence or report blocked work complete.

## Required lifecycle

1. Verify the official JSM lock with `npm run jsm:verify`. Use the official
   installer and authorized JSM delivery for missing packages. Never copy premium
   skill bodies into this repository or substitute test fixtures for real methods.
2. Read and actually apply the Assess methods routed by harness.config.json.
   Run `npm run assess:change-impact -- --files <paths> --applied-skill <methods>`
   before implementation, recording deliverable, why, surface, lane, boundaries,
   required proof, and verifier requirement. Reassess whenever scope or routing
   changes. Include additions, deletions, and both sides of renames.
3. Apply the routed Regress methods and run `npm run regress:protected -- --files
   <paths> --applied-skill <methods>`. All required packs must pass; skipped
   commands and optional-pack-only runs cannot close the change.
4. Apply the Finish methods, then run `npm run finish:iteration --
   --intentional-files <paths> --applied-skill <methods> --skip-git`. Use
   `--execute --commit-message` only when Git mutation is already authorized.
   Keep rolling ops evidence untracked; use `--no-artifact-backup` for this repo.
5. Run `npm run verify:completion -- --intentional-files <paths>` before claiming
   completion. It verifies licensed dependencies, current stage/file/config
   evidence, pending proof, JSM lifecycle, LEQ, and JouleWork. A blocked or failed
   gate is not completion. Rerun Regress and Finish after editing tested contents.

Run `npm test` for implementation validation. CI runs that same validation on
Windows and Linux. Fixture tests prove harness behavior; they do not attest an
agent's application of paid JSM methods. `npm run verify:completion` is the real
completion gate, and cannot be replaced by a green unit-test job.

Keep machine evidence separate from external proof. Report actual results and
limits. Preserve unrelated work and repositories. See docs/test-release-plan.md
for requirement traceability and CI enforcement boundaries.
