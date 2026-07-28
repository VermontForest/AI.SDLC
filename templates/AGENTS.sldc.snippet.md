# AI.SLDC Agent Snippet

Use this project harness before changing durable behavior.

- Start by reading `docs/status.md`, `ops/status.json`, and, when useful, `ops/dashboard.html`.
- JSM spans the workflow: read and apply the methods routed to Assess, Regress, and Finish rather than treating skills as a kickoff-only step.
- Before implementation, run `npm run assess:change-impact -- --files <repo paths> --applied-skill <Assess methods> ...` with a clear Work Contract.
- Before claiming done, run `npm run regress:protected -- --files <repo paths> --applied-skill <Regress methods>`.
- Close the same file set with `npm run finish:iteration -- --intentional-files "<repo paths>" --applied-skill <Finish methods> --skip-git`.
- Add `--execute --commit-message "<message>"` only when staging, committing, and pushing the intentional files is authorized.
- Keep machine proof separate from human, phone, provider, account, or other external proof.
- Use the complete JSM lifecycle, LEQ, and JouleWork as connected loop-health controls. Low LEQ, unproductive JouleWork, stale status, missing verification, missing human-visible proof, and repeated churn are defects.
- Leave unrelated dirty files untouched.

Suggested scripts:

```json
{
  "assess:change-impact": "ai-sldc assess",
  "regress:protected": "ai-sldc regress",
  "finish:iteration": "ai-sldc finish",
  "manage:status": "ai-sldc status",
  "manage:refresh": "ai-sldc refresh",
  "manage:metrics:test": "ai-sldc self-test"
}
```
