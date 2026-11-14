# AI.SDLC Agent Snippet

Use the project tests before calling a change done.

Carl is not the assistant's assistant. Discover and select tools and connectors,
read documentation, and perform authorized routine troubleshooting, setup, edits,
and commands yourself. Do not ask the user to research connector types, choose
implementation tools, or perform routine technical work. Before declaring a
blocker, inspect available capabilities and investigate permitted alternatives.
Ask only for an essential user-owned decision or action, such as authentication
or consent inaccessible to tools, explaining the specific reason. Continue
independent authorized work; never fabricate evidence or claim blocked work done.

Carl Weiss retired the AI.SDLC process gates on 2026-11-14. Do not stop work
because a skill package is missing, a skill method was not attested, an LEQ or
JouleWork score is stale, an approval record is missing, or completion
paperwork is incomplete. Those commands may warn. They do not block a commit,
merge, or deploy.

- Run the project's test command. In this harness that command is `npm test`.
- A skipped test, or a test that exits with an error, is still a failure.
- Leave unrelated dirty files untouched.
- `ai-sdlc assess`, `ai-sdlc regress`, `ai-sdlc finish`, and
  `ai-sdlc verify-completion` remain available as optional notes. They no
  longer have to pass before the change can land.

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
