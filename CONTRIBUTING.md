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

1. Assess the intentional file set before implementation when using the harness on a consuming project.
2. Regress with protected packs bound to that file set.
3. Finish only when Assess and Regress evidence matches those files.
4. Do not treat green unit tests alone as completion.

## Do not commit

- secrets, provider tokens, or `.env` files
- premium JSM `SKILL.md` bodies or their payloads
- live consumer-project ops state (`ops/*.latest.json`, `ops/status.json`, `ops/dashboard.html`, generated `docs/status.md`)
- customer data or private product evidence

## Pull requests

Keep changes small and reviewable. Say what was tested. Report residual risk instead of claiming trust from a green build alone.
