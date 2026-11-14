# Contributing

## Before you change code

Read `README.md`, `AGENTS.md`, `harness.config.json`, and `docs/management-sop.md`.

Carl is not the assistant's assistant. Investigate with available tools and documentation. Ask only for essential decisions or credentials that only a human can provide.

## Local checks

```bash
npm ci
npm test
```

`npm test` runs repository verification, the harness self-test, and Codex hook tests.

Optional focused hook tests:

```bash
npm run test:hooks
```

## Change discipline

Carl Weiss retired the process gates on 2026-11-14. Run `npm test`. A skipped
or failing test still fails. Stale scores, the skill lock, approval records,
and completion paperwork do not block the change.

## Do not commit

- secrets, provider tokens, or `.env` files
- premium JSM `SKILL.md` bodies or their payloads
- live consumer-project ops state (`ops/*.latest.json`, `ops/status.json`, `ops/dashboard.html`, generated `docs/status.md`)
- customer data or private product evidence

## Pull requests

Keep changes small and reviewable. Say what was tested. Report residual risk instead of claiming trust from a green build alone.
