#!/usr/bin/env node
import {
  assessChangeImpact,
  finishIteration,
  initHarness,
  refreshStatus,
  runProtectedRegression,
  runSelfTest,
  statusSummary,
  verifyCompletion
} from "./core.mjs";
import {
  installJsmDependencies,
  verifyJsmDependencies
} from "./jsm-dependencies.mjs";
import {
  buildPortfolioPortal,
  hashArtifact,
  recordLifecycleEvent,
  servePortfolioPortal,
  syncPortfolio,
  validatePortfolio
} from "./portfolio.mjs";

const raw = process.argv.slice(2);
const command = normalizeCommand(raw[0]);
const args = raw.slice(command ? 1 : 0);

try {
  let result;
  switch (command || "help") {
    case "init":
      result = await initHarness(args);
      break;
    case "assess":
      result = await assessChangeImpact(args);
      break;
    case "regress":
      result = await runProtectedRegression(args);
      break;
    case "finish":
      result = await finishIteration(args);
      break;
    case "refresh":
      result = await refreshStatus(args);
      break;
    case "status":
      result = await statusSummary(args);
      break;
    case "self-test":
      result = await runSelfTest(args);
      break;
    case "skills:install":
      result = await installJsmDependencies(args);
      break;
    case "skills:verify":
      result = await verifyJsmDependencies(args);
      break;
    case "plan:validate":
      result = await validatePortfolio(args);
      break;
    case "portal:build":
      result = await buildPortfolioPortal(args);
      break;
    case "portal:serve":
      result = await servePortfolioPortal(args);
      break;
    case "portfolio:sync":
      result = await syncPortfolio(args);
      break;
    case "plan:record-event":
      result = await recordLifecycleEvent(args);
      break;
    case "artifact:hash":
      result = await hashArtifact(args);
      break;
    case "verify-completion": {
      const dependencies = await verifyJsmDependencies(["--json"]);
      result = dependencies.exitCode ? dependencies : await verifyCompletion(args);
      break;
    }
    case "help":
      printHelp();
      process.exit(0);
    default:
      throw new Error(`Unknown ai-sdlc command: ${raw[0]}`);
  }

  if (result?.printJson) {
    console.log(JSON.stringify(result.value, null, 2));
  } else if (result?.message) {
    console.log(result.message);
  } else if (result && Object.hasOwn(result, "printJson")) {
    // Command already printed its concise human output.
  } else if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (result?.exitCode) process.exit(result.exitCode);
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

function normalizeCommand(value) {
  if (!value) return "";
  const normalized = String(value).toLowerCase();
  if (["assess:change-impact", "change-impact"].includes(normalized)) return "assess";
  if (["regress:protected", "protected-regression"].includes(normalized)) return "regress";
  if (["finish:iteration"].includes(normalized)) return "finish";
  if (["manage:refresh", "dashboard"].includes(normalized)) return "refresh";
  if (["manage:status"].includes(normalized)) return "status";
  if (["manage:metrics:test", "test"].includes(normalized)) return "self-test";
  if (["jsm:install", "skills-install"].includes(normalized)) return "skills:install";
  if (["jsm:verify", "skills-verify"].includes(normalized)) return "skills:verify";
  if (["validate", "trace:validate", "portfolio:validate"].includes(normalized)) return "plan:validate";
  if (["portfolio:build", "dashboard:build"].includes(normalized)) return "portal:build";
  if (["portfolio:serve", "dashboard:serve"].includes(normalized)) return "portal:serve";
  if (["portfolio:sync", "dashboard:sync"].includes(normalized)) return "portfolio:sync";
  if (["record-event", "lifecycle:record"].includes(normalized)) return "plan:record-event";
  if (["hash", "hash:artifact"].includes(normalized)) return "artifact:hash";
  return normalized;
}

function printHelp() {
  console.log(`AI.SDLC harness

Usage:
  ai-sdlc init [--project-name MyProject]
  ai-sdlc assess --files src/a.ts docs/b.md --applied-skill planning-workflow,readme-writing --active-deliverable "..." --why "..." --target-surface app --lane full-sdlc --boundary "..." --proof "npm test"
  ai-sdlc regress --files src/a.ts docs/b.md --applied-skill testing-real-service-e2e-no-mocks
  ai-sdlc finish --intentional-files src/a.ts --applied-skill reality-check-for-project --skip-git
  ai-sdlc refresh
  ai-sdlc status --json
  ai-sdlc self-test
  ai-sdlc skills:install [--json]
  ai-sdlc skills:verify [--json]
  ai-sdlc verify-completion --intentional-files src/a.ts,docs/b.md
  ai-sdlc plan:validate --ledger portfolio.ledger.json --stage change|release|post-deploy|drift [--project id] [--work-item id] [--release id]
  ai-sdlc portal:build --ledger portfolio.ledger.json --output ops/portfolio-dashboard.html
  ai-sdlc portal:serve --ledger portfolio.ledger.json --host 127.0.0.1 --port 5190
  ai-sdlc portfolio:sync --ledger portfolio.ledger.json --output ops/portfolio-dashboard.html --metrics-output ops/portfolio-metrics.json
  ai-sdlc plan:record-event --ledger portfolio.ledger.json --event release|deployment --ref lifecycle-ref --run-url https://github.example/run
  ai-sdlc artifact:hash --file dist/release.zip

File list flags accept comma-separated, repeated, and space-separated paths until the next flag.
Applied skills accept comma-separated or repeated --applied-skill flags.
Text flags such as --active-deliverable, --why, --boundary, and --proof collect words until the next flag.
JSM skill bodies are installed from Jeffrey's Skills.md and are not redistributed by this package.
`);
}
