# Test And Release Plan

Last updated: 2026-11-14

## What still blocks

Run the project test command. For this harness:

```bash
npm test
```

GitHub runs that command in the `validate` job and in four jobs for Ubuntu and
Windows with Node 22 and Node 24. A skipped test command, or a test command
that exits with an error, still fails.

## What was retired on 2026-11-14

Carl Weiss retired these blocking checks:

- the full skill-package lock (`ai-sdlc skills:verify` warns and exits
  successfully);
- required skill-method attestations on Assess, Regress, and Finish;
- stale LEQ and JouleWork scores;
- approval records and completion paperwork, including
  `ai-sdlc verify-completion`.

The commands remain. They report warnings. They do not block a commit, merge,
or deploy. Historical records stay in the repository.
