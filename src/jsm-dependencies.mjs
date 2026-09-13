import { captureProcess as spawnSync } from "./process.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultLockPath = resolve(packageRoot, "jsm", "official-skills.lock.json");
const JSM_SOURCE = "https://jeffreys-skills.md";
const JSM_TERMS = "https://jeffreys-skills.md/terms";

export async function installJsmDependencies(argv = []) {
  const lock = await readJsmLock();
  ensureJsmVersion(lock);

  const installResult = runJsm(["install-all", "--yes", "--json"]);
  const installed = Number(installResult.installed?.length || 0);
  const upgraded = Number(installResult.upgraded?.length || 0);
  const alreadyCurrent = Number(installResult.already_current?.length || 0);

  const current = readInstalledInventory();
  const skillsToRepair = lock.skills.filter((skill) => {
    const installedSkill = current.skills.get(skill.name);
    return !installedSkill ||
      Number(installedSkill.version) !== Number(skill.version) ||
      installedSkill.integrity_status !== "ok" ||
      installedSkill.sha256 !== skill.sha256;
  });
  for (const skill of skillsToRepair) {
    runJsm(["install", skill.name, "--version", String(skill.version), "--force", "--json"]);
  }

  const verification = await verifyJsmDependencies(["--json"]);
  return {
    ...verification,
    message: verification.exitCode
      ? `JSM installation completed, but lock verification failed with ${verification.value.failures.length} issue(s).`
      : `JSM installation verified: ${verification.value.locked_skill_count} locked official skills are present and intact.`,
    value: {
      ...verification.value,
      install_summary: {
        installed,
        upgraded,
        already_current: alreadyCurrent,
        repaired_or_pinned_to_lock: skillsToRepair.length
      }
    },
    printJson: argv.includes("--json")
  };
}

export async function verifyJsmDependencies(argv = []) {
  const lock = await readJsmLock();
  const cliVersion = ensureJsmVersion(lock);
  const current = readInstalledInventory();
  const failures = [];

  for (const skill of lock.skills) {
    const installed = current.skills.get(skill.name);
    if (!installed) {
      failures.push({
        skill: skill.name,
        reason: "missing",
        expected_version: skill.version,
        expected_sha256: skill.sha256
      });
      continue;
    }
    if (Number(installed.version) !== Number(skill.version)) {
      failures.push({
        skill: skill.name,
        reason: "version_mismatch",
        expected_version: skill.version,
        actual_version: installed.version
      });
    }
    if (installed.integrity_status !== "ok" || installed.sha256 !== skill.sha256) {
      failures.push({
        skill: skill.name,
        reason: "integrity_mismatch",
        expected_sha256: skill.sha256,
        actual_sha256: installed.sha256,
        integrity_status: installed.integrity_status
      });
    }
  }

  const lockedNames = new Set(lock.skills.map((skill) => skill.name));
  const additionalOfficialSkills = [...current.skills.keys()]
    .filter((name) => !lockedNames.has(name))
    .sort();
  const value = {
    status: failures.length ? "fail" : "pass",
    jsm_cli_version: cliVersion,
    lock_generated_at: lock.generated_at,
    locked_skill_count: lock.skills.length,
    installed_official_skill_count: current.skills.size,
    additional_official_skills: additionalOfficialSkills,
    failures
  };
  return {
    value,
    exitCode: failures.length ? 1 : 0,
    printJson: argv.includes("--json"),
    message: failures.length
      ? `JSM lock verification failed with ${failures.length} issue(s).`
      : `JSM lock verified: ${lock.skills.length} official skills match their locked versions and hashes.`
  };
}

export async function readJsmLock(lockPath = defaultLockPath) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  validateLock(lock);
  return lock;
}

export async function writeJsmLock(lockPath = defaultLockPath) {
  const cliVersion = installedJsmVersion();
  const current = readInstalledInventory();
  const skills = [...current.skills.values()]
    .map(({ name, version, sha256, integrity_status: integrityStatus }) => {
      if (integrityStatus !== "ok" || !sha256) {
        throw new Error(`Cannot lock JSM skill without passing integrity: ${name}`);
      }
      return { name, version, sha256 };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const lock = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: {
      service: "Jeffrey's Skills.md",
      url: JSM_SOURCE,
      terms_url: JSM_TERMS,
      selection: "all_official",
      distribution: "metadata_only",
      note: "Premium skill bodies are installed through jsm and are not redistributed by AI.SDLC."
    },
    cli: {
      minimum_version: cliVersion,
      resolved_version: cliVersion
    },
    skill_count: skills.length,
    skills
  };
  validateLock(lock);
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return lock;
}

function readInstalledInventory() {
  const listed = runJsm(["list", "--json"]);
  const verified = runJsm(["verify", "--json"]);
  const verificationByName = new Map(
    (verified.results || []).map((result) => [result.skill, result])
  );
  const skills = new Map();
  for (const skill of listed.skills || []) {
    const integrity = verificationByName.get(skill.name);
    skills.set(skill.name, {
      name: skill.name,
      version: Number(skill.version),
      sha256: integrity?.computed_hash || null,
      integrity_status: integrity?.status || "missing_verification"
    });
  }
  if (skills.size !== Number(listed.count || 0)) {
    throw new Error(`JSM inventory count mismatch: listed ${listed.count}, resolved ${skills.size}`);
  }
  return { skills };
}

function ensureJsmVersion(lock) {
  const actual = installedJsmVersion();
  if (compareVersions(actual, lock.cli.minimum_version) < 0) {
    throw new Error(
      `JSM ${lock.cli.minimum_version} or newer is required; found ${actual}. ` +
      "Run the official installer from https://jeffreys-skills.md."
    );
  }
  return actual;
}

function installedJsmVersion() {
  const result = spawnSync("jsm", ["--version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("The jsm CLI is not installed or is not on PATH.");
  }
  if (result.status !== 0) {
    throw new Error(`Unable to read jsm version: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const match = String(result.stdout).match(/(\d+\.\d+\.\d+)/);
  if (!match) throw new Error(`Unable to parse jsm version from: ${String(result.stdout).trim()}`);
  return match[1];
}

function runJsm(args) {
  const result = spawnSync("jsm", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("The jsm CLI is not installed or is not on PATH.");
  }
  if (result.status !== 0) {
    throw new Error(
      `jsm ${args.join(" ")} failed with exit ${result.status}: ` +
      `${(result.stderr || result.stdout || "").trim()}`
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`jsm ${args.join(" ")} returned invalid JSON.`);
  }
}

function validateLock(lock) {
  if (lock?.schema_version !== 1) throw new Error("Unsupported JSM lock schema.");
  if (lock?.source?.selection !== "all_official") throw new Error("JSM lock must select all official skills.");
  if (lock?.source?.distribution !== "metadata_only") {
    throw new Error("JSM lock must preserve the metadata-only redistribution boundary.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(lock?.cli?.minimum_version || ""))) {
    throw new Error("JSM lock has an invalid minimum CLI version.");
  }
  if (!Array.isArray(lock.skills) || lock.skills.length !== Number(lock.skill_count)) {
    throw new Error("JSM lock skill count does not match its skill entries.");
  }
  const names = new Set();
  for (const skill of lock.skills) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(skill?.name || ""))) {
      throw new Error(`JSM lock has an invalid skill name: ${skill?.name}`);
    }
    if (names.has(skill.name)) throw new Error(`JSM lock contains duplicate skill: ${skill.name}`);
    names.add(skill.name);
    if (!Number.isInteger(skill.version) || skill.version < 1) {
      throw new Error(`JSM lock has an invalid version for ${skill.name}`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(skill.sha256 || ""))) {
      throw new Error(`JSM lock has an invalid SHA-256 for ${skill.name}`);
    }
  }
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function main() {
  const action = process.argv[2] || "verify";
  let result;
  if (action === "install") result = await installJsmDependencies(process.argv.slice(3));
  else if (action === "verify") result = await verifyJsmDependencies(process.argv.slice(3));
  else if (action === "write-lock") {
    const lock = await writeJsmLock();
    result = {
      exitCode: 0,
      printJson: process.argv.includes("--json"),
      value: lock,
      message: `Wrote JSM lock for ${lock.skill_count} official skills.`
    };
  } else {
    throw new Error(`Unknown JSM dependency action: ${action}`);
  }
  if (result.printJson) console.log(JSON.stringify(result.value, null, 2));
  else console.log(result.message);
  if (result.exitCode) process.exit(result.exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
