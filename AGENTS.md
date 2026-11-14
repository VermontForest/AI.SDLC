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

## Checks that remain

Carl Weiss retired the process gates on 2026-11-14. Do not block work on stale
LEQ or JouleWork scores, the skill-package lock, skill-method attestations,
approval records, or completion paperwork. Those commands may warn. They are
not a reason to stop.

Run `npm test` before calling the change done. That command is the check that
still matters. GitHub runs it in the `validate` job and in four jobs covering
Ubuntu and Windows with Node 22 and Node 24.

A skipped test command, or a test command that exits with an error, is still a
failure. Say what you ran and what the result was. Do not invent a pass.

Keep machine evidence separate from external proof. Preserve unrelated work.
See docs/test-release-plan.md for what the test jobs cover.
