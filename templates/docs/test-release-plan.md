# Test And Release Plan

Last updated: 2026-07-07

## Standard Commands

```bash
npm run assess:change-impact -- --files <repo paths> --applied-skill <Assess methods> --active-deliverable "..." --why "..." --target-surface "..." --lane "..." --boundary "..." --proof "..."
npm run regress:protected -- --files <repo paths> --applied-skill <Regress methods>
npm run finish:iteration -- --intentional-files "<repo paths>" --applied-skill <Finish methods> --skip-git
npm run manage:refresh
```

Use `--execute --commit-message "..."` at Finish only when the current user has
authorized staging, committing, and pushing the exact intentional file set.

## Proof Rule

Machine proof and external proof are separate. A command may pass while phone, provider, customer, visual, or account proof remains pending. That pending proof should be visible in `ops/status.json`, `docs/status.md`, and `ops/dashboard.html`.

## Production Rule

This portable harness records testing and GitHub-backed checkpoints. Production deployment commands should live in the consuming project and must be explicitly routed as protected packs.
