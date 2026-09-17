import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("change workflow runs the behavioral, ledger, and generated-portal gates", async () => {
  const workflow = await text(".github/workflows/ci.yml");
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run plan:validate/);
  assert.match(workflow, /npm run portfolio:sync/);
  assert.match(workflow, /portfolio\.ledger\.json/);
  assert.match(workflow, /git diff --exit-code -- ops\/portfolio-dashboard\.html ops\/portfolio-metrics\.json/);
  assertPinnedActions(workflow);
});

test("release, post-deploy, and drift workflows enforce distinct transitions", async () => {
  const release = await text(".github/workflows/release-gate.yml");
  const postDeploy = await text(".github/workflows/post-deploy.yml");
  const drift = await text(".github/workflows/drift.yml");
  const publish = await text(".github/workflows/publish-release.yml");
  assert.match(release, /workflow_call:/);
  assert.match(release, /types: \[published\]/);
  assert.match(release, /--stage release/);
  assert.match(release, /--project/);
  assert.match(release, /--release/);
  assert.match(release, /plan:record-event/);
  assert.match(release, /gh pr create/);
  assert.match(release, /^permissions:\r?\n  contents: read/m);
  assert.match(release, /record-published-release:[\s\S]*?permissions:\r?\n      contents: write\r?\n      pull-requests: write/);
  assert.match(postDeploy, /deployment_status:/);
  assert.match(postDeploy, /--stage post-deploy/);
  assert.match(postDeploy, /--project/);
  assert.match(postDeploy, /--release/);
  assert.match(postDeploy, /plan:record-event/);
  assert.match(postDeploy, /gh pr create/);
  assert.match(postDeploy, /^permissions:\r?\n  contents: read/m);
  assert.match(postDeploy, /record-successful-deployment:[\s\S]*?permissions:\r?\n      contents: write\r?\n      pull-requests: write/);
  assert.match(drift, /schedule:/);
  assert.match(drift, /npm run plan:drift/);
  assert.match(drift, /npm run portfolio:sync/);
  assert.match(publish, /uses: \.\/.github\/workflows\/release-gate\.yml/);
  assert.match(publish, /needs: release-gate/);
  assert.match(publish, /gh release create/);
  assert.match(publish, /plan:record-event/);
  assert.match(publish, /gh pr create/);
  for (const workflow of [release, postDeploy, drift, publish]) assertPinnedActions(workflow, workflow === publish ? 1 : 2);
});

test("local hooks fail closed on ledger or portal drift", async () => {
  const preCommit = await text(".githooks/pre-commit");
  const prePush = await text(".githooks/pre-push");
  assert.match(preCommit, /set -eu/);
  assert.match(preCommit, /npm run plan:validate/);
  assert.match(preCommit, /npm run portfolio:sync/);
  assert.match(preCommit, /portfolio\.ledger\.json/);
  assert.match(preCommit, /git diff --quiet -- ops\/portfolio-dashboard\.html ops\/portfolio-metrics\.json/);
  assert.match(prePush, /set -eu/);
  assert.match(prePush, /npm test/);
  assert.match(prePush, /npm run plan:drift/);
  assert.match(prePush, /npm run portfolio:sync/);
});

function assertPinnedActions(workflow, minimum = 2) {
  const uses = workflow.match(/^\s*uses:\s*([^\s#]+)/gm) || [];
  assert.ok(uses.length >= minimum, `expected at least ${minimum} pinned external action(s)`);
  for (const entry of uses) {
    if (entry.includes("./.github/workflows/")) continue;
    assert.match(entry, /@[a-f0-9]{40}$/i, `action is not pinned to a commit: ${entry}`);
  }
}

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}
