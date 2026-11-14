import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleEvent, RETIRED_NOTICE } from "./codex-hooks.mjs";

test("edits and completion are not blocked after the process gates were retired", () => {
  const root = mkdtempSync(join(tmpdir(), "ai-sdlc-hook-"));
  writeFileSync(join(root, "source.txt"), "before");
  const edit = handleEvent({
    session_id: "session",
    turn_id: "turn",
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Update File: source.txt\n@@\n-before\n+after\n*** End Patch" }
  });
  assert.equal(edit.hookSpecificOutput.permissionDecision, undefined);
  assert.match(edit.hookSpecificOutput.additionalContext, /retired on 2026-11-14/);
  assert.equal(readFileSync(join(root, "source.txt"), "utf8"), "before");

  const stop = handleEvent({ hook_event_name: "Stop", cwd: root, session_id: "session", turn_id: "turn" });
  assert.equal(stop.decision, undefined);
  assert.equal(stop.systemMessage, RETIRED_NOTICE);
});

test("startup events explain that the process gates are retired", () => {
  for (const name of ["SessionStart", "SubagentStart", "UserPromptSubmit", "PostCompact"]) {
    const result = handleEvent({ hook_event_name: name });
    assert.equal(result.hookSpecificOutput.hookEventName, name);
    assert.match(result.hookSpecificOutput.additionalContext, /Carl Weiss/);
  }
});

test("a broken stop event does not block the agent", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./codex-hooks.mjs", import.meta.url))], {
    input: "{",
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, undefined);
  assert.match(parsed.systemMessage, /does not block/);
});
