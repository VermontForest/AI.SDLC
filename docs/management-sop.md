# Management SOP for AI.SDLC

Last updated: 2026-11-14

Carl Weiss retired the process gates on 2026-11-14. Stale LEQ and JouleWork
scores, the skill-package lock, skill-method attestations, approval records,
and completion paperwork no longer block a commit, merge, or deploy. The old
records stay in the repository. The commands may print a warning.

Carl is not the assistant's assistant. Agents discover tools and connectors,
read documentation, investigate alternatives, and execute authorized routine
setup, troubleshooting, edits, and commands. They ask only for an essential
user-owned decision or inaccessible authentication/consent, with a specific
reason. An unavailable capability requires investigation, not delegation of
routine research to Carl. Continue independent work and report genuine blockers.

The check that remains is `npm test`. GitHub runs that same command in the
`validate` job and in four jobs for Ubuntu and Windows with Node 22 and Node
24. Do not skip a test command and then treat the run as passed.

Historical score files and the skill lock remain as records. They are marked
retired. Do not delete them to make a check pass.
