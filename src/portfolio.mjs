import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(packageRoot, "schemas", "portfolio-ledger.schema.json");
const COMPLETED = new Set(["passed", "verified", "complete", "ready", "released", "production_proven"]);
const REVISION_PROOF = new Set(["visual_comparison", "motion_comparison", "behavioral_comparison"]);
const NON_EXECUTING = new Set(["planned", "queued", "deferred"]);
const METRIC_DEFINITIONS = {
  leq: "Loop Evidence Quality: requirement linkage, declared and passed verification, evidence linkage, blocker-free execution, and explicit failure penalties.",
  joulework: "JouleWork proxy: evidence-backed useful work credited from linkage, passed verification, evidence, and completed outcomes, minus failure and blocker penalties."
};

export async function validatePortfolio(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const ledgerPath = resolve(root, text(args.ledger) || "portfolio.ledger.json");
  const stage = text(args.stage) || "change";
  const ledger = await readJson(ledgerPath);
  const report = await validateLedger(ledger, {
    root: dirname(ledgerPath),
    stage,
    projectId: text(args.project),
    workItemId: text(args.workItem),
    releaseId: text(args.release),
    now: options.now || new Date()
  });
  printValidation(report);
  return { value: report, printJson: Boolean(args.json), exitCode: report.ok ? 0 : 1 };
}

export async function buildPortfolioPortal(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const ledgerPath = resolve(root, text(args.ledger) || "portfolio.ledger.json");
  const outputPath = resolve(root, text(args.output) || "ops/portfolio-dashboard.html");
  const ledger = await readJson(ledgerPath);
  const generatedAt = options.now || new Date(ledger.portfolio.updated_at);
  const report = await validateLedger(ledger, { root: dirname(ledgerPath), stage: "change", now: generatedAt });
  const metrics = computePortfolioMetrics(ledger, generatedAt);
  const html = renderPortfolioPortal(ledger, report, generatedAt, metrics);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(`Portfolio validation: ${report.ok ? "passed" : "blocked"}; ${report.errors.length} blocking issue(s)`);
  return { value: { output: outputPath, validation: report }, printJson: Boolean(args.json), exitCode: report.ok ? 0 : 1 };
}

export async function syncPortfolio(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const ledgerPath = resolve(root, text(args.ledger) || "portfolio.ledger.json");
  const outputPath = resolve(root, text(args.output) || "ops/portfolio-dashboard.html");
  const metricsPath = resolve(root, text(args.metricsOutput) || "ops/portfolio-metrics.json");
  const ledger = await readJson(ledgerPath);
  const generatedAt = options.now || new Date(ledger.portfolio.updated_at);
  const report = await validateLedger(ledger, { root: dirname(ledgerPath), stage: "change", now: generatedAt });
  const metrics = computePortfolioMetrics(ledger, generatedAt);
  const html = renderPortfolioPortal(ledger, report, generatedAt, metrics);
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(metricsPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${metricsPath}`);
  console.log(`Portfolio validation: ${report.ok ? "passed" : "blocked"}; ${report.errors.length} blocking issue(s)`);
  return { value: { output: outputPath, metrics: metricsPath, validation: report }, printJson: Boolean(args.json), exitCode: report.ok ? 0 : 1 };
}

export async function servePortfolioPortal(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const ledgerPath = resolve(root, text(args.ledger) || "portfolio.ledger.json");
  const host = text(args.host) || "127.0.0.1";
  const port = Number(text(args.port) || 5190);
  const server = createServer(async (request, response) => {
    try {
      const ledger = await readJson(ledgerPath);
      if (request.url?.startsWith("/api/ledger")) {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(`${JSON.stringify(ledger, null, 2)}\n`);
        return;
      }
      const now = new Date();
      const change = await validateLedger(ledger, { root: dirname(ledgerPath), stage: "change", now });
      const drift = await validateLedger(ledger, { root: dirname(ledgerPath), stage: "drift", now });
      const report = mergeReports(change, drift);
      const metrics = computePortfolioMetrics(ledger, now);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(renderPortfolioPortal(ledger, report, now, metrics));
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`AI.SDLC portal failed: ${error?.message || String(error)}`);
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, resolvePromise);
  });
  console.log(`AI.SDLC portfolio portal: http://${host}:${port}/#human-dashboard`);
  return new Promise(() => {});
}

export async function recordLifecycleEvent(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const ledgerPath = resolve(root, text(args.ledger) || "portfolio.ledger.json");
  const event = text(args.event);
  const reference = text(args.ref);
  const runUrl = text(args.runUrl);
  const occurredAt = new Date(text(args.at) || options.now || new Date());
  if (!['release', 'deployment'].includes(event)) throw new Error("plan:record-event requires --event release or deployment.");
  if (!reference) throw new Error("plan:record-event requires --ref.");
  if (!runUrl) throw new Error("plan:record-event requires --run-url.");
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("plan:record-event received an invalid --at timestamp.");

  const ledger = await readJson(ledgerPath);
  const target = resolveLifecycleTarget(ledger, {
    event,
    reference,
    projectId: text(args.project),
    releaseId: text(args.release)
  });
  const timestamp = occurredAt.toISOString();
  const evidenceId = uniqueEvidenceId(target.project, `EV-${event.toUpperCase()}-${reference}`);

  if (event === "release") {
    const before = await validateLedger(ledger, {
      root: dirname(ledgerPath),
      stage: "release",
      projectId: target.project.id,
      releaseId: target.release.id,
      now: occurredAt
    });
    if (!before.ok) {
      printValidation(before);
      return { value: before, printJson: Boolean(args.json), exitCode: 1 };
    }
    target.project.evidence.push({
      id: evidenceId,
      type: "release_record",
      status: "passed",
      created_at: timestamp,
      summary: `GitHub release ${reference} was published and the registered release gate passed.`,
      uri: runUrl,
      artifact_ids: [target.release.artifact_id]
    });
    target.release.status = "released";
    if (["ready", "verified", "complete"].includes(target.project.status)) target.project.status = "released";
  } else {
    target.project.evidence.push({
      id: evidenceId,
      type: "deployment_record",
      status: "passed",
      created_at: timestamp,
      summary: `GitHub deployment ${reference} reported success.`,
      uri: runUrl,
      artifact_ids: [target.release.artifact_id]
    });
    target.release.status = "released";
    target.release.deployment.status = "deployed";
    target.release.deployment.ref = reference;
    target.release.deployment.deployed_at = timestamp;
    target.release.deployment.evidence_id = evidenceId;
    const after = await validateLedger(ledger, {
      root: dirname(ledgerPath),
      stage: "post-deploy",
      projectId: target.project.id,
      releaseId: target.release.id,
      now: occurredAt
    });
    if (!after.ok) {
      printValidation(after);
      return { value: after, printJson: Boolean(args.json), exitCode: 1 };
    }
    target.release.status = "production_proven";
    target.project.status = "production_proven";
  }

  target.project.updated_at = timestamp;
  ledger.portfolio.updated_at = timestamp;
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  const sync = await syncPortfolio([
    "--ledger", ledgerPath,
    "--output", text(args.output) || resolve(dirname(ledgerPath), "ops/portfolio-dashboard.html"),
    "--metrics-output", text(args.metricsOutput) || resolve(dirname(ledgerPath), "ops/portfolio-metrics.json")
  ], { root, now: occurredAt });
  return {
    value: { event, reference, project_id: target.project.id, release_id: target.release.id, evidence_id: evidenceId, sync: sync.value },
    printJson: Boolean(args.json),
    exitCode: sync.exitCode
  };
}

export async function hashArtifact(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const target = resolve(root, text(args.file) || "");
  if (!text(args.file) || !existsSync(target)) throw new Error("artifact:hash requires an existing --file.");
  const sha256 = await sha256File(target);
  return { value: { file: target, sha256 }, printJson: true };
}

export async function validateLedger(ledger, options = {}) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("date-time", (value) => Number.isFinite(Date.parse(value)));
  const checkSchema = ajv.compile(schema);
  const schemaOk = checkSchema(ledger);
  const issues = [];
  for (const error of checkSchema.errors || []) {
    issues.push(issue("schema", "portfolio", error.instancePath || "/", `${error.message || "schema violation"}${error.params?.missingProperty ? `: ${error.params.missingProperty}` : ""}`));
  }
  if (!schemaOk) return reportFor(ledger, options, issues);

  const projectIds = new Set();
  for (const project of ledger.projects) {
    if (projectIds.has(project.id)) issues.push(issue("duplicate_id", project.id, "change", `Duplicate project id ${project.id}.`));
    projectIds.add(project.id);
    validateProjectLinks(project, issues);
  }

  const selectedProjects = selectProjects(ledger, options, issues);
  if (options.stage === "change") {
    for (const project of selectedProjects) validateChangeStage(project, options, issues);
  } else if (options.stage === "release") {
    for (const project of selectedProjects) await validateReleaseStage(project, options, issues);
  } else if (options.stage === "post-deploy") {
    for (const project of selectedProjects) validatePostDeployStage(project, options, issues);
  } else if (options.stage === "drift") {
    validateDriftStage(ledger, selectedProjects, options, issues);
  } else {
    issues.push(issue("unknown_stage", "portfolio", options.stage, `Unknown validation stage ${options.stage}.`));
  }
  validateDataQualityStage(ledger, selectedProjects, options, issues);
  return reportFor(ledger, options, issues);
}

function validateProjectLinks(project, issues) {
  validateStateContract(project, project, issues);
  const ids = new Map();
  const add = (id, kind) => {
    if (ids.has(id)) issues.push(issue("duplicate_id", project.id, "change", `${id} is used by both ${ids.get(id)} and ${kind}.`));
    ids.set(id, kind);
  };
  project.requirements.forEach((item) => add(item.id, "requirement"));
  project.work_items.forEach((item) => {
    add(item.id, "work item");
    item.tests.forEach((test) => add(test.id, "test"));
  });
  project.evidence.forEach((item) => add(item.id, "evidence"));
  project.artifacts.forEach((item) => add(item.id, "artifact"));
  project.approvals.forEach((item) => add(item.id, "approval"));
  project.releases.forEach((item) => add(item.id, "release"));

  const requirements = new Map(project.requirements.map((item) => [item.id, item]));
  const workItems = new Map(project.work_items.map((item) => [item.id, item]));
  const tests = new Map(project.work_items.flatMap((item) => item.tests).map((item) => [item.id, item]));
  const evidence = new Map(project.evidence.map((item) => [item.id, item]));
  const artifacts = new Map(project.artifacts.map((item) => [item.id, item]));
  const approvals = new Map(project.approvals.map((item) => [item.id, item]));

  for (const requirement of project.requirements) {
    if (requirement.type === "functional") {
      if (!requirement.derived_from?.length) issues.push(issue("missing_trace", project.id, "change", `${requirement.id} does not derive from a user requirement.`));
      for (const parentId of requirement.derived_from || []) {
        const parent = requirements.get(parentId);
        if (!parent || parent.type !== "user") issues.push(issue("bad_link", project.id, "change", `${requirement.id} derives from missing or non-user requirement ${parentId}.`));
      }
    }
  }
  for (const workItem of project.work_items) {
    validateStateContract(project, workItem, issues);
    for (const requirementId of workItem.implements) {
      const requirement = requirements.get(requirementId);
      if (!requirement || requirement.type !== "functional") issues.push(issue("bad_link", project.id, "change", `${workItem.id} implements missing or non-functional requirement ${requirementId}.`, workItem.id));
    }
    const presentTypes = new Set(workItem.tests.map((test) => test.type));
    for (const requiredType of workItem.required_test_types) {
      if (!presentTypes.has(requiredType)) issues.push(issue("missing_test_type", project.id, "change", `${workItem.id} requires a ${requiredType} test but none is declared.`, workItem.id));
    }
    for (const test of workItem.tests) {
      for (const evidenceId of test.evidence_ids) {
        if (!evidence.has(evidenceId)) issues.push(issue("bad_link", project.id, "change", `${test.id} references missing evidence ${evidenceId}.`, workItem.id));
      }
      if (test.status === "passed") {
        if (!test.evidence_ids.length) issues.push(issue("missing_evidence", project.id, "change", `${test.id} is passed without evidence.`, workItem.id));
        for (const evidenceId of test.evidence_ids) {
          if (evidence.get(evidenceId)?.status !== "passed") issues.push(issue("unpassed_evidence", project.id, "change", `${test.id} relies on evidence ${evidenceId} that is not passed.`, workItem.id));
        }
      }
    }
  }
  for (const approval of project.approvals) {
    if (approval.evidence_id && !evidence.has(approval.evidence_id)) issues.push(issue("bad_link", project.id, "change", `${approval.id} references missing evidence ${approval.evidence_id}.`));
    if (approval.status === "approved" && approval.required && !approval.decided_at) issues.push(issue("missing_decision_time", project.id, "change", `${approval.id} is approved without decided_at.`));
  }
  for (const artifact of project.artifacts) {
    if (artifact.supersedes && !artifacts.has(artifact.supersedes)) issues.push(issue("bad_link", project.id, "change", `${artifact.id} supersedes missing artifact ${artifact.supersedes}.`));
    for (const evidenceId of artifact.comparison_evidence_ids || []) {
      if (!evidence.has(evidenceId)) issues.push(issue("bad_link", project.id, "change", `${artifact.id} references missing comparison evidence ${evidenceId}.`));
    }
  }
  for (const release of project.releases) {
    release.work_item_ids.forEach((id) => {
      if (!workItems.has(id)) issues.push(issue("bad_link", project.id, "change", `${release.id} references missing work item ${id}.`));
    });
    if (!artifacts.has(release.artifact_id)) issues.push(issue("bad_link", project.id, "change", `${release.id} references missing artifact ${release.artifact_id}.`));
    release.approval_ids.forEach((id) => {
      if (!approvals.has(id)) issues.push(issue("bad_link", project.id, "change", `${release.id} references missing approval ${id}.`));
    });
    release.production_test_ids.forEach((id) => {
      if (!tests.has(id)) issues.push(issue("bad_link", project.id, "change", `${release.id} references missing production test ${id}.`));
    });
    if (release.deployment.evidence_id && !evidence.has(release.deployment.evidence_id)) issues.push(issue("bad_link", project.id, "change", `${release.id} references missing deployment evidence ${release.deployment.evidence_id}.`));
  }
}

function validateStateContract(project, subject, issues) {
  const blockers = subject.blockers || [];
  const actions = subject.blocker_actions || [];
  const label = subject.id || project.id;
  const isBlocked = ["blocked", "failed"].includes(subject.status);
  if (subject.status === "queued" && !subject.state_reason) {
    issues.push(issue("missing_state_reason", project.id, "change", `${label} is queued without a queue reason.`, subject === project ? null : subject.id));
  }
  if (subject.status === "waiting_dependency" && (!(subject.waiting_on || []).length || !subject.state_reason)) {
    issues.push(issue("missing_dependency", project.id, "change", `${label} is waiting on a dependency without naming the dependency and reason.`, subject === project ? null : subject.id));
  }
  if (subject.status === "unknown" && !subject.state_reason) {
    issues.push(issue("unknown_without_reason", project.id, "change", `${label} is unknown without an explanation.`, subject === project ? null : subject.id));
  }
  if (isBlocked && !blockers.length) {
    issues.push(issue("blocked_without_impediment", project.id, "change", `${label} is ${subject.status} without an evidenced impediment.`, subject === project ? null : subject.id));
  }
  if (!isBlocked && blockers.length) {
    issues.push(issue("misclassified_blocker", project.id, "change", `${label} lists blockers but is ${subject.status}; use queued, waiting_dependency, unknown, or a real blocked state accurately.`, subject === project ? null : subject.id));
  }
  if (!isBlocked && actions.length) {
    issues.push(issue("orphan_blocker_action", project.id, "change", `${label} has blocker-clearing actions without a blocked or failed state.`, subject === project ? null : subject.id));
  }
  if (isBlocked) {
    const byBlocker = new Map(actions.map((item) => [item.blocker, item]));
    for (const blocker of blockers) {
      const action = byBlocker.get(blocker);
      if (!action?.clear_action || !action?.owner) {
        issues.push(issue("blocker_without_clear_action", project.id, "change", `${label} blocker “${blocker}” has no clearing action and owner.`, subject === project ? null : subject.id));
      }
    }
  }
}

function validateChangeStage(project, options, issues) {
  const selected = options.workItemId
    ? project.work_items.filter((item) => item.id === options.workItemId)
    : project.work_items;
  if (options.workItemId && !selected.length) {
    issues.push(issue("missing_scope", project.id, "change", `Work item ${options.workItemId} was not found.`));
    return;
  }
  for (const workItem of selected) {
    if (["verified", "complete"].includes(workItem.status)) validateCompletedWorkItem(project, workItem, issues, "change");
    if (workItem.status === "failed") issues.push(issue("task_failed", project.id, "change", `${workItem.id} is failed and cannot pass its own gate.`, workItem.id));
  }
  if (["verified", "complete", "production_proven"].includes(project.status)) {
    const incomplete = project.work_items.filter((item) => !["verified", "complete", "deferred"].includes(item.status));
    if (incomplete.length) issues.push(issue("contradictory_status", project.id, "change", `${project.id} is ${project.status} while work remains incomplete: ${incomplete.map((item) => item.id).join(", ")}.`));
  }
}

function validateCompletedWorkItem(project, workItem, issues, stage) {
  if (workItem.blockers?.length) issues.push(issue("open_blocker", project.id, stage, `${workItem.id} is ${workItem.status} with open blockers.`, workItem.id));
  const required = new Set(workItem.required_test_types);
  for (const type of required) {
    const matching = workItem.tests.filter((test) => test.type === type);
    if (!matching.some((test) => ["passed", "not_applicable"].includes(test.status))) {
      issues.push(issue("test_not_passed", project.id, stage, `${workItem.id} lacks passed ${type} verification.`, workItem.id));
    }
  }
  for (const test of workItem.tests.filter((item) => item.status === "failed")) {
    issues.push(issue("test_failed", project.id, stage, `${workItem.id} has failed test ${test.id}.`, workItem.id));
  }
}

async function validateReleaseStage(project, options, issues) {
  const releases = selectReleases(project, options, issues, "release");
  const workItems = new Map(project.work_items.map((item) => [item.id, item]));
  const artifacts = new Map(project.artifacts.map((item) => [item.id, item]));
  const approvals = new Map(project.approvals.map((item) => [item.id, item]));
  const evidence = new Map(project.evidence.map((item) => [item.id, item]));
  for (const release of releases) {
    for (const id of release.work_item_ids) {
      const workItem = workItems.get(id);
      if (!workItem || !["verified", "complete"].includes(workItem.status)) issues.push(issue("work_not_complete", project.id, "release", `${release.id} includes work ${id} that is not verified or complete.`, id, release.id));
      else validateCompletedWorkItem(project, workItem, issues, "release");
    }
    const artifact = artifacts.get(release.artifact_id);
    if (artifact) {
      const localPath = localArtifactPath(options.root, artifact.uri);
      if (localPath && existsSync(localPath)) {
        const actual = await sha256File(localPath);
        if (actual !== artifact.sha256) issues.push(issue("artifact_mismatch", project.id, "release", `${artifact.id} hash does not match ${artifact.uri}.`, null, release.id));
      }
      if (release.content_change_claimed) {
        if (artifact.revision_type !== "content") issues.push(issue("false_content_claim", project.id, "release", `${release.id} claims a content change but ${artifact.id} is delivery-only.`, null, release.id));
        const comparisons = (artifact.comparison_evidence_ids || []).map((id) => evidence.get(id)).filter(Boolean);
        if (!comparisons.some((item) => REVISION_PROOF.has(item.type) && item.status === "passed" && (item.artifact_ids || []).includes(artifact.id))) {
          issues.push(issue("missing_outcome_evidence", project.id, "release", `${release.id} claims changed content without passed before/after visual, motion, or behavioral evidence for ${artifact.id}.`, null, release.id));
        }
      }
    }
    for (const id of release.approval_ids) {
      const approval = approvals.get(id);
      if (approval?.required && approval.status !== "approved") issues.push(issue("approval_missing", project.id, "release", `${release.id} requires approved decision ${id}.`, null, release.id));
    }
    if (!release.rollback?.reference || !["ready", "tested"].includes(release.rollback.status)) issues.push(issue("rollback_not_ready", project.id, "release", `${release.id} has no ready rollback record.`, null, release.id));
  }
}

function validatePostDeployStage(project, options, issues) {
  const releases = selectReleases(project, options, issues, "post-deploy");
  const tests = new Map(project.work_items.flatMap((item) => item.tests).map((item) => [item.id, item]));
  const evidence = new Map(project.evidence.map((item) => [item.id, item]));
  for (const release of releases) {
    if (!["released", "production_proven"].includes(release.status)) issues.push(issue("not_released", project.id, "post-deploy", `${release.id} is not marked released.`, null, release.id));
    if (release.deployment.status !== "deployed" || !release.deployment.deployed_at) issues.push(issue("deployment_missing", project.id, "post-deploy", `${release.id} lacks a completed deployment record.`, null, release.id));
    if (!release.deployment.evidence_id || evidence.get(release.deployment.evidence_id)?.status !== "passed") issues.push(issue("deployment_evidence_missing", project.id, "post-deploy", `${release.id} lacks passed deployment evidence.`, null, release.id));
    if (!release.production_test_ids.length) issues.push(issue("production_proof_missing", project.id, "post-deploy", `${release.id} has no production verification.`));
    for (const id of release.production_test_ids) {
      const test = tests.get(id);
      if (!test || test.type !== "production" || test.status !== "passed" || !test.evidence_ids.some((evidenceId) => evidence.get(evidenceId)?.status === "passed")) {
        issues.push(issue("production_test_not_passed", project.id, "post-deploy", `${release.id} production test ${id} is not evidence-backed and passed.`, null, release.id));
      }
    }
  }
}

function validateDriftStage(ledger, projects, options, issues) {
  const now = options.now || new Date();
  const maxAge = ledger.portfolio.stale_after_days;
  if (ageDays(ledger.portfolio.updated_at, now) > maxAge) issues.push(issue("stale_portfolio", "portfolio", "drift", `Portfolio ledger is older than ${maxAge} days.`));
  for (const project of projects) {
    if (ageDays(project.updated_at, now) > maxAge) issues.push(issue("stale_project", project.id, "drift", `${project.id} has not been updated within ${maxAge} days.`));
    for (const [name, metric] of Object.entries(project.metrics)) {
      if (["valid", "stale"].includes(metric.status) && ageDays(metric.measured_at, now) > maxAge) issues.push(issue("stale_metric", project.id, "drift", `${project.id} ${name} evidence is stale.`));
    }
  }
}

function selectProjects(ledger, options, issues) {
  if (!options.projectId) return ledger.projects;
  const selected = ledger.projects.filter((project) => project.id === options.projectId);
  if (!selected.length) issues.push(issue("missing_scope", options.projectId, options.stage, `Project ${options.projectId} was not found.`));
  return selected;
}

function selectReleases(project, options, issues, stage) {
  const selected = options.releaseId
    ? project.releases.filter((release) => release.id === options.releaseId)
    : project.releases.filter((release) => ["ready", "released", "production_proven"].includes(release.status));
  if (options.releaseId && !selected.length) issues.push(issue("missing_scope", project.id, stage, `Release ${options.releaseId} was not found.`));
  if (!options.releaseId && !selected.length) issues.push(issue("missing_release", project.id, stage, `No release candidate is ready for the ${stage} gate.`));
  return selected;
}

function validateDataQualityStage(ledger, projects, options, issues) {
  const now = options.now || new Date();
  const computed = computePortfolioMetrics({ ...ledger, projects }, now);
  const byProject = new Map(computed.projects.map((project) => [project.id, project]));
  for (const project of projects) {
    const quality = byProject.get(project.id);
    if (!quality) continue;
    for (const [kind, metric] of [["LEQ", quality.leq], ["JouleWork", quality.joulework]]) {
      if (metric.status === "valid" || metric.status === "not_applicable") continue;
      const requiredNow = ["release", "post-deploy"].includes(options.stage)
        || (["verified", "complete", "production_proven"].includes(project.status) && metric.status !== "valid")
        || (options.stage === "drift" && ["stale", "error"].includes(metric.status));
      const missing = metric.missing_inputs?.length ? ` Missing: ${metric.missing_inputs.join(", ")}.` : "";
      issues.push(issue(
        `metric_${metric.status}`,
        project.id,
        options.stage || "change",
        `${project.id} ${kind} is ${metric.status}.${missing} ${metric.next_action || metric.reason || ""}`.trim(),
        null,
        options.releaseId || null,
        requiredNow
      ));
    }
    const release = quality.release;
    if (release && !["valid", "not_applicable"].includes(release.status)) {
      const requiredNow = options.stage === "post-deploy"
        || (project.status === "production_proven" && release.status !== "valid")
        || (options.stage === "drift" && ["stale", "error"].includes(release.status));
      const missing = release.missing_inputs?.length ? ` Missing: ${release.missing_inputs.join(", ")}.` : "";
      issues.push(issue(
        `release_${release.status}`,
        project.id,
        options.stage || "change",
        `${project.id} release state is ${release.status}.${missing} ${release.next_action || release.reason || ""}`.trim(),
        null,
        options.releaseId || null,
        requiredNow
      ));
    }
  }
}

function reportFor(ledger, options, issues) {
  const projectId = options.projectId || null;
  const workItemId = options.workItemId || null;
  const releaseId = options.releaseId || null;
  const errors = issues.filter((item) => {
    if (item.blocking === false) return false;
    if (item.code === "schema" || item.code === "duplicate_id" || item.code === "bad_link") return true;
    if (projectId && item.project_id !== projectId) return false;
    if (workItemId && item.work_item_id && item.work_item_id !== workItemId) return false;
    if (releaseId && item.release_id && item.release_id !== releaseId) return false;
    return true;
  });
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    stage: options.stage || "change",
    scope: { project_id: projectId, work_item_id: workItemId, release_id: releaseId },
    portfolio_id: ledger?.portfolio?.id || null,
    ok: errors.length === 0,
    errors,
    visible_debt: issues
  };
}

export function computePortfolioMetrics(ledger, now = new Date(ledger.portfolio.updated_at)) {
  const projects = ledger.projects.map((project) => {
    const workItems = project.work_items.map((workItem) => scoreWorkItem(project, workItem, ledger.portfolio.stale_after_days, now));
    const computed = workItems.length
      ? {
          leq: aggregateMetric(workItems.map((item) => item.leq), "leq", now, project.name, project.owner),
          joulework: aggregateMetric(workItems.map((item) => item.joulework), "joulework", now, project.name, project.owner),
          source: "computed from ledger work, tests, evidence, and blockers"
        }
      : {
          leq: normalizeReportedMetric(project.metrics.leq, "leq", project, ledger.portfolio.stale_after_days, now),
          joulework: normalizeReportedMetric(project.metrics.joulework, "joulework", project, ledger.portfolio.stale_after_days, now),
          source: "reported project metric source"
        };
    const release = releaseQuality(project, ledger.portfolio.stale_after_days, now);
    return { id: project.id, name: project.name, ...computed, release, work_items: workItems };
  });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    formula_version: "traceability-v1",
    portfolio: {
      id: ledger.portfolio.id,
      leq: aggregateMetric(projects.map((item) => item.leq), "leq", now, ledger.portfolio.name, "Portfolio owners"),
      joulework: aggregateMetric(projects.map((item) => item.joulework), "joulework", now, ledger.portfolio.name, "Portfolio owners"),
      data_quality: summarizeDataQuality(projects.flatMap((item) => [item.leq, item.joulework, item.release]))
    },
    projects
  };
}

function renderPortfolioPortal(ledger, validation, now, metrics = computePortfolioMetrics(ledger, now)) {
  const metricsByProject = new Map(metrics.projects.map((project) => [project.id, project]));
  const projectCards = ledger.projects.map((project) => {
    const totalRequirements = project.requirements.length;
    const completeRequirements = project.requirements.filter((item) => COMPLETED.has(item.status)).length;
    const tests = project.work_items.flatMap((item) => item.tests);
    const passedTests = tests.filter((item) => ["passed", "not_applicable"].includes(item.status)).length;
    const stale = ageDays(project.updated_at, now) > ledger.portfolio.stale_after_days;
    const computedMetrics = metricsByProject.get(project.id);
    return `<article class="project ${stale ? "stale" : ""}" data-updated-at="${escapeHtml(project.updated_at)}" data-status="${escapeHtml(project.status)}">
      <div class="project-head"><div><p class="eyebrow">${escapeHtml(project.id)}</p><h2>${escapeHtml(project.name)}</h2></div><span class="pill ${statusClass(project.status)}">${escapeHtml(statusLabel(project.status))}</span></div>
      <p class="outcome">${escapeHtml(project.outcome)}</p>${stateContext(project)}
      <div class="progress-grid">
        ${progress("Requirements", completeRequirements, totalRequirements)}
        ${progress("Tests", passedTests, tests.length)}
      </div>
      <dl class="metrics">
        ${metricRow("LEQ", computedMetrics?.leq || project.metrics.leq)}
        ${metricRow("JouleWork", computedMetrics?.joulework || project.metrics.joulework)}
        ${releaseRow(computedMetrics?.release)}
        <div><dt>Updated</dt><dd class="project-updated">${escapeHtml(formatDate(project.updated_at))}${stale ? " · stale" : ""}</dd></div>
      </dl>
      ${blockerBlock(project)}${listBlock("Next actions", project.next_actions, "actions")}${recentEvidence(project)}
      <details><summary>Traceability</summary>${traceTable(project)}</details>
    </article>`;
  }).join("\n");
  const allTests = ledger.projects.flatMap((project) => project.work_items.flatMap((item) => item.tests));
  const allWork = ledger.projects.flatMap((project) => project.work_items);
  const allEvidence = ledger.projects.flatMap((project) => project.evidence);
  const blockingProjects = ledger.projects.filter((project) => ["blocked", "failed"].includes(project.status)).length;
  const queuedProjects = ledger.projects.filter((project) => project.status === "queued").length;
  const waitingProjects = ledger.projects.filter((project) => project.status === "waiting_dependency").length;
  const quality = metrics.portfolio.data_quality;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(ledger.portfolio.name)} · AI.SDLC</title>
  <style>
    :root{color-scheme:light;--ink:#182019;--muted:#667067;--paper:#f5f1e7;--card:#fffdf7;--line:#d8d0be;--green:#1d6b4b;--gold:#9d6d00;--red:#9c372d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#faf7ef 0,#f0eadc 100%);color:var(--ink)}main{max-width:1240px;margin:auto;padding:32px 20px 72px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:20px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:800;color:var(--muted);margin:0 0 7px}h1{font-size:clamp(34px,5vw,58px);line-height:.98;margin:0;letter-spacing:-.035em}h2{margin:0;font-size:24px}p{line-height:1.5}.updated{color:var(--muted);text-align:right}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:20px 0}.card,.project{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 10px 28px rgba(45,37,20,.06)}.card{padding:16px}.card strong{display:block;font-size:30px;margin-top:5px}.validation,.data-quality{padding:14px 18px;border-radius:14px;margin-bottom:12px}.validation{background:${validation.ok ? "#e9f4ed" : "#f8e7e2"};border:1px solid ${validation.ok ? "#bad5c5" : "#e1b4aa"}}.data-quality{background:#f7f0d8;border:1px solid #ddc98b}.validation.stale{background:#f8e7e2;border-color:#e1b4aa}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0}.toolbar label{font-weight:750}.toolbar select{margin-left:8px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--card)}.projects{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.project{padding:22px}.project[hidden]{display:none}.project.stale{border-color:#d8a55d}.project-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.pill{font-size:12px;font-weight:800;padding:6px 9px;border-radius:999px;background:#ece7da}.pill.good{background:#dfeee5;color:var(--green)}.pill.warn{background:#f4e9c8;color:#795200}.pill.bad{background:#f3dcd7;color:var(--red)}.outcome{min-height:48px;color:#39423b}.state-context{padding:10px 12px;background:#f7f0dd;border-left:3px solid var(--gold);margin:10px 0}.progress-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.progress-label{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:5px}.bar{height:8px;background:#e8e2d5;border-radius:99px;overflow:hidden}.bar span{display:block;height:100%;background:var(--green)}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}.metrics>div{padding:10px;background:#f5f1e8;border-radius:10px;min-width:0}.metrics dt{font-size:11px;color:var(--muted);text-transform:uppercase}.metrics dd{margin:4px 0 0;font-weight:750}.metric-detail{border:0;padding:0;margin-top:6px;font-size:11px;color:var(--muted)}.metric-detail summary{font-size:11px;font-weight:700}.metric-detail p{margin:5px 0}.blockers{color:#6e2923}.actions{color:#224e39}.compact{margin:6px 0 14px;padding-left:20px}.compact li{margin:5px 0}.project>details{border-top:1px solid var(--line);padding-top:12px}.project>details>summary{font-weight:750;cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5ded0;vertical-align:top}code{background:#eee8dc;padding:2px 5px;border-radius:5px}.foot{margin-top:20px;color:var(--muted);font-size:13px}@media(max-width:1000px){.summary{grid-template-columns:repeat(3,1fr)}}@media(max-width:840px){.projects{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.hero{display:block}.updated{text-align:left}.metrics{grid-template-columns:repeat(2,1fr)}.toolbar{align-items:start;flex-direction:column}}
  </style>
</head>
<body><main id="human-dashboard" data-portfolio-updated-at="${escapeHtml(ledger.portfolio.updated_at)}" data-stale-after-days="${ledger.portfolio.stale_after_days}">
  <header class="hero"><div><p class="eyebrow">AI.SDLC · ${escapeHtml(ledger.portfolio.mode)} mode</p><h1>${escapeHtml(ledger.portfolio.name)}</h1></div><p class="updated">Updated ${escapeHtml(formatDate(ledger.portfolio.updated_at))}<br>Generated ${escapeHtml(formatDate(now.toISOString()))}</p></header>
  <div class="summary">
    <div class="card"><span class="eyebrow">Projects</span><strong>${ledger.projects.length}</strong></div>
    <div class="card"><span class="eyebrow">Blocked</span><strong>${blockingProjects}</strong></div>
    <div class="card"><span class="eyebrow">Queued</span><strong>${queuedProjects}</strong></div>
    <div class="card"><span class="eyebrow">Waiting</span><strong>${waitingProjects}</strong></div>
    <div class="card"><span class="eyebrow">Portfolio LEQ</span><strong>${metricValue(metrics.portfolio.leq)}</strong></div>
    <div class="card"><span class="eyebrow">Portfolio JouleWork</span><strong>${metricValue(metrics.portfolio.joulework)}</strong></div>
  </div>
  <div class="validation" id="ledger-validation"><strong>${validation.ok ? "Ledger structure is valid" : `Ledger validation found ${validation.errors.length} blocking issue(s)`}</strong><div>${validation.ok ? "Schema, links, declared states, and freshness rules are internally consistent. This does not mean every project is tested, complete, or unblocked." : escapeHtml(validation.errors.slice(0, 4).map((item) => item.message).join(" · "))}</div></div>
  <div class="data-quality" id="data-quality"><strong>Dashboard data quality: ${quality.valid} current · ${quality.awaiting_inputs} awaiting inputs · ${quality.not_applicable} not applicable · ${quality.stale + quality.error} needs attention</strong><div>LEQ, JouleWork, and release fields identify their source, scope, freshness, and next action. Missing inputs are never converted to zero or a perfect score.</div></div>
  <div class="toolbar"><label for="status-filter">Show projects<select id="status-filter"><option value="all">All statuses</option><option value="blocked">Blocked / failed</option><option value="queued">Queued</option><option value="waiting_dependency">Waiting on dependency</option><option value="active">Active</option><option value="verified">Verified / complete</option><option value="unknown">Unknown</option></select></label><span id="visible-count">${ledger.projects.length} shown</span></div>
  <section class="projects">${projectCards}</section>
  <p class="foot">${allTests.filter((item) => item.status === "passed").length} passed tests of ${allTests.length} declared across ${allWork.length} work items and ${allEvidence.length} evidence records. Metrics use traceability-v1 when work is recorded; otherwise every unavailable value is labeled not applicable, awaiting named inputs, stale, or error with its reason and next action.</p>
  <script>(()=>{const root=document.getElementById('human-dashboard');const max=Number(root.dataset.staleAfterDays)*86400000;const now=Date.now();let stale=now-Date.parse(root.dataset.portfolioUpdatedAt)>max;const cards=[...document.querySelectorAll('.project')];cards.forEach(card=>{const isStale=now-Date.parse(card.dataset.updatedAt)>max;card.classList.toggle('stale',isStale);const label=card.querySelector('.project-updated');if(label){label.textContent=label.textContent.replace(/ · stale$/,'')+(isStale?' · stale':'')}stale||=isStale});if(stale){const box=document.getElementById('data-quality');box.classList.add('stale');box.querySelector('strong').textContent='Dashboard data freshness needs attention';box.querySelector('div').textContent='The current clock is beyond the registered freshness window. This does not change ledger structure validity or prove that every project is blocked.'}const filter=document.getElementById('status-filter');const count=document.getElementById('visible-count');const matches=(status,value)=>value==='all'||(value==='blocked'&&['blocked','failed'].includes(status))||(value==='verified'&&['verified','complete','production_proven'].includes(status))||status===value;filter.addEventListener('change',()=>{let shown=0;cards.forEach(card=>{card.hidden=!matches(card.dataset.status,filter.value);if(!card.hidden)shown+=1});count.textContent=shown+' shown'});})();</script>
</main></body></html>`;
}

function traceTable(project) {
  const metrics = computePortfolioMetrics({ portfolio: { id: "trace", name: "Trace", updated_at: project.updated_at, stale_after_days: 30 }, projects: [project] }, new Date(project.updated_at)).projects[0];
  const byWork = new Map(metrics.work_items.map((item) => [item.id, item]));
  const rows = project.work_items.map((work) => {
    const requirements = work.implements.join(", ");
    const tests = work.tests.map((test) => `${test.id} (${test.type}: ${test.status})`).join("<br>") || "none";
    const evidence = work.tests.flatMap((test) => test.evidence_ids).join(", ") || "none";
    const taskMetrics = byWork.get(work.id);
    return `<tr><td><code>${escapeHtml(work.id)}</code><br>${escapeHtml(work.title)}</td><td>${escapeHtml(requirements)}</td><td>${tests}</td><td>${escapeHtml(evidence)}</td><td>${escapeHtml(work.status)}</td><td>${metricValue(taskMetrics?.leq)}</td><td>${metricValue(taskMetrics?.joulework)}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Work</th><th>Requirements</th><th>Verification</th><th>Evidence</th><th>Status</th><th>LEQ</th><th>JW</th></tr></thead><tbody>${rows || "<tr><td colspan=7>No work items registered</td></tr>"}</tbody></table>`;
}

function progress(label, value, total) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return `<div><div class="progress-label"><span>${escapeHtml(label)}</span><span>${value}/${total}</span></div><div class="bar"><span style="width:${percent}%"></span></div></div>`;
}

function metricRow(label, metric) {
  const value = metric?.status === "valid" || metric?.status === "stale"
    ? `${metric.score} · ${metric.classification}${metric.status === "stale" ? " · stale" : ""}`
    : metricStateLabel(metric?.status);
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${metricDetails(metric)}</div>`;
}

function metricValue(metric) {
  if (metric?.status === "valid") return escapeHtml(String(metric.score));
  if (metric?.status === "stale") return `${escapeHtml(String(metric.score))} · stale`;
  return escapeHtml(metricStateLabel(metric?.status));
}

function releaseRow(release) {
  const value = release?.status === "valid" || release?.status === "stale"
    ? `${release.value}${release.status === "stale" ? " · stale" : ""}`
    : metricStateLabel(release?.status);
  return `<div><dt>Release</dt><dd>${escapeHtml(value)}</dd>${metricDetails(release)}</div>`;
}

function metricDetails(metric) {
  if (!metric) return "";
  const details = [];
  if (metric.definition) details.push(`<p><strong>Definition:</strong> ${escapeHtml(metric.definition)}</p>`);
  if (metric.scope) details.push(`<p><strong>Scope:</strong> ${escapeHtml(metric.scope)}</p>`);
  if (metric.source) details.push(`<p><strong>Source:</strong> ${escapeHtml(metric.source)}</p>`);
  if (metric.measured_at) details.push(`<p><strong>Updated:</strong> ${escapeHtml(formatDate(metric.measured_at))}</p>`);
  if (metric.reason) details.push(`<p><strong>Why:</strong> ${escapeHtml(metric.reason)}</p>`);
  if (metric.missing_inputs?.length) details.push(`<p><strong>Missing:</strong> ${escapeHtml(metric.missing_inputs.join(", "))}</p>`);
  if (metric.next_action) details.push(`<p><strong>Next:</strong> ${escapeHtml(metric.next_action)}</p>`);
  if (metric.owner) details.push(`<p><strong>Owner:</strong> ${escapeHtml(metric.owner)}</p>`);
  return details.length ? `<details class="metric-detail"><summary>Evidence and state</summary>${details.join("")}</details>` : "";
}

function scoreWorkItem(project, workItem, staleDays, now) {
  const scope = `${project.name} / ${workItem.id}`;
  const owner = workItem.owner || project.owner;
  if (NON_EXECUTING.has(workItem.status)) {
    const reason = workItem.state_reason || `${workItem.title} has not entered execution.`;
    return {
      id: workItem.id,
      status: workItem.status,
      leq: notApplicableMetric("leq", scope, reason),
      joulework: notApplicableMetric("joulework", scope, reason)
    };
  }
  if (["waiting_dependency", "unknown"].includes(workItem.status)) {
    const missing = workItem.waiting_on?.length ? workItem.waiting_on : ["confirmed execution state and verification inputs"];
    const next = workItem.next_actions?.[0] || "Resolve the named dependency and register current verification evidence.";
    return {
      id: workItem.id,
      status: workItem.status,
      leq: awaitingMetric("leq", scope, owner, missing, next),
      joulework: awaitingMetric("joulework", scope, owner, missing, next)
    };
  }
  const evidence = new Map(project.evidence.map((item) => [item.id, item]));
  const requiredTypes = new Set(workItem.required_test_types);
  const testsByType = new Map([...requiredTypes].map((type) => [type, workItem.tests.filter((test) => test.type === type)]));
  const ratio = (matched) => requiredTypes.size ? matched / requiredTypes.size : 0;
  const declaredRatio = ratio([...testsByType.values()].filter((tests) => tests.length).length);
  const passedRatio = ratio([...testsByType.values()].filter((tests) => tests.some((test) => ["passed", "not_applicable"].includes(test.status))).length);
  const passedTests = workItem.tests.filter((test) => test.status === "passed");
  const failedTests = workItem.tests.filter((test) => test.status === "failed");
  if (!passedTests.length && !failedTests.length) {
    const missing = workItem.required_test_types.map((type) => `${type} verification evidence`);
    const next = workItem.next_actions?.[0] || "Run the declared verification and attach passed or failed evidence.";
    return {
      id: workItem.id,
      status: workItem.status,
      leq: awaitingMetric("leq", scope, owner, missing, next),
      joulework: awaitingMetric("joulework", scope, owner, missing, next)
    };
  }
  const evidenceRatio = passedTests.length
    ? passedTests.filter((test) => test.evidence_ids.length && test.evidence_ids.every((id) => evidence.get(id)?.status === "passed")).length / passedTests.length
    : 0;
  const linked = workItem.implements.length ? 1 : 0;
  const blockerFree = workItem.blockers?.length ? 0 : 1;
  const failurePenalty = Math.min(20, workItem.tests.filter((test) => test.status === "failed").length * 10 + (workItem.blockers?.length || 0) * 5);
  const completed = ["verified", "complete", "production_proven"].includes(workItem.status) ? 1 : 0;
  const leqScore = boundedScore(20 * linked + 15 * declaredRatio + 35 * passedRatio + 20 * evidenceRatio + 10 * blockerFree - failurePenalty);
  const jouleworkScore = boundedScore(20 * linked + 30 * passedRatio + 25 * evidenceRatio + 25 * completed - failurePenalty);
  const leq = validMetric(leqScore, "leq", project.updated_at, "computed from registered requirement links, declared tests, passed evidence, failures, and blockers", scope);
  const joulework = validMetric(jouleworkScore, "joulework", project.updated_at, "computed from registered completed outcomes, passed evidence, failures, and blockers", scope);
  const stale = ageDays(project.updated_at, now) > staleDays;
  return {
    id: workItem.id,
    status: workItem.status,
    leq: stale ? staleMetric(leq, owner, `Work-item inputs are older than ${staleDays} days.`, "Refresh tests and evidence, then recompute the ledger.") : leq,
    joulework: stale ? staleMetric(joulework, owner, `Work-item inputs are older than ${staleDays} days.`, "Refresh tests and evidence, then recompute the ledger.") : joulework
  };
}

function aggregateMetric(metrics, kind, now, scope, owner) {
  const applicable = metrics.filter((metric) => metric?.status !== "not_applicable");
  if (!applicable.length) return notApplicableMetric(kind, scope, "No child work is currently applicable to this metric.");
  const errors = applicable.filter((metric) => metric.status === "error");
  if (errors.length) {
    return errorMetric(kind, scope, owner, errors.map((metric) => metric.reason).filter(Boolean).join("; ") || "A child metric is in error.", "Repair the child metric inputs and recompute the ledger.");
  }
  const awaiting = applicable.filter((metric) => metric.status === "awaiting_inputs");
  if (awaiting.length) {
    const missing = [...new Set(awaiting.flatMap((metric) => metric.missing_inputs || []))];
    return awaitingMetric(kind, scope, owner, missing.length ? missing : ["child metric inputs"], awaiting[0].next_action || "Supply the named child inputs and recompute the ledger.");
  }
  const scored = applicable.filter((metric) => ["valid", "stale"].includes(metric.status) && Number.isFinite(metric.score));
  if (scored.length !== applicable.length) {
    return errorMetric(kind, scope, owner, "One or more child metrics have an invalid state or no score.", "Correct the child data-quality state and recompute the ledger.");
  }
  const score = boundedScore(scored.reduce((sum, metric) => sum + metric.score, 0) / scored.length);
  const source = `average of ${scored.length} applicable child ${scored.length === 1 ? "record" : "records"}`;
  const valid = validMetric(score, kind, now.toISOString(), source, scope);
  if (scored.some((metric) => metric.status === "stale")) {
    return staleMetric(valid, owner, "One or more dependent child metrics are stale.", "Refresh stale child inputs and recompute the aggregate.");
  }
  return valid;
}

function normalizeReportedMetric(metric, kind, project, staleDays, now) {
  if (!metric || !["valid", "not_applicable", "awaiting_inputs", "stale", "error"].includes(metric.status)) {
    return errorMetric(kind, project.name, project.owner, "The recorded metric state is invalid.", "Record an explicit valid, not applicable, awaiting inputs, stale, or error state.");
  }
  if (metric.status === "valid" && ageDays(metric.measured_at, now) > staleDays) {
    return staleMetric(metric, project.owner, `Recorded evidence is older than ${staleDays} days.`, "Refresh the named source and update measured_at.");
  }
  return { ...metric };
}

function validMetric(score, kind, measuredAt, source, scope) {
  const healthy = kind === "leq" ? 85 : 70;
  const watch = kind === "leq" ? 60 : 40;
  const classification = score >= healthy
    ? (kind === "leq" ? "healthy" : "productive")
    : score >= watch ? "watch" : (kind === "leq" ? "critical" : "stalled");
  return { status: "valid", score, classification, measured_at: measuredAt, source, definition: METRIC_DEFINITIONS[kind], scope };
}

function notApplicableMetric(kind, scope, reason) {
  return { status: "not_applicable", definition: METRIC_DEFINITIONS[kind], scope, reason };
}

function awaitingMetric(kind, scope, owner, missingInputs, nextAction) {
  return { status: "awaiting_inputs", definition: METRIC_DEFINITIONS[kind], scope, missing_inputs: [...new Set(missingInputs)], next_action: nextAction, owner };
}

function staleMetric(metric, owner, reason, nextAction) {
  return { ...metric, status: "stale", reason, next_action: nextAction, owner };
}

function errorMetric(kind, scope, owner, reason, nextAction) {
  return { status: "error", definition: METRIC_DEFINITIONS[kind], scope, reason, next_action: nextAction, owner };
}

function releaseQuality(project, staleDays, now) {
  const definition = "Latest registered release identity and its publication, deployment, and production-verification state.";
  const scope = project.name;
  const releases = project.releases || [];
  if (!releases.length) {
    if (NON_EXECUTING.has(project.status)) {
      return { status: "not_applicable", definition, scope, reason: `No release is applicable while the project is ${statusLabel(project.status).toLowerCase()}.` };
    }
    return { status: "awaiting_inputs", definition, scope, missing_inputs: ["registered release record"], next_action: "Register the release candidate, artifact identity, and verification plan.", owner: project.owner };
  }
  const release = releases.at(-1);
  const source = `ledger release ${release.id}${release.tag ? ` (${release.tag})` : ""}`;
  const measuredAt = release.deployment?.deployed_at || project.updated_at;
  if (release.status === "blocked") {
    return { status: "error", definition, scope, source, reason: "The latest registered release is blocked.", next_action: "Resolve the release gate failures and record new evidence.", owner: project.owner };
  }
  if (["draft", "ready"].includes(release.status)) {
    const missing = release.status === "draft" ? ["release readiness evidence"] : ["published release event"];
    return { status: "awaiting_inputs", definition, scope, source, missing_inputs: missing, next_action: release.status === "draft" ? "Complete release verification and mark the release ready." : "Publish the release and record the hosted release event.", owner: project.owner };
  }
  const productionProven = release.status === "production_proven" && release.deployment?.status === "deployed" && release.production_test_ids?.length;
  const value = productionProven ? `${release.tag || release.id} · production proven` : `${release.tag || release.id} · released`;
  const valid = { status: "valid", value, definition, scope, measured_at: measuredAt, source, owner: project.owner };
  if (ageDays(measuredAt, now) > staleDays) {
    return { ...valid, status: "stale", reason: `Release evidence is older than ${staleDays} days.`, next_action: "Confirm the current live release and refresh production evidence.", owner: project.owner };
  }
  return valid;
}

function summarizeDataQuality(metrics) {
  return metrics.reduce((summary, metric) => {
    const state = metric?.status || "error";
    summary[state] = (summary[state] || 0) + 1;
    return summary;
  }, { valid: 0, not_applicable: 0, awaiting_inputs: 0, stale: 0, error: 0 });
}

function metricStateLabel(status) {
  return ({ valid: "current", not_applicable: "not applicable", awaiting_inputs: "awaiting inputs", stale: "stale", error: "error" })[status] || "invalid state";
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mergeReports(...reports) {
  const errors = reports.flatMap((report) => report.errors);
  const visibleDebt = reports.flatMap((report) => report.visible_debt);
  return { ...reports[0], ok: errors.length === 0, errors, visible_debt: visibleDebt, stage: reports.map((report) => report.stage).join("+") };
}

function resolveLifecycleTarget(ledger, { event, reference, projectId, releaseId }) {
  const candidates = [];
  for (const project of ledger.projects) {
    if (projectId && project.id !== projectId) continue;
    for (const release of project.releases) {
      if (releaseId && release.id !== releaseId) continue;
      const matches = event === "release" ? release.tag === reference : release.deployment.ref === reference;
      if ((projectId && releaseId) || matches) candidates.push({ project, release });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one lifecycle target for ${event} ${reference}; found ${candidates.length}. Add a unique release.tag or deployment.ref, or pass --project and --release.`);
  }
  return candidates[0];
}

function uniqueEvidenceId(project, seed) {
  const base = seed.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 72);
  const used = new Set(project.evidence.map((item) => item.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function listBlock(title, items, className) {
  if (!items?.length) return "";
  return `<div class="${className}"><strong>${escapeHtml(title)}</strong><ul class="compact">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function recentEvidence(project) {
  const items = [...(project.evidence || [])]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 4);
  if (!items.length) return "";
  const rows = items.map((item) => {
    const label = `${formatDate(item.created_at)} · ${item.status}`;
    const summary = item.uri
      ? `<a href="${escapeHtml(item.uri)}">${escapeHtml(item.summary)}</a>`
      : escapeHtml(item.summary);
    return `<li><strong>${escapeHtml(label)}</strong><br>${summary}</li>`;
  });
  return `<details class="recent-evidence"><summary>Recent evidence</summary><ul class="compact">${rows.join("")}</ul></details>`;
}

function stateContext(subject) {
  const lines = [];
  if (subject.state_reason) lines.push(`<strong>${escapeHtml(statusLabel(subject.status))}:</strong> ${escapeHtml(subject.state_reason)}`);
  if (subject.waiting_on?.length) lines.push(`<strong>Waiting on:</strong> ${escapeHtml(subject.waiting_on.join(", "))}`);
  return lines.length ? `<div class="state-context">${lines.join("<br>")}</div>` : "";
}

function blockerBlock(subject) {
  if (!subject.blockers?.length) return "";
  const actions = new Map((subject.blocker_actions || []).map((item) => [item.blocker, item]));
  const rows = subject.blockers.map((blocker) => {
    const action = actions.get(blocker);
    const resolution = action ? `<br><strong>Clear by:</strong> ${escapeHtml(action.clear_action)} <strong>Owner:</strong> ${escapeHtml(action.owner)}` : "";
    return `<li>${escapeHtml(blocker)}${resolution}</li>`;
  });
  return `<div class="blockers"><strong>Actionable blockers</strong><ul class="compact">${rows.join("")}</ul></div>`;
}

function statusLabel(status) {
  return ({
    planned: "Planned",
    queued: "Queued by priority",
    waiting_dependency: "Waiting on dependency",
    active: "In progress",
    blocked: "Blocked",
    failed: "Failed",
    passed: "Passed",
    verified: "Verified",
    complete: "Complete",
    ready: "Ready",
    released: "Released",
    production_proven: "Production proven",
    deferred: "Deferred",
    unknown: "Unverified state"
  })[status] || status;
}

function statusClass(status) {
  if (["passed", "verified", "complete", "released", "production_proven"].includes(status)) return "good";
  if (["blocked", "failed"].includes(status)) return "bad";
  return "warn";
}

function issue(code, projectId, stage, message, workItemId = null, releaseId = null, blocking = true) {
  return { code, project_id: projectId, stage, work_item_id: workItemId, release_id: releaseId, message, blocking };
}

function localArtifactPath(root, uri) {
  if (!uri || /^https?:\/\//i.test(uri)) return null;
  const cleaned = uri.startsWith("file:") ? uri.slice(5) : uri;
  return isAbsolute(cleaned) ? cleaned : resolve(root, cleaned);
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function ageDays(value, now) {
  if (!value || !Number.isFinite(Date.parse(value))) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - Date.parse(value)) / 86400000);
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
    : "unknown";
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function text(value) {
  return value === undefined || value === null || value === true ? "" : String(value);
}

function printValidation(report) {
  console.log(`AI.SDLC ${report.stage} gate: ${report.ok ? "passed" : "blocked"}`);
  console.log(`Scope: ${report.scope.project_id || "portfolio"}${report.scope.work_item_id ? ` / ${report.scope.work_item_id}` : ""}${report.scope.release_id ? ` / ${report.scope.release_id}` : ""}`);
  for (const item of report.errors) console.log(`- [${item.code}] ${item.message}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
