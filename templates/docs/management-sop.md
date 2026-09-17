# Management SOP

Last updated: 2026-07-07

## Loop Contract

Carl is not the assistant's assistant. Agents discover tools and connectors,
read documentation, investigate permitted alternatives, and execute authorized
routine setup, troubleshooting, edits, and commands themselves. Never delegate
connector research or implementation-tool selection to the user. Ask only for an
essential user-owned decision or inaccessible authentication/consent, with the
specific reason. Investigate capabilities before declaring blockers and continue
independent authorized work without fabricating evidence.

Every meaningful change starts with a Work Contract:

- Active deliverable
- Why this matters
- Target surface
- Lane
- Boundaries
- Required proof
- Verifier required or not

JSM is applied at three separate gates:

- Assess methods trace the change and establish the plan.
- Regress methods govern how protected evidence is produced and reviewed.
- Finish methods govern the bounded closure and handoff.

Every stage records its own `--applied-skill` evidence. Installed skill files
without a stage attestation do not satisfy the gate.

Before the first lifecycle run on a machine, verify the complete official JSM
dependency lock:

```bash
ai-sdlc skills:verify
```

If licensed packages are absent, an authorized subscriber installs them with
`ai-sdlc skills:install`. AI.SDLC commits only names, versions, and integrity
hashes; premium skill bodies remain in JSM-managed local directories.

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

After Finish, run `ai-sdlc verify-completion --intentional-files <paths>`.
Blocked/failed gates, stale tested contents/configuration, missing JSM packages,
pending external proof, or unhealthy metrics prevent completion claims.

LEQ and JouleWork are operating metrics, not decorative numbers. An incomplete
JSM lifecycle reduces LEQ, adds JouleWork waste, and prevents healthy status.
Low scores mean the next Work Contract should either close the active
deliverable or recover loop health.
