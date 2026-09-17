import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("change workflow runs the behavioral, ledger, and generated-portal gates", async () => {
  const workflow = await text(".github/workflows/ci.yml");
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run plan:validate/);
  assert.match(workflow, /npm run portal:build/);
  assert.match(workflow, /git diff --exit-code -- ops\/portfolio-dashboard\.html/);
  assertPinnedActions(workflow);
});

test("release, post-deploy, and drift workflows enforce distinct transitions", async () => {
  const release = await text(".github/workflows/release-gate.yml");
  const postDeploy = await text(".github/workflows/post-deploy.yml");
  const drift = await text(".github/workflows/drift.yml");
  assert.match(release, /--stage release/);
  assert.match(release, /--project/);
  assert.match(release, /--release/);
  assert.match(postDeploy, /--stage post-deploy/);
  assert.match(postDeploy, /--project/);
  assert.match(postDeploy, /--release/);
  assert.match(drift, /schedule:/);
  assert.match(drift, /npm run plan:drift/);
  for (const workflow of [release, postDeploy, drift]) assertPinnedActions(workflow);
});

test("local hooks fail closed on ledger or portal drift", async () => {
  const preCommit = await text(".githooks/pre-commit");
  const prePush = await text(".githooks/pre-push");
  assert.match(preCommit, /set -eu/);
  assert.match(preCommit, /npm run plan:validate/);
  assert.match(preCommit, /npm run portal:build/);
  assert.match(preCommit, /git diff --quiet -- ops\/portfolio-dashboard\.html/);
  assert.match(prePush, /set -eu/);
  assert.match(prePush, /npm test/);
  assert.match(prePush, /npm run plan:drift/);
});

function assertPinnedActions(workflow) {
  const uses = workflow.match(/^\s*uses:\s*([^\s#]+)/gm) || [];
  assert.ok(uses.length >= 2, "expected checkout and setup-node actions");
  for (const entry of uses) {
    assert.match(entry, /@[a-f0-9]{40}$/i, `action is not pinned to a commit: ${entry}`);
  }
}

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}
