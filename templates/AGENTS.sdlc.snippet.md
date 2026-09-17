# AI.SDLC Agent Snippet

Use this project harness before changing durable behavior.

Carl is not the assistant's assistant. Discover and select tools and connectors,
read documentation, and perform authorized routine troubleshooting, setup, edits,
and commands yourself. Do not ask the user to research connector types, choose
implementation tools, or perform routine technical work. Before declaring a
blocker, inspect available capabilities and investigate permitted alternatives.
Ask only for an essential user-owned decision or action, such as authentication
or consent inaccessible to tools, explaining the specific reason. Continue
independent authorized work; never fabricate evidence or claim blocked work done.

- Start by reading `docs/status.md`, `ops/status.json`, and, when useful, `ops/dashboard.html`.
- JSM spans the workflow: read and apply the methods routed to Assess, Regress, and Finish rather than treating skills as a kickoff-only step.
- Before the first workflow run on a machine, run `ai-sdlc skills:verify`; if it fails because packages are absent, use `ai-sdlc skills:install` with an authorized JSM subscription.
- Keep premium JSM skill bodies in JSM-managed local directories. Commit only the AI.SDLC metadata lock and project-owned overlays; do not redistribute premium packages.
- Before implementation, run `npm run assess:change-impact -- --files <repo paths> --applied-skill <Assess methods> ...` with a clear Work Contract.
- Before claiming done, run `npm run regress:protected -- --files <repo paths> --applied-skill <Regress methods>`.
- Close the same file set with `npm run finish:iteration -- --intentional-files "<repo paths>" --applied-skill <Finish methods> --skip-git`.
- Add `--execute --commit-message "<message>"` only when staging, committing, and pushing the intentional files is authorized.
- Keep machine proof separate from human, phone, provider, account, or other external proof.
- Use the complete JSM lifecycle, LEQ, and JouleWork as connected loop-health controls. Low LEQ, unproductive JouleWork, stale status, missing verification, missing human-visible proof, and repeated churn are defects.
- Leave unrelated dirty files untouched.
- After Finish, run `ai-sdlc verify-completion --intentional-files "<repo paths>"` before claiming completion. This read-only gate verifies licensed dependencies, stage and current file/config evidence, pending external proof, LEQ, and JouleWork. Rerun affected stages after changing tested contents.

Suggested scripts:

```json
{
  "assess:change-impact": "ai-sdlc assess",
  "regress:protected": "ai-sdlc regress",
  "finish:iteration": "ai-sdlc finish",
  "manage:status": "ai-sdlc status",
  "manage:refresh": "ai-sdlc refresh",
  "manage:metrics:test": "ai-sdlc self-test",
  "verify:completion": "ai-sdlc verify-completion"
}
```
