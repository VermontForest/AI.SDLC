#!/usr/bin/env node
import {
  assessChangeImpact,
  finishIteration,
  initHarness,
  refreshStatus,
  runProtectedRegression,
  runSelfTest,
  statusSummary
} from "./core.mjs";
import {
  installJsmDependencies,
  verifyJsmDependencies
} from "./jsm-dependencies.mjs";
import {
  buildPortfolioPortal,
  hashArtifact,
  servePortfolioPortal,
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
    case "artifact:hash":
      result = await hashArtifact(args);
      break;
    case "help":
      printHelp();
      process.exit(0);
    default:
      throw new Error(`Unknown ai-sldc command: ${raw[0]}`);
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
  if (["hash", "hash:artifact"].includes(normalized)) return "artifact:hash";
  return normalized;
}

function printHelp() {
  console.log(`AI.SLDC harness

Usage:
  ai-sldc init [--project-name MyProject]
  ai-sldc assess --files src/a.ts docs/b.md --applied-skill planning-workflow --active-deliverable "..."
  ai-sldc regress --files src/a.ts docs/b.md --applied-skill testing-real-service-e2e-no-mocks
  ai-sldc finish --intentional-files src/a.ts --applied-skill reality-check-for-project --skip-git
  ai-sldc refresh
  ai-sldc status --json
  ai-sldc self-test
  ai-sldc skills:install [--json]
  ai-sldc skills:verify [--json]
  ai-sldc plan:validate --ledger portfolio.ledger.json --stage change|release|post-deploy|drift [--project id] [--work-item id] [--release id]
  ai-sldc portal:build --ledger portfolio.ledger.json --output ops/portfolio-dashboard.html
  ai-sldc portal:serve --ledger portfolio.ledger.json --host 127.0.0.1 --port 5190
  ai-sldc artifact:hash --file dist/release.zip

File list flags accept comma-separated, repeated, and space-separated paths until the next flag.
Applied skills accept comma-separated or repeated --applied-skill flags.
Text flags such as --active-deliverable, --why, --boundary, and --proof collect words until the next flag.
JSM skill bodies are installed from Jeffrey's Skills.md and are not redistributed by this package.
`);
}
