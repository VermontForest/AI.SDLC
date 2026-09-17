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
  return reportFor(ledger, options, issues);
}

function validateProjectLinks(project, issues) {
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
      if (metric.status === "measured" && ageDays(metric.measured_at, now) > maxAge) issues.push(issue("stale_metric", project.id, "drift", `${project.id} ${name} evidence is stale.`));
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

function reportFor(ledger, options, issues) {
  const projectId = options.projectId || null;
  const workItemId = options.workItemId || null;
  const releaseId = options.releaseId || null;
  const errors = issues.filter((item) => {
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
    const workItems = project.work_items.map((workItem) => scoreWorkItem(project, workItem));
    const computed = workItems.length
      ? {
          leq: aggregateMetric(workItems.map((item) => item.leq), "leq", now),
          joulework: aggregateMetric(workItems.map((item) => item.joulework), "joulework", now),
          source: "computed from ledger work, tests, evidence, and blockers"
        }
      : {
          leq: normalizeReportedMetric(project.metrics.leq),
          joulework: normalizeReportedMetric(project.metrics.joulework),
          source: project.metrics.leq.status === "measured" || project.metrics.joulework.status === "measured"
            ? "reported project metric source"
            : "unavailable: no recorded work items or measured project source"
        };
    return { id: project.id, name: project.name, ...computed, work_items: workItems };
  });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    formula_version: "traceability-v1",
    portfolio: {
      id: ledger.portfolio.id,
      leq: aggregateMetric(projects.map((item) => item.leq).filter(isMeasuredMetric), "leq", now),
      joulework: aggregateMetric(projects.map((item) => item.joulework).filter(isMeasuredMetric), "joulework", now)
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
    const release = project.releases.find((item) => item.status === "production_proven") || project.releases.at(-1);
    const computedMetrics = metricsByProject.get(project.id);
    return `<article class="project ${stale ? "stale" : ""}" data-updated-at="${escapeHtml(project.updated_at)}">
      <div class="project-head"><div><p class="eyebrow">${escapeHtml(project.id)}</p><h2>${escapeHtml(project.name)}</h2></div><span class="pill ${statusClass(project.status)}">${escapeHtml(project.status)}</span></div>
      <p class="outcome">${escapeHtml(project.outcome)}</p>
      <div class="progress-grid">
        ${progress("Requirements", completeRequirements, totalRequirements)}
        ${progress("Tests", passedTests, tests.length)}
      </div>
      <dl class="metrics">
        ${metricRow("LEQ", computedMetrics?.leq || project.metrics.leq)}
        ${metricRow("JouleWork", computedMetrics?.joulework || project.metrics.joulework)}
        <div><dt>Release</dt><dd>${escapeHtml(release?.status || "none")}</dd></div>
        <div><dt>Updated</dt><dd class="project-updated">${escapeHtml(formatDate(project.updated_at))}${stale ? " · stale" : ""}</dd></div>
      </dl>
      ${listBlock("Blockers", project.blockers, "blockers")}
      ${listBlock("Next actions", project.next_actions, "actions")}
      <details><summary>Traceability</summary>${traceTable(project)}</details>
    </article>`;
  }).join("\n");
  const allTests = ledger.projects.flatMap((project) => project.work_items.flatMap((item) => item.tests));
  const allWork = ledger.projects.flatMap((project) => project.work_items);
  const allEvidence = ledger.projects.flatMap((project) => project.evidence);
  const blockingProjects = ledger.projects.filter((project) => project.blockers.length || ["blocked", "failed"].includes(project.status)).length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(ledger.portfolio.name)} · AI.SDLC</title>
  <style>
    :root{color-scheme:light;--ink:#182019;--muted:#667067;--paper:#f5f1e7;--card:#fffdf7;--line:#d8d0be;--green:#1d6b4b;--gold:#9d6d00;--red:#9c372d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#faf7ef 0,#f0eadc 100%);color:var(--ink)}main{max-width:1240px;margin:auto;padding:32px 20px 72px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:20px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:800;color:var(--muted);margin:0 0 7px}h1{font-size:clamp(34px,5vw,58px);line-height:.98;margin:0;letter-spacing:-.035em}h2{margin:0;font-size:24px}p{line-height:1.5}.updated{color:var(--muted);text-align:right}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card,.project{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 10px 28px rgba(45,37,20,.06)}.card{padding:18px}.card strong{display:block;font-size:34px;margin-top:5px}.validation{padding:14px 18px;border-radius:14px;background:${validation.ok ? "#e9f4ed" : "#f8e7e2"};border:1px solid ${validation.ok ? "#bad5c5" : "#e1b4aa"};margin-bottom:18px}.validation.stale{background:#f8e7e2;border-color:#e1b4aa}.projects{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.project{padding:22px}.project.stale{border-color:#d8a55d}.project-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.pill{font-size:12px;font-weight:800;padding:6px 9px;border-radius:999px;background:#ece7da}.pill.good{background:#dfeee5;color:var(--green)}.pill.warn{background:#f4e9c8;color:#795200}.pill.bad{background:#f3dcd7;color:var(--red)}.outcome{min-height:48px;color:#39423b}.progress-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.progress-label{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:5px}.bar{height:8px;background:#e8e2d5;border-radius:99px;overflow:hidden}.bar span{display:block;height:100%;background:var(--green)}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}.metrics div{padding:10px;background:#f5f1e8;border-radius:10px}.metrics dt{font-size:11px;color:var(--muted);text-transform:uppercase}.metrics dd{margin:4px 0 0;font-weight:750}.blockers{color:#6e2923}.actions{color:#224e39}.compact{margin:6px 0 14px;padding-left:20px}.compact li{margin:5px 0}details{border-top:1px solid var(--line);padding-top:12px}summary{font-weight:750;cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5ded0;vertical-align:top}code{background:#eee8dc;padding:2px 5px;border-radius:5px}.foot{margin-top:20px;color:var(--muted);font-size:13px}@media(max-width:840px){.projects{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.hero{display:block}.updated{text-align:left}.metrics{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body><main id="human-dashboard" data-portfolio-updated-at="${escapeHtml(ledger.portfolio.updated_at)}" data-stale-after-days="${ledger.portfolio.stale_after_days}">
  <header class="hero"><div><p class="eyebrow">AI.SDLC · ${escapeHtml(ledger.portfolio.mode)} mode</p><h1>${escapeHtml(ledger.portfolio.name)}</h1></div><p class="updated">Updated ${escapeHtml(formatDate(ledger.portfolio.updated_at))}<br>Generated ${escapeHtml(formatDate(now.toISOString()))}</p></header>
  <div class="summary">
    <div class="card"><span class="eyebrow">Projects</span><strong>${ledger.projects.length}</strong></div>
    <div class="card"><span class="eyebrow">Portfolio LEQ</span><strong>${metricValue(metrics.portfolio.leq)}</strong></div>
    <div class="card"><span class="eyebrow">Portfolio JouleWork</span><strong>${metricValue(metrics.portfolio.joulework)}</strong></div>
    <div class="card"><span class="eyebrow">Blocked projects</span><strong>${blockingProjects}</strong></div>
  </div>
  <div class="validation" id="ledger-validation"><strong>${validation.ok ? "Ledger passes current checks" : `Ledger has ${validation.errors.length} blocking issue(s)`}</strong><div>${validation.ok ? "Plan, requirements, work, tests, evidence links, and current drift state are consistent." : escapeHtml(validation.errors.slice(0, 4).map((item) => item.message).join(" · "))}</div></div>
  <section class="projects">${projectCards}</section>
  <p class="foot">${allTests.filter((item) => item.status === "passed").length} passed tests of ${allTests.length} declared across ${allWork.length} work items and ${allEvidence.length} evidence records. Metrics use traceability-v1 when work is recorded; otherwise an explicit measured source is required and unavailable input stays unknown.</p>
  <script>(()=>{const root=document.getElementById('human-dashboard');const max=Number(root.dataset.staleAfterDays)*86400000;const now=Date.now();let stale=now-Date.parse(root.dataset.portfolioUpdatedAt)>max;document.querySelectorAll('.project').forEach(card=>{const isStale=now-Date.parse(card.dataset.updatedAt)>max;card.classList.toggle('stale',isStale);const label=card.querySelector('.project-updated');if(label){label.textContent=label.textContent.replace(/ · stale$/,'')+(isStale?' · stale':'')}stale||=isStale});if(stale){const box=document.getElementById('ledger-validation');box.classList.add('stale');box.querySelector('strong').textContent='Ledger drift is stale';box.querySelector('div').textContent='The current clock is beyond the registered freshness window. Run the drift gate and refresh the ledger.'}})();</script>
</main></body></html>`;
}

function traceTable(project) {
  const metrics = computePortfolioMetrics({ portfolio: { id: "trace", updated_at: project.updated_at }, projects: [project] }, new Date(project.updated_at)).projects[0];
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
  const value = metric.status === "measured" ? `${metric.score} · ${metric.classification || "measured"}` : "unknown";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function metricValue(metric) {
  return metric?.status === "measured" ? escapeHtml(String(metric.score)) : "unknown";
}

function scoreWorkItem(project, workItem) {
  const evidence = new Map(project.evidence.map((item) => [item.id, item]));
  const requiredTypes = new Set(workItem.required_test_types);
  const testsByType = new Map([...requiredTypes].map((type) => [type, workItem.tests.filter((test) => test.type === type)]));
  const ratio = (matched) => requiredTypes.size ? matched / requiredTypes.size : 0;
  const declaredRatio = ratio([...testsByType.values()].filter((tests) => tests.length).length);
  const passedRatio = ratio([...testsByType.values()].filter((tests) => tests.some((test) => ["passed", "not_applicable"].includes(test.status))).length);
  const passedTests = workItem.tests.filter((test) => test.status === "passed");
  const evidenceRatio = passedTests.length
    ? passedTests.filter((test) => test.evidence_ids.length && test.evidence_ids.every((id) => evidence.get(id)?.status === "passed")).length / passedTests.length
    : 0;
  const linked = workItem.implements.length ? 1 : 0;
  const blockerFree = workItem.blockers?.length ? 0 : 1;
  const failurePenalty = Math.min(20, workItem.tests.filter((test) => test.status === "failed").length * 10 + (workItem.blockers?.length || 0) * 5);
  const completed = ["verified", "complete", "production_proven"].includes(workItem.status) ? 1 : 0;
  const leqScore = boundedScore(20 * linked + 15 * declaredRatio + 35 * passedRatio + 20 * evidenceRatio + 10 * blockerFree - failurePenalty);
  const jouleworkScore = boundedScore(20 * linked + 30 * passedRatio + 25 * evidenceRatio + 25 * completed - failurePenalty);
  return {
    id: workItem.id,
    status: workItem.status,
    leq: measuredMetric(leqScore, "leq", project.updated_at, "computed from required verification and evidence links"),
    joulework: measuredMetric(jouleworkScore, "joulework", project.updated_at, "computed from completed evidence-backed useful work minus failure and blocker penalties")
  };
}

function aggregateMetric(metrics, kind, now) {
  const measured = metrics.filter(isMeasuredMetric);
  if (!measured.length) return { status: "unknown" };
  const score = boundedScore(measured.reduce((sum, metric) => sum + metric.score, 0) / measured.length);
  return measuredMetric(score, kind, now.toISOString(), `average of ${measured.length} measured child ${measured.length === 1 ? "record" : "records"}`);
}

function normalizeReportedMetric(metric) {
  if (!isMeasuredMetric(metric)) return { status: "unknown" };
  return { ...metric };
}

function isMeasuredMetric(metric) {
  return metric?.status === "measured" && Number.isFinite(metric.score);
}

function measuredMetric(score, kind, measuredAt, source) {
  const healthy = kind === "leq" ? 85 : 70;
  const watch = kind === "leq" ? 60 : 40;
  const classification = score >= healthy
    ? (kind === "leq" ? "healthy" : "productive")
    : score >= watch ? "watch" : (kind === "leq" ? "critical" : "stalled");
  return { status: "measured", score, classification, measured_at: measuredAt, source };
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

function statusClass(status) {
  if (["passed", "verified", "complete", "released", "production_proven"].includes(status)) return "good";
  if (["blocked", "failed"].includes(status)) return "bad";
  return "warn";
}

function issue(code, projectId, stage, message, workItemId = null, releaseId = null) {
  return { code, project_id: projectId, stage, work_item_id: workItemId, release_id: releaseId, message };
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
