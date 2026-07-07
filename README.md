# AI.SLDC

AI.SLDC is a portable workflow harness for AI-assisted software projects. It packages the loop discipline we use in InnerKind into a reusable, config-driven command line tool:

- Work Contracts before implementation
- file-impact routing to protected regression packs
- skill preflight visibility
- separated machine proof and external/human proof
- `finish:iteration` checkpoints
- LEQ and JouleWork loop-health metrics
- human-readable `docs/status.md`, `ops/status.json`, and `ops/dashboard.html`

The harness is intentionally project-neutral. Product rules, deployment commands, provider credentials, and proof requirements belong in the consuming project `harness.config.json`.

## Install

From another machine:

```bash
git clone https://github.com/VermontForest/AI.SLDC.git
cd AI.SLDC
npm install
npm link
```

Then in a project that should use the harness:

```bash
cd /path/to/project
ai-sldc init --project-name "My Project"
```

Add scripts to the consuming project:

```json
{
  "scripts": {
    "assess:change-impact": "ai-sldc assess",
    "regress:protected": "ai-sldc regress",
    "finish:iteration": "ai-sldc finish",
    "manage:status": "ai-sldc status",
    "manage:refresh": "ai-sldc refresh",
    "manage:metrics:test": "ai-sldc self-test"
  }
}
```

## Daily Use

Start a change:

```bash
npm run assess:change-impact -- --files src/a.ts docs/b.md --active-deliverable "Ship the thing" --why "User-visible value" --target-surface app --lane full-sdlc --boundary "No production promotion" --proof "npm test" --verifier-required
```

Verify protected packs:

```bash
npm run regress:protected -- --files src/a.ts docs/b.md
```

Close the loop:

```bash
npm run finish:iteration -- --intentional-files "src/a.ts,docs/b.md" --execute --commit-message "Ship the thing"
```

Refresh the human dashboard:

```bash
npm run manage:refresh
```

Open `ops/dashboard.html`.

## File List Parsing

All file list forms are accepted:

```bash
--files src/a.ts docs/b.md
--files src/a.ts --files docs/b.md
--files "src/a.ts,docs/b.md"
```

Text flags such as `--active-deliverable`, `--why`, `--boundary`, and `--proof` collect multi-word values until the next flag.

## Configuration

The core routing file is `harness.config.json`.

- `surfaces` map file globs to risk classes, protected packs, and skills.
- `packs` define machine commands and optional external proof.
- `artifacts` can point AI.SLDC at sidecar files such as `ops/ai-sldc-status.json` during parity migration.
- `docs.required` drives documentation health.
- `metrics.thresholds` drives LEQ/JouleWork health labels.

See `templates/harness.config.example.json`.

## What Not To Commit

Do not commit live project state into this repo:

- `ops/*.latest.json`
- `ops/status.json`
- `ops/dashboard.html`
- secrets or provider tokens
- customer data
- production deployment artifacts

Commit schemas, templates, examples, and scrubbed fixtures only.

## Current Scope

This extractor pass provides a working portable CLI and templates. The next consumer pass should install AI.SLDC back into InnerKind as the first real consuming project and delete or wrap the old local harness scripts once parity is proven.
