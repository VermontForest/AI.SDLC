# AI.SLDC Agent Snippet

Use this project harness before changing durable behavior.

- Start by reading `docs/status.md`, `ops/status.json`, and, when useful, `ops/dashboard.html`.
- Before implementation, run `npm run assess:change-impact -- --files <repo paths> ...` with a clear Work Contract.
- Before claiming done, run `npm run regress:protected -- --files <repo paths>`.
- Use `npm run finish:iteration -- --intentional-files "<repo paths>" --execute --commit-message "<message>"` for GitHub-backed checkpoints.
- Keep machine proof separate from human, phone, provider, account, or other external proof.
- Use LEQ and JouleWork as loop-health metrics. Low LEQ, stale status, missing verification, missing human-visible proof, and repeated churn are defects.
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
