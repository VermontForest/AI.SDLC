import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPortfolioPortal, validateLedger } from "../src/portfolio.mjs";

const NOW = new Date("2026-09-17T12:00:00.000Z");

test("valid change, release, post-deploy, and drift transitions pass", async () => {
  const { ledger, root } = await fixture();
  for (const stage of ["change", "release", "post-deploy", "drift"]) {
    const report = await validateLedger(ledger, { root, stage, projectId: "demo", releaseId: stage.includes("release") || stage === "post-deploy" ? "REL-001" : null, now: NOW });
    assert.equal(report.ok, true, `${stage}: ${report.errors.map((item) => item.message).join("; ")}`);
  }
});

test("schema violations and broken traceability links fail", async () => {
  const { ledger, root } = await fixture();
  delete ledger.projects[0].outcome;
  let report = await validateLedger(ledger, { root, stage: "change", now: NOW });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((item) => item.code === "schema"));

  const second = await fixture();
  second.ledger.projects[0].work_items[0].implements = ["FRS-MISSING"];
  report = await validateLedger(second.ledger, { root: second.root, stage: "change", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "bad_link"));
});

test("required verification types and evidence are enforced", async () => {
  const { ledger, root } = await fixture();
  ledger.projects[0].work_items[0].tests = ledger.projects[0].work_items[0].tests.filter((item) => item.type !== "production");
  let report = await validateLedger(ledger, { root, stage: "change", projectId: "demo", workItemId: "WBS-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "missing_test_type"));

  const second = await fixture();
  second.ledger.projects[0].work_items[0].tests[0].evidence_ids = [];
  report = await validateLedger(second.ledger, { root: second.root, stage: "change", projectId: "demo", workItemId: "WBS-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "missing_evidence"));
});

test("a failed task blocks itself but not an unrelated scoped task", async () => {
  const { ledger, root } = await fixture();
  ledger.projects[0].status = "active";
  ledger.projects[0].work_items.push({
    id: "WBS-002",
    title: "Legacy failed task",
    status: "failed",
    implements: ["FRS-001"],
    affected_surfaces: ["legacy"],
    protected_contracts: [],
    required_test_types: ["unit"],
    tests: [{ id: "TST-003", type: "unit", status: "failed", evidence_ids: [] }],
    changed_files: [],
    blockers: ["Known legacy defect"],
    next_actions: ["Repair separately"]
  });
  const scoped = await validateLedger(ledger, { root, stage: "change", projectId: "demo", workItemId: "WBS-001", now: NOW });
  assert.equal(scoped.ok, true, scoped.errors.map((item) => item.message).join("; "));
  const failed = await validateLedger(ledger, { root, stage: "change", projectId: "demo", workItemId: "WBS-002", now: NOW });
  assert.ok(failed.errors.some((item) => item.code === "task_failed"));
});

test("release gate rejects missing approval and an unready rollback", async () => {
  const { ledger, root } = await fixture();
  ledger.projects[0].approvals[0].status = "pending";
  ledger.projects[0].approvals[0].decided_at = undefined;
  ledger.projects[0].releases[0].rollback.status = "planned";
  const report = await validateLedger(ledger, { root, stage: "release", projectId: "demo", releaseId: "REL-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "approval_missing"));
  assert.ok(report.errors.some((item) => item.code === "rollback_not_ready"));
});

test("content claims reject delivery-only artifacts and absent comparisons", async () => {
  const first = await fixture();
  first.ledger.projects[0].artifacts[1].revision_type = "delivery";
  let report = await validateLedger(first.ledger, { root: first.root, stage: "release", projectId: "demo", releaseId: "REL-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "false_content_claim"));

  const second = await fixture();
  second.ledger.projects[0].artifacts[1].comparison_evidence_ids = [];
  report = await validateLedger(second.ledger, { root: second.root, stage: "release", projectId: "demo", releaseId: "REL-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "missing_outcome_evidence"));
});

test("release gate detects wrong artifact identity", async () => {
  const { ledger, root } = await fixture();
  ledger.projects[0].artifacts[1].sha256 = "0".repeat(64);
  const report = await validateLedger(ledger, { root, stage: "release", projectId: "demo", releaseId: "REL-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "artifact_mismatch"));
});

test("post-deploy gate requires real deployment and production proof", async () => {
  const { ledger, root } = await fixture();
  ledger.projects[0].releases[0].deployment.status = "not_started";
  ledger.projects[0].releases[0].deployment.deployed_at = undefined;
  ledger.projects[0].releases[0].production_test_ids = [];
  const report = await validateLedger(ledger, { root, stage: "post-deploy", projectId: "demo", releaseId: "REL-001", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "deployment_missing"));
  assert.ok(report.errors.some((item) => item.code === "production_proof_missing"));
});

test("drift gate rejects stale project and metric state", async () => {
  const { ledger, root } = await fixture();
  ledger.projects[0].updated_at = "2026-01-01T00:00:00.000Z";
  ledger.projects[0].metrics.leq.measured_at = "2026-01-01T00:00:00.000Z";
  const report = await validateLedger(ledger, { root, stage: "drift", projectId: "demo", now: NOW });
  assert.ok(report.errors.some((item) => item.code === "stale_project"));
  assert.ok(report.errors.some((item) => item.code === "stale_metric"));
});

test("portal is generated from the validated ledger", async () => {
  const { ledger, root } = await fixture();
  await writeFile(join(root, "portfolio.json"), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  const result = await buildPortfolioPortal(["--ledger", "portfolio.json", "--output", "dashboard.html"], { root, now: NOW });
  assert.equal(result.exitCode, 0);
  const html = await readFile(join(root, "dashboard.html"), "utf8");
  assert.match(html, /id="human-dashboard"/);
  assert.match(html, /Demo Project/);
  assert.match(html, /WBS-001/);
  assert.match(html, /Ledger passes the change gate/);
});

test("saved portal output is deterministic for an unchanged ledger", async () => {
  const { ledger, root } = await fixture();
  await writeFile(join(root, "portfolio.json"), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await buildPortfolioPortal(["--ledger", "portfolio.json", "--output", "first.html"], { root });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  await buildPortfolioPortal(["--ledger", "portfolio.json", "--output", "second.html"], { root });
  assert.equal(await readFile(join(root, "first.html"), "utf8"), await readFile(join(root, "second.html"), "utf8"));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-sdlc-portfolio-"));
  const artifactBytes = "new-content\n";
  await writeFile(join(root, "artifact.txt"), artifactBytes, "utf8");
  const artifactHash = createHash("sha256").update(artifactBytes).digest("hex");
  const oldHash = createHash("sha256").update("old-content\n").digest("hex");
  const ledger = {
    schema_version: 1,
    portfolio: { id: "demo-portfolio", name: "Demo Portfolio", updated_at: "2026-09-17T10:00:00.000Z", stale_after_days: 30, mode: "standard" },
    projects: [{
      id: "demo",
      name: "Demo Project",
      outcome: "Prove executable traceability.",
      status: "production_proven",
      updated_at: "2026-09-17T10:00:00.000Z",
      requirements: [
        { id: "URS-001", type: "user", text: "A user gets the proven outcome.", status: "verified", acceptance: ["Outcome is observable."] },
        { id: "FRS-001", type: "functional", text: "The system produces the outcome.", status: "verified", derived_from: ["URS-001"], acceptance: ["Tests pass."] }
      ],
      work_items: [{
        id: "WBS-001",
        title: "Build proven outcome",
        status: "complete",
        implements: ["FRS-001"],
        affected_surfaces: ["app"],
        protected_contracts: ["outcome proof"],
        required_test_types: ["unit", "production"],
        tests: [
          { id: "TST-001", type: "unit", status: "passed", command: "npm test", evidence_ids: ["EV-001"] },
          { id: "TST-002", type: "production", status: "passed", evidence_ids: ["EV-006"] }
        ],
        changed_files: ["artifact.txt"],
        blockers: [],
        next_actions: []
      }],
      evidence: [
        { id: "EV-001", type: "test_report", status: "passed", created_at: "2026-09-17T10:01:00.000Z", summary: "Unit tests passed." },
        { id: "EV-002", type: "artifact_identity", status: "passed", created_at: "2026-09-17T10:02:00.000Z", summary: "Artifact hash recorded.", sha256: artifactHash, artifact_ids: ["ART-002"] },
        { id: "EV-003", type: "behavioral_comparison", status: "passed", created_at: "2026-09-17T10:03:00.000Z", summary: "Before and after behavior differ as required.", artifact_ids: ["ART-001", "ART-002"] },
        { id: "EV-004", type: "approval_record", status: "passed", created_at: "2026-09-17T10:04:00.000Z", summary: "Operator approved release." },
        { id: "EV-005", type: "deployment_record", status: "passed", created_at: "2026-09-17T10:05:00.000Z", summary: "Deployment completed." },
        { id: "EV-006", type: "production_check", status: "passed", created_at: "2026-09-17T10:06:00.000Z", summary: "Production outcome passed." }
      ],
      artifacts: [
        { id: "ART-001", label: "Previous artifact", uri: "https://example.invalid/old", sha256: oldHash, revision_type: "content", comparison_evidence_ids: [] },
        { id: "ART-002", label: "Current artifact", uri: "artifact.txt", sha256: artifactHash, revision_type: "content", supersedes: "ART-001", comparison_evidence_ids: ["EV-003"] }
      ],
      approvals: [{ id: "APR-001", scope: "Release demo", required: true, status: "approved", decided_at: "2026-09-17T10:04:00.000Z", evidence_id: "EV-004" }],
      releases: [{
        id: "REL-001",
        title: "Demo release",
        status: "production_proven",
        work_item_ids: ["WBS-001"],
        artifact_id: "ART-002",
        content_change_claimed: true,
        approval_ids: ["APR-001"],
        rollback: { status: "ready", reference: "Restore ART-001" },
        deployment: { status: "deployed", environment: "production", deployed_at: "2026-09-17T10:05:00.000Z", evidence_id: "EV-005" },
        production_test_ids: ["TST-002"]
      }],
      metrics: {
        leq: { status: "measured", score: 96, classification: "healthy", measured_at: "2026-09-17T10:00:00.000Z", source: "fixture" },
        joulework: { status: "measured", score: 90, classification: "productive", measured_at: "2026-09-17T10:00:00.000Z", source: "fixture" }
      },
      blockers: [],
      next_actions: []
    }]
  };
  return { ledger, root };
}
