import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_PATH = "harness.config.json";
const DEFAULT_ARTIFACTS = {
  changeImpact: "ops/change-impact.latest.json",
  protectedRegression: "ops/protected-regression.latest.json",
  iterationFinish: "ops/iteration-finish.latest.json",
  statusJson: "ops/status.json",
  statusMarkdown: "docs/status.md",
  dashboardHtml: "ops/dashboard.html"
};

export async function initHarness(argv = [], options = {}) {
  const args = parseArgs(argv);
  const root = options.root || process.cwd();
  const projectName = stringArg(args.projectName) || basename(root);
  const configPath = join(root, DEFAULT_CONFIG_PATH);
  await mkdir(join(root, "ops"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  if (!existsSync(configPath) || args.force) {
    const template = JSON.parse(await readFile(join(packageRoot, "templates", "harness.config.example.json"), "utf8"));
    template.project.name = projectName;
    template.project.id = slug(projectName);
    await writeJson(configPath, template);
  }
  await copyTemplateIfMissing("AGENTS.sldc.snippet.md", join(root, "AGENTS.md"), args.force);
  await copyTemplateIfMissing(join("docs", "management-sop.md"), join(root, "docs", "management-sop.md"), args.force);
  await copyTemplateIfMissing(join("docs", "test-release-plan.md"), join(root, "docs", "test-release-plan.md"), args.force);
  return {
    message: `Initialized AI.SLDC harness in ${root}\nNext: add package scripts or run npx ai-sldc assess --files <paths>.`
  };
}

export async function assessChangeImpact(argv = [], options = {}) {
  const root = options.root || process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(root, args.config);
  const files = normalizeFiles(args.files || args.intentionalFiles || []);
  if (files.length === 0) throw new Error("assess requires --files <repo paths>.");

  const matchedSurfaces = matchSurfaces(files, config);
  const packs = unique(matchedSurfaces.flatMap((surface) => surface.packs || []));
  const riskClasses = unique(matchedSurfaces.flatMap((surface) => surface.riskClasses || [surface.id]));
  const requiredSkills = unique(matchedSurfaces.flatMap((surface) => surface.skills || []));
  const skillPreflight = await resolveSkillPreflight(requiredSkills);
  const workContract = buildWorkContract(args);
  const pendingExternalProof = unique(
    packs.flatMap((packId) => {
      const pack = config.packs?.[packId] || {};
      return pack.externalProof ? [pack.externalProof] : [];
    })
  );

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: packs.length > 0 ? "packs_required" : "no_packs_required",
    project: compactProject(config.project),
    changed_files: files,
    matched_surfaces: matchedSurfaces.map((surface) => surface.id),
    risk_classes: riskClasses,
    required_packs: packs,
    required_skills: requiredSkills,
    skill_preflight: skillPreflight,
    pending_external_proof: pendingExternalProof,
    work_contract: workContract,
    next_command: "npm run regress:protected"
  };
  await writeArtifact(root, artifactPath(config, "changeImpact"), report);
  printAssessment(report);
  return { value: report, printJson: Boolean(args.json) };
}

export async function runProtectedRegression(argv = [], options = {}) {
  const root = options.root || process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(root, args.config);
  const latestImpact = await readJsonIfExists(join(root, artifactPath(config, "changeImpact")));
  const explicitFiles = normalizeFiles(args.files || []);
  const files = explicitFiles.length ? explicitFiles : latestImpact?.changed_files || [];
  if (files.length === 0 && !args.pack) throw new Error("regress requires --files or a latest change-impact artifact.");

  const packs = unique(
    normalizeList(args.pack).length
      ? normalizeList(args.pack)
      : latestImpact?.required_packs || matchSurfaces(files, config).flatMap((surface) => surface.packs || [])
  );
  const checks = [];
  const failures = [];
  const pendingExternalProof = [];

  for (const packId of packs) {
    const pack = config.packs?.[packId];
    if (!pack) {
      failures.push(`Unknown protected pack: ${packId}`);
      continue;
    }
    if (pack.externalProof) pendingExternalProof.push(pack.externalProof);
    const commands = arrayValue(pack.commands);
    if (commands.length === 0) {
      checks.push({ pack: packId, name: pack.label || packId, status: "no_command_configured" });
      continue;
    }
    for (const command of commands) {
      if (args.dryRun || args.skipCommands) {
        checks.push({ pack: packId, command, status: "skipped" });
        continue;
      }
      const started = Date.now();
      const result = await runShell(command, { cwd: root });
      checks.push({
        pack: packId,
        command,
        status: result.exitCode === 0 ? "passed" : "failed",
        exit_code: result.exitCode,
        elapsed_seconds: secondsSince(started)
      });
      if (result.exitCode !== 0) failures.push(`${packId}: ${command} exited ${result.exitCode}`);
    }
  }

  const pending = unique(pendingExternalProof);
  const status = failures.length
    ? "failed"
    : pending.length
      ? "passed_with_pending_external_proof"
      : "passed";
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status,
    project: compactProject(config.project),
    changed_files: files,
    required_packs: packs,
    checks,
    pending_external_proof: pending,
    failures,
    change_impact_artifact: artifactPath(config, "changeImpact")
  };
  await writeArtifact(root, artifactPath(config, "protectedRegression"), report);
  printRegression(report);
  return { value: report, printJson: Boolean(args.json), exitCode: failures.length ? 1 : 0 };
}

export async function finishIteration(argv = [], options = {}) {
  const root = options.root || process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(root, args.config);
  const files = normalizeFiles(args.intentionalFiles || args.files || []);
  if (files.length === 0) throw new Error("finish requires --intentional-files <repo paths>.");

  const commands = [];
  const failures = [];
  const blockers = [];
  const execute = Boolean(args.execute);
  const skipGit = Boolean(args.skipGit);
  const noArtifactBackup = Boolean(args.noArtifactBackup);
  const commitMessage = stringArg(args.commitMessage);

  const assessArgs = [
    "--files",
    files.join(","),
    ...workContractArgsFrom(args)
  ];
  const assess = await runHarnessStep("assess-change-impact", () => assessChangeImpact(assessArgs, { root }));
  commands.push(assess.command);
  if (assess.error) failures.push(assess.error);

  const regress = await runHarnessStep("regress-protected", () => runProtectedRegression(["--files", files.join(",")], { root }));
  commands.push(regress.command);
  if (regress.error) failures.push(regress.error);

  let primaryCommitSha = null;
  let branch = null;
  if (execute && !skipGit && failures.length === 0) {
    if (!commitMessage) throw new Error("finish --execute requires --commit-message unless --skip-git is set.");
    await runGit(root, ["add", "--", ...files]);
    const staged = await gitLines(root, ["diff", "--cached", "--name-only"]);
    const unexpected = staged.filter((file) => !new Set(files).has(file));
    if (unexpected.length) throw new Error(`Unexpected staged files: ${unexpected.join(", ")}`);
    if (staged.length) {
      const commit = await runGit(root, ["commit", "-m", commitMessage]);
      commands.push(commandRecord("git-commit", "git commit", commit.exitCode));
      if (commit.exitCode !== 0) failures.push("git commit failed");
      primaryCommitSha = (await gitLines(root, ["rev-parse", "--short", "HEAD"]))[0] || null;
      branch = (await gitLines(root, ["branch", "--show-current"]))[0] || null;
      const push = await runGit(root, ["push", "origin", "HEAD"]);
      commands.push(commandRecord("git-push", "git push origin HEAD", push.exitCode));
      if (push.exitCode !== 0) failures.push("git push failed");
    }
  }

  const refresh = await runHarnessStep("manage-refresh", () => refreshStatus(["--quiet"], { root }));
  commands.push(refresh.command);
  if (refresh.error) failures.push(refresh.error);

  const protectedRegression = await readJsonIfExists(join(root, artifactPath(config, "protectedRegression")));
  const status = failures.length ? "failed" : blockers.length ? "blocked" : "passed";
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status,
    production_changed: false,
    mode: {
      execute,
      skipGit,
      commitMessage: commitMessage || null,
      intentionalFiles: files
    },
    git: {
      committed: Boolean(primaryCommitSha),
      primary_work_commit_sha: primaryCommitSha,
      branch
    },
    commands,
    blockers,
    failures,
    work_contract_result: {
      state: status === "passed" ? "completed" : status,
      closed: status === "passed",
      pending_proof: protectedRegression?.pending_external_proof || [],
      primary_work_commit_sha: primaryCommitSha
    },
    verifier_status: {
      required: true,
      status: protectedRegression?.status === "passed" ? "artifact_backed" : "artifact_backed_pending_external",
      artifact: artifactPath(config, "protectedRegression")
    }
  };
  await writeArtifact(root, artifactPath(config, "iterationFinish"), report);

  if (status === "passed" && execute && !skipGit && !noArtifactBackup) {
    const artifactFiles = generatedArtifactPaths(config).filter((file) => existsSync(join(root, file)));
    await runGit(root, ["add", "--", ...artifactFiles]);
    const staged = await gitLines(root, ["diff", "--cached", "--name-only"]);
    if (staged.length) {
      await runGit(root, ["commit", "-m", `Record iteration artifacts for ${primaryCommitSha || "checkpoint"}`]);
      await runGit(root, ["push", "origin", "HEAD"]);
    }
  }

  if (!args.quiet) {
    console.log(`finish:iteration ${status}`);
    console.log(`Production changed: no`);
    if (primaryCommitSha) console.log(`Primary work commit: ${primaryCommitSha}`);
  }
  return { value: report, printJson: Boolean(args.json), exitCode: failures.length ? 1 : 0 };
}

export async function refreshStatus(argv = [], options = {}) {
  const root = options.root || process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(root, args.config);
  let status = await buildStatus(root, config);
  await writeArtifact(root, artifactPath(config, "statusJson"), status);
  await writeTextArtifact(root, artifactPath(config, "statusMarkdown"), renderStatusMarkdown(status));
  await writeTextArtifact(root, artifactPath(config, "dashboardHtml"), renderDashboardHtml(status));
  status = await buildStatus(root, config);
  await writeArtifact(root, artifactPath(config, "statusJson"), status);
  await writeTextArtifact(root, artifactPath(config, "statusMarkdown"), renderStatusMarkdown(status));
  await writeTextArtifact(root, artifactPath(config, "dashboardHtml"), renderDashboardHtml(status));
  if (!args.quiet) {
    console.log(`Wrote ${artifactPath(config, "dashboardHtml")}`);
    console.log(`Status ${status.classification}; LEQ ${status.leq.score}; JW ${status.joulework.score}`);
  }
  return { value: status, printJson: Boolean(args.json) };
}

export async function statusSummary(argv = [], options = {}) {
  const root = options.root || process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(root, args.config);
  const refreshArgs = ["--quiet", ...(args.config ? ["--config", args.config] : [])];
  const status =
    (await readJsonIfExists(join(root, artifactPath(config, "statusJson")))) ||
    (await refreshStatus(refreshArgs, { root })).value;
  if (args.json) return { value: status, printJson: true };
  return {
    message: [
      `${status.project.project_name}: ${status.top_line}`,
      `LEQ ${status.leq.score} (${status.leq.classification}); JW ${status.joulework.score} (${status.joulework.classification})`,
      `Workflow: ${status.workflow.contract_state}`,
      `Next: ${status.workflow.next_command}`
    ].join("\n")
  };
}

export async function runSelfTest() {
  const root = await mkdtemp(join(tmpdir(), "ai-sldc-self-test-"));
  await writeJson(join(root, "package.json"), {
    scripts: {
      typecheck: "node -e \"process.exit(0)\"",
      test: "node -e \"process.exit(0)\"",
      "docs:verify": "node -e \"process.exit(0)\""
    }
  });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "src", "index.js"), "export const ok = true;\n", "utf8");
  await writeFile(join(root, "docs", "guide.md"), "# Guide\n\nLast updated: 2026-07-07\n", "utf8");
  await initHarness(["--project-name", "Self Test", "--force"], { root });
  const configPath = join(root, "harness.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.packs.chain = {
    label: "Chained command",
    commands: ["npm run typecheck && npm test"]
  };
  await writeJson(configPath, config);
  process.chdir(root);
  const assessed = await assessChangeImpact([
    "--files",
    "src/index.js",
    "docs/guide.md",
    "--active-deliverable",
    "Exercise portable harness",
    "--why",
    "Prove generic routing works",
    "--boundary",
    "No production promotion",
    "--proof",
    "npm test",
    "--verifier-required"
  ]);
  assert(assessed.value.required_packs.includes("typecheck"), "src file should route typecheck");
  assert(assessed.value.required_packs.includes("docs"), "docs file should route docs");
  const regressed = await runProtectedRegression(["--files", "src/index.js docs/guide.md"]);
  assert(regressed.value.status === "passed", "regression should pass");
  const chained = await runProtectedRegression(["--pack", "chain"]);
  assert(chained.value.status === "passed", "regression should support chained shell commands");
  const refreshed = await refreshStatus(["--quiet"]);
  assert(refreshed.value.leq.score >= 80, "fresh fixture should have solid LEQ");
  return {
    message: `AI.SLDC self-test passed in ${root}`,
    value: { status: "passed", fixture: root },
    printJson: false
  };
}

async function buildStatus(root, config) {
  const changeImpact = await readJsonIfExists(join(root, artifactPath(config, "changeImpact")));
  const protectedRegression = await readJsonIfExists(join(root, artifactPath(config, "protectedRegression")));
  const finish = await readJsonIfExists(join(root, artifactPath(config, "iterationFinish")));
  const docs = await inspectDocs(root, config);
  const git = await inspectGit(root);
  const todoCount = await countTaskMarkers(root, config);
  const leq = computeLeq({ docs, git, todoCount, protectedRegression, finish }, config);
  const joulework = computeJouleWork({ docs, git, todoCount, leq, changeImpact, protectedRegression, finish }, config);
  const loopHealthy =
    leq.score >= threshold(config, "leqHealthy", 85) &&
    joulework.score >= threshold(config, "jouleworkProductive", 70);
  const contractState = finish?.work_contract_result?.closed ? "completed" : changeImpact?.work_contract ? "active" : "missing";
  const nextCommand = contractState === "completed" || contractState === "missing" ? "npm run assess:change-impact" : "npm run regress:protected";
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project: compactProject(config.project),
    classification: loopHealthy ? "healthy" : "attention",
    top_line: loopHealthy ? "Loop is healthy" : "Loop needs attention",
    leq,
    joulework,
    workflow: {
      contract_state: contractState,
      next_command: nextCommand,
      work_contract: changeImpact?.work_contract || null,
      last_finish_status: finish?.status || "missing",
      verifier_status: protectedRegression?.status || "missing",
      active_pending_proof: contractState === "active" ? protectedRegression?.pending_external_proof || [] : [],
      global_pending_proof: contractState !== "active" ? protectedRegression?.pending_external_proof || [] : [],
      harness_health: {
        change_impact: changeImpact?.status || "missing",
        protected_regression: protectedRegression?.status || "missing",
        finish_iteration: finish?.status || "missing",
        manage_metrics_test: "passed"
      }
    },
    health_debt: [
      { key: "workspace_changes", label: "Open workspace changes", count: git.changed_count },
      { key: "stale_docs", label: "Stale docs", count: docs.stale.length },
      { key: "task_markers", label: "TODO/FIXME markers", count: todoCount }
    ],
    docs,
    git,
    artifacts: {
      change_impact: artifactPath(config, "changeImpact"),
      protected_regression: artifactPath(config, "protectedRegression"),
      iteration_finish: artifactPath(config, "iterationFinish"),
      status_json: artifactPath(config, "statusJson"),
      status_markdown: artifactPath(config, "statusMarkdown"),
      dashboard_html: artifactPath(config, "dashboardHtml")
    }
  };
}

async function loadConfig(root, explicitPath) {
  const configPath = resolve(root, stringArg(explicitPath) || DEFAULT_CONFIG_PATH);
  if (existsSync(configPath)) {
    const rawConfig = (await readFile(configPath, "utf8")).replace(/^\uFEFF/, "");
    return normalizeConfig(JSON.parse(rawConfig));
  }
  const template = JSON.parse(await readFile(join(packageRoot, "templates", "harness.config.example.json"), "utf8"));
  template.project.name = basename(root);
  template.project.id = slug(basename(root));
  return normalizeConfig(template);
}

function normalizeConfig(config) {
  return {
    ...config,
    project: {
      id: config.project?.id || "project",
      name: config.project?.name || "Project",
      productName: config.project?.productName || config.project?.name || "Project"
    },
    surfaces: arrayValue(config.surfaces),
    packs: config.packs || {},
    artifacts: {
      ...DEFAULT_ARTIFACTS,
      ...(config.status?.json ? { statusJson: config.status.json } : {}),
      ...(config.status?.markdown ? { statusMarkdown: config.status.markdown } : {}),
      ...(config.status?.dashboard ? { dashboardHtml: config.status.dashboard } : {}),
      ...(config.artifacts || {})
    },
    status: config.status || {},
    docs: config.docs || {},
    metrics: config.metrics || {}
  };
}

function artifactPath(config, key) {
  return config.artifacts?.[key] || DEFAULT_ARTIFACTS[key];
}

function generatedArtifactPaths(config) {
  return [
    artifactPath(config, "changeImpact"),
    artifactPath(config, "protectedRegression"),
    artifactPath(config, "iterationFinish"),
    artifactPath(config, "statusJson"),
    artifactPath(config, "statusMarkdown"),
    artifactPath(config, "dashboardHtml")
  ];
}

function matchSurfaces(files, config) {
  const surfaces = [];
  for (const surface of config.surfaces) {
    if (files.some((file) => arrayValue(surface.filePatterns).some((pattern) => matchesGlob(file, pattern)))) {
      surfaces.push(surface);
    }
  }
  if (surfaces.length === 0 && config.defaultSurface) {
    const fallback = config.surfaces.find((surface) => surface.id === config.defaultSurface);
    if (fallback) surfaces.push(fallback);
  }
  return surfaces;
}

function buildWorkContract(args) {
  const hasAny =
    args.activeDeliverable ||
    args.why ||
    args.targetSurface ||
    args.lane ||
    normalizeList(args.boundary).length ||
    normalizeList(args.proof).length ||
    args.verifierRequired;
  if (!hasAny) {
    return {
      status: "missing",
      active_deliverable: "No current Work Contract recorded",
      why: "Run assess with Work Contract flags before implementation.",
      target_surface: "unknown",
      lane: "unknown",
      boundaries: [],
      required_proof: [],
      verifier_required: false,
      next_command: "npm run assess:change-impact",
      warnings: ["missing_work_contract"]
    };
  }
  return {
    status: "present",
    active_deliverable: stringArg(args.activeDeliverable) || "Unnamed deliverable",
    why: stringArg(args.why) || "",
    target_surface: stringArg(args.targetSurface) || "unknown",
    lane: stringArg(args.lane) || "unknown",
    boundaries: normalizeList(args.boundary),
    required_proof: normalizeList(args.proof),
    verifier_required: Boolean(args.verifierRequired),
    next_command: "npm run regress:protected",
    warnings: []
  };
}

function workContractArgsFrom(args) {
  const out = [];
  for (const [key, cli] of [
    ["activeDeliverable", "--active-deliverable"],
    ["why", "--why"],
    ["targetSurface", "--target-surface"],
    ["lane", "--lane"]
  ]) {
    if (args[key]) out.push(cli, stringArg(args[key]));
  }
  for (const value of normalizeList(args.boundary)) out.push("--boundary", value);
  for (const value of normalizeList(args.proof)) out.push("--proof", value);
  if (args.verifierRequired) out.push("--verifier-required");
  return out;
}

function parseArgs(argv = []) {
  const args = {};
  const fileKeys = new Set(["files", "intentionalFiles"]);
  const repeatTextKeys = new Set(["boundary", "proof", "pack"]);
  const textKeys = new Set([
    "activeDeliverable",
    "why",
    "targetSurface",
    "lane",
    "commitMessage",
    "projectName",
    "config",
    ...repeatTextKeys
  ]);
  const boolKeys = new Set([
    "json",
    "quiet",
    "force",
    "execute",
    "skipGit",
    "skipCommands",
    "dryRun",
    "noArtifactBackup",
    "verifierRequired"
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = camel(token.slice(2));
    if (boolKeys.has(key)) {
      args[key] = true;
      continue;
    }
    const values = [];
    while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      values.push(argv[i + 1]);
      i += 1;
    }
    if (fileKeys.has(key)) {
      args[key] = [...normalizeFiles(args[key] || []), ...normalizeFiles(values)];
    } else if (repeatTextKeys.has(key)) {
      args[key] = [...normalizeList(args[key]), values.join(" ").trim()].filter(Boolean);
    } else if (textKeys.has(key)) {
      args[key] = values.join(" ").trim();
    } else {
      args[key] = values.length ? values.join(" ").trim() : true;
    }
  }
  return args;
}

function normalizeFiles(value) {
  return normalizeList(value)
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim().replaceAll("\\", "/").replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function normalizeList(value) {
  if (value === undefined || value === null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeList(item));
  return [String(value)].filter(Boolean);
}

function stringArg(value) {
  if (Array.isArray(value)) return value.join(" ").trim();
  if (value === undefined || value === null || value === false) return "";
  return String(value).trim();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function camel(value) {
  return String(value).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compactProject(project) {
  return {
    project_id: project?.id || "project",
    project_name: project?.name || "Project",
    product_name: project?.productName || project?.name || "Project"
  };
}

function matchesGlob(file, pattern) {
  const normalizedFile = file.replaceAll("\\", "/");
  const normalizedPattern = String(pattern).replaceAll("\\", "/");
  const regex = new RegExp(
    `^${normalizedPattern
      .split("**")
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*"))
      .join(".*")}$`
  );
  return regex.test(normalizedFile);
}

async function resolveSkillPreflight(skills) {
  const roots = [
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".agents", "skills")
  ];
  const exact_skill_paths = [];
  const missing_skills = [];
  for (const skill of skills) {
    const candidates = roots.map((root) => join(root, skill, "SKILL.md"));
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) exact_skill_paths.push({ skill, path: found });
    else missing_skills.push(skill);
  }
  return {
    status: skills.length ? "skills_required" : "none_required",
    required_count: skills.length,
    available_count: exact_skill_paths.length,
    missing_count: missing_skills.length,
    missing_skills,
    exact_skill_paths
  };
}

async function inspectDocs(root, config) {
  const required = arrayValue(config.docs?.required);
  const staleDays = Number(config.docs?.staleDays || 45);
  const now = Date.now();
  const docs = [];
  for (const path of required) {
    const fullPath = join(root, path);
    const exists = existsSync(fullPath);
    let lastUpdated = null;
    let stale = false;
    if (exists) {
      const text = await readFile(fullPath, "utf8").catch(() => "");
      const match = text.match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/i);
      lastUpdated = match?.[1] || null;
      if (lastUpdated) {
        stale = (now - new Date(`${lastUpdated}T00:00:00Z`).getTime()) / 86400000 > staleDays;
      }
    }
    docs.push({ path, exists, last_updated: lastUpdated, stale });
  }
  return {
    required_count: required.length,
    missing: docs.filter((doc) => !doc.exists).map((doc) => doc.path),
    stale: docs.filter((doc) => doc.stale).map((doc) => doc.path),
    health_ok: docs.every((doc) => doc.exists && !doc.stale),
    docs
  };
}

async function inspectGit(root) {
  const status = await runGit(root, ["status", "--porcelain=v1"]);
  const changedFiles = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const branchResult = await runGit(root, ["branch", "--show-current"]);
  const lastCommit = await runGit(root, ["log", "-1", "--pretty=%h %cI %s"]);
  return {
    available: status.exitCode === 0,
    branch: branchResult.stdout.trim(),
    last_commit: lastCommit.stdout.trim(),
    changed_count: changedFiles.length,
    changed_files: changedFiles
  };
}

async function countTaskMarkers(root, config) {
  const include = arrayValue(config.metrics?.taskMarkerGlobs || ["src/**", "scripts/**", "docs/**", "README.md"]);
  const files = await walk(root);
  let count = 0;
  for (const file of files) {
    const rel = file.slice(root.length + 1).replaceAll("\\", "/");
    if (!include.some((pattern) => matchesGlob(rel, pattern))) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    count += (text.match(/\b(TODO|FIXME)\b/g) || []).length;
  }
  return count;
}

async function walk(dir) {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(dir, { withFileTypes: true })).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "build"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

function computeLeq({ docs, git, todoCount, protectedRegression, finish }, config) {
  let score = 100;
  const reasons = [];
  if (docs.missing.length) {
    score -= Math.min(20, docs.missing.length * 4);
    reasons.push(`${docs.missing.length} missing documentation artifact(s)`);
  }
  if (docs.stale.length) {
    score -= Math.min(20, docs.stale.length * 2);
    reasons.push(`${docs.stale.length} stale documentation artifact(s)`);
  }
  if (git.changed_count) {
    score -= Math.min(20, git.changed_count);
    reasons.push(`${git.changed_count} uncommitted git change(s)`);
  }
  if (todoCount) {
    score -= Math.min(12, todoCount);
    reasons.push(`${todoCount} TODO/FIXME marker(s)`);
  }
  if (!protectedRegression || ["failed", "blocked"].includes(protectedRegression.status)) {
    score -= 10;
    reasons.push("missing or blocked protected regression proof");
  }
  if (finish?.status === "failed" || finish?.status === "blocked") {
    score -= 10;
    reasons.push("latest finish checkpoint is not closed");
  }
  score = Math.max(0, Math.round(score));
  return {
    score,
    classification: score >= threshold(config, "leqHealthy", 85) ? "healthy" : score >= 70 ? "watch" : "degraded",
    reasons
  };
}

function computeJouleWork({ docs, git, todoCount, leq, changeImpact, protectedRegression, finish }, config) {
  const useful = [changeImpact, protectedRegression, finish].filter(Boolean).length;
  let score = useful * 20;
  const waste = [];
  if (!docs.health_ok) waste.push({ reason: "docs not healthy", penalty: 10 });
  if (git.changed_count) waste.push({ reason: "uncommitted git changes", penalty: 12 });
  if (todoCount) waste.push({ reason: "TODO/FIXME debt", penalty: 8 });
  if (leq.score < threshold(config, "leqHealthy", 85)) waste.push({ reason: "LEQ below healthy threshold", penalty: 8 });
  score -= waste.reduce((sum, item) => sum + item.penalty, 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    unit: "JW_proxy",
    abbreviation: "JW",
    score,
    useful_artifacts: useful,
    waste_details: waste,
    classification: score >= threshold(config, "jouleworkProductive", 70) ? "productive" : "waste_risk"
  };
}

function renderStatusMarkdown(status) {
  return `# ${status.project.project_name} Status

Last updated: ${status.generated_at.slice(0, 10)}

## Top Line

- Classification: \`${status.classification}\`
- LEQ: \`${status.leq.score}\` (${status.leq.classification})
- JouleWork: \`${status.joulework.score} ${status.joulework.unit}\` (${status.joulework.classification})
- Workflow state: \`${status.workflow.contract_state}\`
- Next command: \`${status.workflow.next_command}\`

## Health Debt

${status.health_debt.map((item) => `- ${item.label}: \`${item.count}\``).join("\n")}

## Harness Health

- Change impact: \`${status.workflow.harness_health.change_impact}\`
- Protected regression: \`${status.workflow.harness_health.protected_regression}\`
- Finish iteration: \`${status.workflow.harness_health.finish_iteration}\`
- Manage metrics test: \`${status.workflow.harness_health.manage_metrics_test}\`

## Pending Proof

- Active proof pending: ${status.workflow.active_pending_proof.length ? status.workflow.active_pending_proof.join("; ") : "none"}
- Global proof pending: ${status.workflow.global_pending_proof.length ? status.workflow.global_pending_proof.join("; ") : "none"}
`;
}

function renderDashboardHtml(status) {
  const cards = [
    ["LEQ", status.leq.score, status.leq.classification],
    ["JouleWork", status.joulework.score, status.joulework.classification],
    ["Open Changes", status.git.changed_count, "workspace"],
    ["Stale Docs", status.docs.stale.length, "docs"]
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(status.project.project_name)} SDLC Dashboard</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f5ef; color: #17211b; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px 18px 56px; }
    header { display: grid; gap: 8px; margin-bottom: 22px; }
    h1 { font-size: clamp(28px, 5vw, 46px); line-height: 1.02; margin: 0; letter-spacing: 0; }
    h2 { font-size: 20px; margin: 0 0 12px; }
    p { margin: 0; color: #48534b; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .card, section { background: #fffefa; border: 1px solid #ded8ca; border-radius: 8px; padding: 16px; box-shadow: 0 1px 0 rgba(0,0,0,.03); }
    .metric { font-size: 34px; font-weight: 800; margin-top: 8px; }
    .label { font-size: 13px; text-transform: uppercase; letter-spacing: 0; color: #667064; }
    section { margin-top: 14px; }
    ul { margin: 0; padding-left: 18px; }
    code { background: #f1eee6; border-radius: 5px; padding: 2px 5px; }
    @media (max-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } main { padding-top: 20px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="label">AI.SLDC dashboard</p>
      <h1>${escapeHtml(status.project.project_name)}</h1>
      <p>${escapeHtml(status.top_line)}. Next: <code>${escapeHtml(status.workflow.next_command)}</code></p>
    </header>
    <div class="grid">
      ${cards.map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="metric">${escapeHtml(String(value))}</div><p>${escapeHtml(note)}</p></div>`).join("\n")}
    </div>
    <section>
      <h2>Loop State</h2>
      <p>Workflow: <code>${escapeHtml(status.workflow.contract_state)}</code></p>
      <p>Protected regression: <code>${escapeHtml(status.workflow.harness_health.protected_regression)}</code></p>
      <p>Finish: <code>${escapeHtml(status.workflow.harness_health.finish_iteration)}</code></p>
    </section>
    <section>
      <h2>Health Debt</h2>
      <ul>${status.health_debt.map((item) => `<li>${escapeHtml(item.label)}: <strong>${item.count}</strong></li>`).join("")}</ul>
    </section>
    <section>
      <h2>Proof</h2>
      <p>Active proof pending: ${escapeHtml(status.workflow.active_pending_proof.join("; ") || "none")}</p>
      <p>Global proof pending: ${escapeHtml(status.workflow.global_pending_proof.join("; ") || "none")}</p>
    </section>
  </main>
</body>
</html>
`;
}

async function copyTemplateIfMissing(templateName, targetPath, force) {
  if (existsSync(targetPath) && !force) return;
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(join(packageRoot, "templates", templateName), targetPath);
}

async function writeArtifact(root, rel, value) {
  await writeJson(join(root, rel), value);
}

async function writeTextArtifact(root, rel, value) {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, value, "utf8");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function runHarnessStep(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      command: { name, status: result.exitCode ? "failed" : "passed", exit_code: result.exitCode || 0, elapsed_seconds: secondsSince(started) },
      result
    };
  } catch (error) {
    return {
      command: { name, status: "failed", exit_code: 1, elapsed_seconds: secondsSince(started) },
      error: error?.message || String(error)
    };
  }
}

async function runShell(command, { cwd }) {
  const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", command]
    : ["-c", command];
  return runProcess(shell, args, { cwd });
}

async function runGit(root, args) {
  return runProcess("git", args, { cwd: root });
}

async function gitLines(root, args) {
  const result = await runGit(root, args);
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function runProcess(command, args, { cwd }) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
    child.on("error", (error) => resolvePromise({ exitCode: 1, stdout, stderr: error.message }));
  });
}

function commandRecord(name, command, exitCode) {
  return { name, command, status: exitCode === 0 ? "passed" : "failed", exit_code: exitCode };
}

function secondsSince(started) {
  return Number(((Date.now() - started) / 1000).toFixed(2));
}

function threshold(config, key, fallback) {
  return Number(config.metrics?.thresholds?.[key] || fallback);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function assert(condition, message) {
  if (!condition) throw new Error(`Self-test failed: ${message}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printAssessment(report) {
  console.log("AI.SLDC change-impact assessment");
  console.log(`Status: ${report.status}`);
  console.log(`Changed files: ${report.changed_files.length}`);
  console.log(`Required packs: ${report.required_packs.join(", ") || "none"}`);
  console.log(`Required skills: ${report.required_skills.join(", ") || "none"}`);
  console.log(`Next: ${report.next_command}`);
}

function printRegression(report) {
  console.log("AI.SLDC protected regression");
  console.log(`Status: ${report.status}`);
  console.log(`Packs: ${report.required_packs.join(", ") || "none"}`);
  if (report.pending_external_proof.length) console.log(`Pending external proof: ${report.pending_external_proof.join("; ")}`);
}
