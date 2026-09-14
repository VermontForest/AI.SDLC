import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleEvent, digest, readOnlyCommand } from './codex-hooks.mjs';

const stamp = () => new Date().toISOString();
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ai-sdlc-hook-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-b', 'codex/test');
  git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  const write = (p, v) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), typeof v === 'string' ? v : JSON.stringify(v)); };
  write('source.txt', 'before'); git('add', 'source.txt'); git('commit', '-m', 'fixture');
  const config = { artifacts: { changeImpact: 'evidence/impact.json', protectedRegression: 'evidence/regress.json' },
    lifecycle: { schema_version: 1, claimGate: 'evidence/gate.json', maxAssessmentMinutes: 60,
      metrics: ['evidence/leq.json', 'evidence/jw.json'] } };
  write('harness.config.json', config);
  for (const name of ['leq', 'jw']) write(`evidence/${name}.json`, { generated_at: stamp(), status: 'unknown' });
  const impact = { status: 'packs_required', generated_at: stamp(), execution_context: { root, head: git('rev-parse', 'HEAD'), work_id: 'TEST-1' },
    required_skills: [], skill_preflight: { available_count: 0, missing_count: 0, exact_skill_paths: [] },
    changed_files: ['source.txt'], work_contract: { verifier_required: true }, outcome_over_ceremony: { status: 'passed' } };
  write('evidence/impact.json', impact);
  const stateDir = join(root, '.local-state');
  const invoke = (extra = {}) => handleEvent({ session_id: 'session', turn_id: 'turn', cwd: root,
    hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: source.txt\n@@\n-before\n+after\n*** End Patch' }, ...extra }, { stateDir });
  const deny = result => assert.equal(result.hookSpecificOutput?.permissionDecision, 'deny');
  return { root, git, write, config, impact, invoke, deny, stateDir };
}
test('current exact-file edit is admitted; no project source is modified by the hook', () => {
  const f = fixture(); assert.deepEqual(f.invoke(), {}); assert.equal(readFileSync(join(f.root, 'source.txt'), 'utf8'), 'before');
});
test('missing assessment denies an otherwise identical edit', () => {
  const f = fixture(); f.config.artifacts.changeImpact = 'missing.json'; f.write('harness.config.json', f.config); f.deny(f.invoke());
});
test('stale assessment fails', () => {
  const f = fixture(); f.impact.generated_at = '2000-01-01T00:00:00Z'; f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('future assessment fails', () => {
  const f = fixture(); f.impact.generated_at = '2099-01-01T00:00:00Z'; f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('wrong checkout and wrong revision fail', () => {
  const f = fixture(); f.impact.execution_context.head = '0'.repeat(40); f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
  f.impact.execution_context.head = f.git('rev-parse', 'HEAD'); f.impact.execution_context.root = tmpdir(); f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('out-of-scope path and traversal fail', () => {
  const f = fixture(); for (const p of ['other.txt', '../escape.txt']) f.deny(f.invoke({ tool_input: { command: `*** Begin Patch\n*** Add File: ${p}\n+bad\n*** End Patch` } }));
});
test('delete and move fail', () => {
  const f = fixture(); for (const command of ['*** Begin Patch\n*** Delete File: source.txt\n*** End Patch', '*** Begin Patch\n*** Update File: source.txt\n*** Move to: other.txt\n*** End Patch']) f.deny(f.invoke({ tool_input: { command } }));
});
test('stale metrics block while fresh unknown/blocked metrics never become green scores', () => {
  const f = fixture(); f.write('evidence/leq.json', { generated_at: '2000-01-01' }); f.deny(f.invoke());
  f.write('evidence/leq.json', { generated_at: stamp(), status: 'blocked', score: 0 }); assert.deepEqual(f.invoke(), {});
});
test('missing skills and verifier fail', () => {
  const f = fixture(); f.impact.skill_preflight.missing_count = 1; f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
  f.impact.skill_preflight.missing_count = 0; f.impact.work_contract.verifier_required = false; f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('read-only commands and narrow recovery remain usable without admitted assessment', () => {
  const f = fixture(); f.impact.status = 'blocked'; f.write('evidence/impact.json', f.impact);
  for (const command of ['git status --short', 'Get-Content AGENTS.md', 'npm run assess:change-impact -- --files source.txt'])
    assert.deepEqual(f.invoke({ tool_name: 'Bash', tool_input: { command } }), {});
});
test('read grammar refuses shell injection and rg preprocessor escape', () => {
  for (const c of ['Get-Content x; git push', 'git diff --output=x', 'rg --pre=evil x', 'Get-Content $(evil)', 'rg x | evil', 'Get-Content (Set-Content source.txt changed)']) assert.equal(readOnlyCommand(c), false, c);
});
test('raw Git writes and directory switch fail even with assessment', () => {
  const f = fixture(); for (const command of ['git push origin HEAD', 'git commit -am x', 'git -C . commit -am x', 'git --git-dir=.git push', 'powershell -Command "git push"', 'cd ..', 'npm run manage:status --prefix ../other', 'npm run manage:status --script-shell evil'])
    f.deny(f.invoke({ tool_name: 'Bash', tool_input: { command } }));
});
test('startup/resume/compaction get bounded local guidance', () => {
  const f = fixture(); for (const name of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostCompact']) {
    const r = f.invoke({ hook_event_name: name }); assert.equal(r.hookSpecificOutput.hookEventName, name);
    assert.match(r.hookSpecificOutput.additionalContext, /Skills installed is not skills applied/);
  }
});
test('plain questions and failed/no-op edits do not force a completion loop', () => {
  const f = fixture(); assert.deepEqual(f.invoke({ hook_event_name: 'Stop' }), {}); f.invoke(); assert.deepEqual(f.invoke({ hook_event_name: 'Stop' }), {});
});
test('incomplete changed-source closeout requests only one continuation', () => {
  const f = fixture(); assert.deepEqual(f.invoke(), {}); f.write('source.txt', 'after');
  assert.equal(f.invoke({ hook_event_name: 'Stop' }).decision, 'block');
  const r = f.invoke({ hook_event_name: 'Stop', stop_hook_active: true }); assert.equal(r.decision, undefined); assert.match(r.systemMessage, /incomplete/);
});
test('real CLI Stop errors cannot bypass the one-continuation bound', () => {
  const f = fixture();
  for (const alreadyContinued of [false, true]) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./codex-hooks.mjs', import.meta.url))], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'fixture', turn_id: 'turn',
        cwd: join(f.root, 'missing'), stop_hook_active: alreadyContinued }), encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assert.equal(result.decision, alreadyContinued ? undefined : 'block');
  }
});
test('assessment substitution fails', () => {
  const f = fixture(); f.invoke(); f.impact.changed_files.push('extra.txt'); f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('no-op work closes its state and permits a new assessment', () => {
  const f = fixture(); assert.deepEqual(f.invoke(), {}); assert.deepEqual(f.invoke({ hook_event_name: 'Stop' }), {});
  f.impact.changed_files.push('new.txt'); f.write('evidence/impact.json', f.impact);
  assert.deepEqual(f.invoke({ turn_id: 'next' }), {});
});
test('same-job exact-contract refresh preserves original before-hashes', () => {
  const f = fixture(); assert.deepEqual(f.invoke(), {}); f.write('source.txt', 'after');
  f.impact.generated_at = new Date(Date.now() + 1000).toISOString(); f.write('evidence/impact.json', f.impact);
  assert.deepEqual(f.invoke(), {});
  assert.equal(f.invoke({ hook_event_name: 'Stop' }).decision, 'block');
});
test('assessment renewal cannot remove required skills or packs', () => {
  const f = fixture(); f.impact.required_packs = ['real-tests']; f.write('evidence/impact.json', f.impact);
  assert.deepEqual(f.invoke(), {}); f.impact.required_packs = []; f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('Windows filename casing is not a different edit scope', { skip: process.platform !== 'win32' }, () => {
  const f = fixture(); f.impact.changed_files = ['SOURCE.TXT']; f.write('evidence/impact.json', f.impact);
  assert.deepEqual(f.invoke(), {});
});
test('directory or gitlink target cannot be treated as an unchanged missing file', () => {
  const f = fixture(); mkdirSync(join(f.root, 'component')); f.impact.changed_files.push('component');
  f.write('evidence/impact.json', f.impact); f.deny(f.invoke());
});
test('unregistered project is disclosed, never falsely called enforced', () => {
  const f = fixture(); delete f.config.lifecycle; f.write('harness.config.json', f.config);
  assert.match(f.invoke().hookSpecificOutput.additionalContext, /not enrolled/);
});
test('complete evidence + real Git remote parity closes the actual changed source', () => {
  const f = fixture();
  f.impact.changed_files.push('evidence/impact.json', 'evidence/regress.json',
    'evidence/manifest.json', 'evidence/gate.json', 'evidence/claim-copy.json');
  f.write('skills/test-skill/SKILL.md', 'Fixture skill');
  f.write('evidence/skill-output.json', { result: 'fixture output, not reasoning proof' });
  f.impact.required_skills = ['test-skill'];
  f.impact.skill_preflight = { available_count: 1, missing_count: 0,
    exact_skill_paths: [{ skill: 'test-skill', path: join(f.root, 'skills/test-skill/SKILL.md') }] };
  f.write('evidence/impact.json', f.impact);
  assert.deepEqual(f.invoke(), {}); f.write('source.txt', 'after');
  const impactHash = digest(join(f.root, 'evidence/impact.json'));
  f.write('evidence/regress.json', { status: 'passed', generated_at: stamp(), change_impact_sha256: impactHash });
  f.write('evidence/manifest.json', { work_id: 'TEST-1', status: 'pass', blockers: [], lifecycle: { no_claim: 'Fixture proves mechanics only',
    source_hashes: { 'source.txt': digest(join(f.root, 'source.txt')) }, claim_receipts: ['evidence/claim-copy.json'],
    skill_application: [{ skill: 'test-skill', skill_sha256: digest(join(f.root, 'skills/test-skill/SKILL.md')),
      action: 'Exercise fixture skill evidence validation', evidence: [{ path: 'evidence/skill-output.json', sha256: digest(join(f.root, 'evidence/skill-output.json')) }] }],
    knowledge_update: { status: 'not_applicable', reason: 'Isolated test fixture with no operator knowledge change' } } });
  const gate = { pass: true, generated_at: stamp(), work_id: 'TEST-1', claim_level_requested: 'tests_passed', manifest_path: 'evidence/manifest.json', manifest_sha256: digest(join(f.root, 'evidence/manifest.json')) };
  f.write('evidence/gate.json', gate);
  f.write('evidence/claim-copy.json', { ...gate, proof_pack: 'universal-claim-gate', claim_level: 'tests_passed', validation_results: [{ passed: true }] });
  const remote = mkdtempSync(join(tmpdir(), 'ai-sdlc-hook-remote-'));
  assert.equal(spawnSync('git', ['init', '--bare', remote], { windowsHide: true }).status, 0);
  f.git('remote', 'add', 'origin', remote); f.git('add', 'source.txt', 'evidence'); f.git('commit', '-m', 'changed'); f.git('push', 'origin', 'HEAD');
  const originalManifest = readFileSync(join(f.root, 'evidence/manifest.json'), 'utf8');
  f.write('evidence/manifest.json', originalManifest + ' ');
  assert.match(f.invoke({ hook_event_name: 'Stop' }).reason, /manifest changed/);
  f.write('evidence/manifest.json', originalManifest);
  const originalOutput = readFileSync(join(f.root, 'evidence/skill-output.json'), 'utf8');
  f.write('evidence/skill-output.json', '{}');
  assert.match(f.invoke({ hook_event_name: 'Stop' }).systemMessage, /Skill output evidence changed/);
  f.write('evidence/skill-output.json', originalOutput);
  const originalCopy = readFileSync(join(f.root, 'evidence/claim-copy.json'), 'utf8');
  f.write('evidence/claim-copy.json', { ...gate, manifest_sha256: '0'.repeat(64) });
  assert.match(f.invoke({ hook_event_name: 'Stop' }).systemMessage, /receipt copy differs/);
  f.write('evidence/claim-copy.json', { ...JSON.parse(originalCopy), validation_results: [{ passed: false }] });
  assert.match(f.invoke({ hook_event_name: 'Stop' }).systemMessage, /nonpassing result metadata/);
  f.write('evidence/claim-copy.json', { ...JSON.parse(originalCopy), constructor: 'not receipt metadata' });
  assert.match(f.invoke({ hook_event_name: 'Stop' }).systemMessage, /non-receipt fields/);
  f.write('evidence/claim-copy.json', originalCopy);
  assert.deepEqual(f.invoke({ hook_event_name: 'Stop' }), {});
});
