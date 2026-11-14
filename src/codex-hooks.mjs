#!/usr/bin/env node
// Process gates retired 2026-11-14 at Carl Weiss's request.
// This hook no longer denies edits or blocks completion.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const RETIRED_NOTICE = "AI.SDLC process gates were retired on 2026-11-14 at Carl Weiss's request. Skill locks, stale LEQ and JouleWork scores, approval records, and completion paperwork no longer block edits or completion. Run the project tests to check the code.";

export function handleEvent(event) {
  const eventName = event?.hook_event_name;
  if (["SessionStart", "SubagentStart", "UserPromptSubmit", "PostCompact", "PreToolUse"].includes(eventName)) {
    return { hookSpecificOutput: { hookEventName: eventName, additionalContext: RETIRED_NOTICE } };
  }
  if (eventName === "Stop") return { systemMessage: RETIRED_NOTICE };
  return {};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
    const result = handleEvent(event);
    const audit = resolve(homedir(), ".codex", "ai-sdlc", "events.jsonl");
    mkdirSync(dirname(audit), { recursive: true });
    appendFileSync(audit, JSON.stringify({
      at: new Date().toISOString(),
      event: event.hook_event_name,
      session: event.session_id,
      decision: "continue"
    }) + "\n");
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    const reason = `AI.SDLC hook notice: ${error.message}. Process gates were retired on 2026-11-14 and this hook does not block.`;
    process.stdout.write(JSON.stringify({ systemMessage: reason }));
  }
}
