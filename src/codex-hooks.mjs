#!/usr/bin/env node
// Local-only lifecycle guardrail. This is not a sandbox or an authorization service.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const json = p => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  requireThat(result.status === 0, `Git verification unavailable: ${args[0]}`);
  return result.stdout.trim();
}
export function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
function safePath(root, name) {
  requireThat(nonempty(name), 'Missing artifact path');
  const requested = resolve(root, name);
  let parent = requested;
  while (!existsSync(parent)) parent = dirname(parent);
  const full = resolve(realpathSync.native(parent), relative(parent, requested));
  requireThat(inside(realpathSync.native(root), full), 'Artifact escapes project or traverses an outside link');
  return full;
}
function fresh(timestamp, now, maxMinutes) {
  const delta = now - Date.parse(timestamp);
  return Number.isFinite(delta) && delta >= -120000 && delta <= maxMinutes * 60000;
}
function projectAt(cwd) {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.status !== 0) return null;
  const root = realpathSync.native(result.stdout.trim());
  const configPath = join(root, 'harness.config.json');
  const config = existsSync(configPath) ? json(configPath) : {};
  return { root, config, policy: config.lifecycle || null };
}
export function assessment(project, now = Date.now()) {
  const { root, config, policy } = project;
  requireThat(policy?.schema_version === 1, 'Project is not enrolled in AI.SLDC lifecycle controls');
  const path = safePath(root, config.artifacts?.changeImpact);
  const impact = json(path);
  requireThat(['packs_required', 'no_packs_required'].includes(impact.status), 'Assessment is not admitted');
  requireThat(fresh(impact.generated_at, now, policy.maxAssessmentMinutes || 60), 'Assessment is stale');
  const context = impact.execution_context;
  requireThat(context && relative(realpathSync.native(context.root), root) === '', 'Assessment belongs to another checkout or lacks checkout binding');
  requireThat(context.head === git(root, ['rev-parse', 'HEAD']), 'Assessment belongs to another revision; reassess');
  requireThat(nonempty(context.work_id), 'Assessment lacks work ID');
  requireThat(impact.outcome_over_ceremony?.status === 'passed', 'Outcome contract has not passed');
  requireThat(impact.work_contract?.verifier_required === true, 'Required verifier is not declared');
  const skills = impact.skill_preflight;
  requireThat(skills?.missing_count === 0 && skills.available_count === impact.required_skills?.length,
    'Required skills are missing or inconsistent');
  requireThat(Array.isArray(impact.changed_files) && impact.changed_files.length > 0, 'No exact assessed files');
  for (const file of impact.changed_files) safePath(root, file);
  for (const metric of policy.metrics || []) {
    const value = json(safePath(root, metric));
    requireThat(fresh(value.generated_at, now, policy.maxMetricMinutes || 60), `Refresh metric evidence: ${metric}`);
  }
  return { impact, path };
}
export function patchTargets(command) {
  requireThat(typeof command === 'string' && command.startsWith('*** Begin Patch'), 'Unsupported patch representation');
  requireThat(!/^\*\*\* (?:Delete File|Move to):/m.test(command), 'Deletion/move is outside this guardrail approval');
  const paths = [...command.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map(x => x[1].trim());
  requireThat(paths.length > 0, 'Patch has no recognized targets');
  return paths;
}
// Deliberately small read-only grammar. Unknown shell syntax requires assessment.
// It is NOT a PowerShell parser and must not be described as a security boundary.
export function readOnlyCommand(command) {
  if (!nonempty(command) || /[\r\n;&|`<>$(){}]/.test(command)) return false;
  if (/^(?:Get-Content|Get-Item|Get-ChildItem|Test-Path|Select-String|Get-Command)(?:\s|$)/i.test(command)) return true;
  if (/^rg(?:\s|$)/.test(command) && !/--(?:pre|hostname-bin)(?:[=\s]|$)/.test(command)) return true;
  return /^git\s+(?:status|diff|log|show|ls-files|ls-tree|rev-parse|ls-remote)(?:\s|$)/.test(command)
    && !/--(?:output|ext-diff|textconv|exec-path)|(?:^|\s)-c(?:\s|$)/.test(command);
}
function maintenanceCommand(command) {
  if (!nonempty(command) || /[\r\n;&|`<>$(){}]/.test(command)) return false;
  // These are configured project-owned entry points; there is no arbitrary bypass flag.
  return /^npm(?:\.cmd)?\s+run\s+(?:assess:change-impact|regress:protected|checkpoint:source|finish:iteration|manage:status|manage:refresh|ai-sldc:self-test)(?:\s|$)/.test(command)
    || /^(?:\.\\|\.\/)?scripts[\\/](?:verify_sdlc_claim_gate|update_sdlc_job_claim)\.ps1(?:\s|$)/.test(command)
    || /^(?:\.\\|\.\/)?scripts[\\/]codex_autonomous\.ps1\s+-Action\s+(?:sdlc-agent-startup|leq-refresh|cost-ledger-refresh|joulework-refresh|python-runtime-diagnostic)\s*$/.test(command);
}
function sourceFingerprint(project, files) {
  return Object.fromEntries(files.map(name => {
    const path = safePath(project.root, name);
    requireThat(!existsSync(path) || statSync(path).isFile(), 'Directory/gitlink targets require their separate project proof path; lifecycle admission currently requires exact files');
    return [name, existsSync(path) && statSync(path).isFile() ? digest(path) : null];
  }));
}
function statePath(stateDir, event, root) {
  requireThat(nonempty(event.session_id), 'Missing session identity');
  const key = createHash('sha256').update(`${event.session_id}\n${root}`).digest('hex');
  return join(stateDir, `${key}.json`);
}
function saveState(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
function reconcileState(project, state, impact, sha) {
  if (!state || state.assessment_sha256 === sha) return state;
  const sameFiles = impact.changed_files.length === Object.keys(state.before).length
    && impact.changed_files.every(name => Object.keys(state.before).some(old =>
      relative(safePath(project.root, name), safePath(project.root, old)) === ''));
  requireThat(state.work_id === impact.execution_context?.work_id && sameFiles
    && JSON.stringify(state.work_contract) === JSON.stringify(impact.work_contract)
    && state.requirements_sha256 === requirementsDigest(impact),
  'Do not substitute job, scope, or Work Contract during an open work turn');
  git(project.root, ['merge-base', '--is-ancestor', state.base_head, impact.execution_context.head]);
  return { ...state, assessment_sha256: sha }; // Preserve original before-hashes.
}
function requirementsDigest(impact) {
  return createHash('sha256').update(JSON.stringify({ packs: [...(impact.required_packs || [])].sort(),
    skills: [...(impact.required_skills || [])].sort(), outcome: impact.outcome_over_ceremony,
    pending: [...(impact.pending_external_proof || [])].sort() })).digest('hex');
}
function verifyClose(project, state, now) {
  const { root, config, policy } = project;
  const impactPath = safePath(root, config.artifacts.changeImpact);
  requireThat(digest(impactPath) === state.assessment_sha256, 'Assessment changed after the admitted edit');
  const regression = json(safePath(root, config.artifacts.protectedRegression));
  requireThat(['passed', 'passed_with_pending_external_proof'].includes(regression.status), 'Protected regression has not passed');
  requireThat(regression.change_impact_sha256 === state.assessment_sha256, 'Protected regression is for a different assessment');
  requireThat(fresh(regression.generated_at, now, policy.maxAssessmentMinutes || 60), 'Protected regression is stale');
  const claim = json(safePath(root, policy.claimGate));
  requireThat(claim.pass === true && claim.work_id === state.work_id, 'Current job claim gate has not passed');
  requireThat(fresh(claim.generated_at, now, policy.maxAssessmentMinutes || 60), 'Claim gate is stale');
  const manifestPath = safePath(root, claim.manifest_path);
  requireThat(claim.manifest_sha256 === digest(manifestPath), 'Claim manifest changed since the gate ran');
  const manifest = json(manifestPath);
  requireThat(manifest.work_id === state.work_id, 'Claim manifest belongs to another job');
  requireThat(manifest.status === 'pass' && !(manifest.blockers || []).length, 'Claim manifest is incomplete');
  requireThat(nonempty(manifest.lifecycle?.no_claim), 'Closeout requires explicit no-claim boundary');
  // Control receipts bind one another by role, not by a self-referential
  // source hash. Their exact checks above are mandatory before this exemption.
  const proofPaths = [impactPath, safePath(root, config.artifacts.protectedRegression),
    safePath(root, policy.claimGate), manifestPath];
  for (const name of manifest.lifecycle?.claim_receipts || []) {
    const path = safePath(root, name);
    requireThat(path.endsWith('.json'), 'Claim receipt copy must be JSON');
    const copy = json(path);
    requireThat(Object.entries(claim).every(([key, value]) => JSON.stringify(copy[key]) === JSON.stringify(value)),
      'Claim receipt copy differs from the current validated gate');
    requireThat(Object.keys(copy).every(key => Object.hasOwn(claim, key) || ['proof_pack', 'claim_level', 'validation_results'].includes(key)),
      'Claim receipt copy contains non-receipt fields');
    requireThat(copy.proof_pack === 'universal-claim-gate' && copy.claim_level === claim.claim_level_requested,
      'Claim receipt copy has the wrong proof role');
    requireThat(Array.isArray(copy.validation_results) && copy.validation_results.length > 0
      && copy.validation_results.every(item => item.passed === true && (!item.status || ['pass', 'passed', 'tests_passed'].includes(item.status))),
      'Claim receipt copy has missing or nonpassing result metadata');
    proofPaths.push(path);
  }
  const current = sourceFingerprint(project, Object.keys(state.before));
  for (const [name, hash] of Object.entries(current)) {
    const isBoundProof = proofPaths.some(path => relative(safePath(root, name), path) === '');
    if (hash !== state.before[name] && !isBoundProof) requireThat(manifest.lifecycle?.source_hashes?.[name] === hash,
      `Unverified current source: ${name}`);
  }
  const impact = json(impactPath);
  const applications = manifest.lifecycle?.skill_application || [];
  for (const skill of impact.required_skills) {
    const application = applications.find(x => x.skill === skill);
    const expected = impact.skill_preflight.exact_skill_paths.find(x => x.skill === skill);
    requireThat(application && application.skill_sha256 === digest(expected.path) && nonempty(application.action),
      `Skill application evidence missing/stale: ${skill}`);
    requireThat(Array.isArray(application.evidence) && application.evidence.length > 0, `No output evidence for skill: ${skill}`);
    for (const evidence of application.evidence) requireThat(digest(safePath(root, evidence.path)) === evidence.sha256,
      `Skill output evidence changed: ${skill}`);
  }
  const knowledge = manifest.lifecycle?.knowledge_update;
  requireThat(['updated', 'not_applicable'].includes(knowledge?.status) && nonempty(knowledge.reason), 'Knowledge update disposition missing');
  if (knowledge.status === 'updated') requireThat(Array.isArray(knowledge.paths) && knowledge.paths.length > 0, 'Knowledge update paths missing');
  for (const item of knowledge.paths || []) {
    const full = resolve(root, item.path);
    const allowed = [root, ...(policy.knowledgeRoots || [])].some(base => inside(realpathSync.native(base), realpathSync.native(full)));
    requireThat(allowed && digest(full) === item.sha256, 'Knowledge update hash/path is not verified');
  }
  for (const repo of [{ path: '.', remote: policy.remote || 'origin' }, ...(policy.nestedRepositories || [])]) {
    const repoRoot = safePath(root, repo.path);
    const head = git(repoRoot, ['rev-parse', 'HEAD']);
    const branch = git(repoRoot, ['branch', '--show-current']);
    requireThat(nonempty(branch), 'Checkpoint branch identity is detached');
    const remote = git(repoRoot, ['ls-remote', repo.remote, `refs/heads/${branch}`]).split(/\s/)[0];
    requireThat(remote === head, `Private checkpoint parity missing: ${repo.path}`);
  }
  // Only assess-owned files are checked: unrelated concurrent edits are preserved.
  for (const name of Object.keys(current)) requireThat(!git(root, ['status', '--porcelain', '--', name]), `Assessed source remains uncommitted: ${name}`);
}
export function handleEvent(event, { stateDir = join(homedir(), '.codex', 'ai-sldc', 'state'), now = Date.now() } = {}) {
  const eventName = event.hook_event_name;
  const input = event.tool_input || {};
  const requestedCwd = input.workdir || input.cwd || event.cwd;
  requireThat(nonempty(requestedCwd), 'Missing working directory');
  const cwd = realpathSync.native(requestedCwd);
  const project = projectAt(cwd);
  const message = project?.policy
    ? `AI.SLDC project ${project.root}. Before edits run its startup and assessed exact-file Work Contract. At completion run protected regression, current claim gate, material SDLC/Second Brain update and private checkpoint. Skills installed is not skills applied. LEQ/JouleWork are evidence-health proxies, never trading edge. Read-only questions do not require an implementation contract.`
    : 'AI.SLDC: this location is not enrolled in automatic project enforcement. Read global/project instructions; do not claim controls are active here. Enroll a project before substantive changes. No project data or transcripts are transmitted by this hook.';
  if (['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostCompact'].includes(eventName)) {
    return { hookSpecificOutput: { hookEventName: eventName, additionalContext: message } };
  }
  if (eventName === 'PreToolUse') {
    const command = typeof input === 'string' ? input : input.command ?? input.cmd ?? input.patch;
    const patch = ['apply_patch', 'Edit', 'Write'].includes(event.tool_name);
    const shell = ['Bash', 'exec_command', 'shell_command'].includes(event.tool_name);
    if (!patch && !shell) return {}; // Explicit coverage limit: no false universal-tool claim.
    if (shell && readOnlyCommand(command)) return {};
    // Do not turn a global installation into an unapproved lockdown of other projects.
    if (!project?.policy) return { hookSpecificOutput: { hookEventName: eventName, additionalContext: message } };
    try {
      requireThat(!shell || !/\bnpm(?:\.cmd)?\b.*--(?:prefix|script-shell|userconfig|globalconfig|workspace|workspaces|location|global)(?:[=\s]|$)/i.test(command), 'Npm directory/shell/config overrides are not admitted');
      if (shell && maintenanceCommand(command)) return {};
      requireThat(!shell || !/\bgit\b[^\r\n]*\b(?:push|commit|reset|clean)\b|\b(?:Set-Location|cd|chdir)\b/i.test(command), 'Use the project checkpoint/recovery entry point; raw Git writes and shell directory switches are not admitted');
      const { impact, path } = assessment(project, now);
      if (patch) for (const name of patchTargets(command)) {
        const full = safePath(project.root, resolve(cwd, name));
        const rel = relative(project.root, full).split(sep).join('/');
        requireThat(impact.changed_files.some(name => relative(safePath(project.root, name), full) === ''), `Unassessed edit: ${rel}`);
      }
      const file = statePath(stateDir, event, project.root);
      const sha = digest(path);
      const prior = existsSync(file) ? json(file) : null;
      const state = reconcileState(project, prior?.closed ? null : prior, impact, sha);
      if (!state) saveState(file, { work_id: impact.execution_context.work_id, assessment_sha256: sha,
        before: sourceFingerprint(project, impact.changed_files), opened_at: new Date(now).toISOString(), active_turn: event.turn_id,
        work_contract: impact.work_contract, base_head: impact.execution_context.head, requirements_sha256: requirementsDigest(impact) });
      else saveState(file, { ...state, active_turn: event.turn_id });
      return {};
    } catch (error) {
      return { hookSpecificOutput: { hookEventName: eventName, permissionDecision: 'deny', permissionDecisionReason: `AI.SLDC: ${error.message}. Read-only inspection and documented recovery commands remain available.` } };
    }
  }
  if (eventName === 'Stop' && project?.policy) {
    const file = statePath(stateDir, event, project.root);
    if (!existsSync(file)) return {};
    let state = json(file);
    if (state.closed || state.active_turn !== event.turn_id) return {};
    const current = sourceFingerprint(project, Object.keys(state.before));
    if (JSON.stringify(current) === JSON.stringify(state.before)) { saveState(file, { ...state, closed: true }); return {}; }
    try {
      const impactPath = safePath(project.root, project.config.artifacts.changeImpact);
      state = reconcileState(project, state, json(impactPath), digest(impactPath));
      verifyClose(project, state, now); saveState(file, { ...state, closed: true }); return {};
    }
    catch (error) {
      // Never spend indefinitely on a failing stop hook; one recovery continuation only.
      const reason = `AI.SLDC closeout incomplete: ${error.message}. Complete the existing proof/checkpoint or report PARTIAL with the precise blocker. Do not weaken a gate.`;
      if (event.stop_hook_active || state.stop_requested) return { systemMessage: reason };
      saveState(file, { ...state, stop_requested: true });
      return { decision: 'block', reason };
    }
  }
  return {};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
    const result = handleEvent(event);
    // Metadata only: never store prompt, transcript, command, tool result, or project content.
    const audit = join(homedir(), '.codex', 'ai-sldc', 'events.jsonl');
    mkdirSync(dirname(audit), { recursive: true });
    appendFileSync(audit, JSON.stringify({ at: new Date().toISOString(), event: event.hook_event_name,
      session: event.session_id, decision: result.hookSpecificOutput?.permissionDecision || result.decision || 'continue' }) + '\n');
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    if (event?.hook_event_name === 'Stop') {
      const reason = `AI.SLDC closeout unavailable: ${error.message}. Report PARTIAL and the precise error; do not retry indefinitely.`;
      process.stdout.write(JSON.stringify(event.stop_hook_active ? { systemMessage: reason } : { decision: 'block', reason }));
    } else {
    // Exit 2 is the documented blocking status; ordinary hook errors can fail open.
    process.stderr.write(`AI.SLDC hook unavailable: ${error.message}\n`);
    process.exitCode = 2;
    }
  }
}
