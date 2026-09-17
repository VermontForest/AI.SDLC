# Management SOP for AI.SDLC

Last updated: 2026-09-13

This repository consumes its own existing Assess → Regress → Finish framework.
The routing authority is harness.config.json. The Work Contract, stage-specific
JSM methods, LEQ, and JouleWork have the meanings documented in README.md and
templates/docs/management-sop.md.

Carl is not the assistant's assistant. Agents discover tools and connectors,
read documentation, investigate alternatives, and execute authorized routine
setup, troubleshooting, edits, and commands. They ask only for an essential
user-owned decision or inaccessible authentication/consent, with a specific
reason. An unavailable capability requires investigation, not delegation of
routine research to Carl. Continue independent work and report genuine blockers.

Before implementation, verify licensed dependencies and assess the intentional
file set with a complete Work Contract. Apply the actual routed methods at each
stage. Reassess changed scope/configuration. Regress the implemented contents,
then Finish the same file set. Do not use dry-run or skipped commands as proof.

After Finish, run verify:completion with the exact intentional file set. It reads
existing evidence and current metrics without creating attestations. Missing
dependency verification, failed/stale evidence, pending external proof, or
unhealthy LEQ/JouleWork prevents a completion claim. Current open work, completed
work, active/global pending proof, and verifier proof remain distinct status
categories. Commit only scrubbed documentation; keep rolling ops state untracked.
