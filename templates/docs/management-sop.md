# Management SOP

Last updated: 2026-07-07

## Loop Contract

Every meaningful change starts with a Work Contract:

- Active deliverable
- Why this matters
- Target surface
- Lane
- Boundaries
- Required proof
- Verifier required or not

Accepted `--files` forms:

```bash
npm run assess:change-impact -- --files src/a.ts docs/b.md
npm run assess:change-impact -- --files src/a.ts --files docs/b.md
npm run assess:change-impact -- --files "src/a.ts,docs/b.md"
```

Text flags such as `--active-deliverable`, `--why`, `--boundary`, and `--proof` may contain multi-word text until the next flag.

## Status Vocabulary

Use distinct labels for:

- Current work
- Completed work
- Active pending proof
- Global pending proof
- Verifier proof
- Artifact backup

Completed work should say `Completed deliverable`, not `Active deliverable`.

## Loop Health

LEQ and JouleWork are operating metrics, not decorative numbers. Low scores mean the next Work Contract should either close the active deliverable or recover loop health.
