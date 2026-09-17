# Minimal AI.SDLC Example

Last updated: 2026-07-07

From the example project root:

```bash
ai-sdlc skills:verify
ai-sdlc init
npm run assess:change-impact -- --files README.md --applied-skill readme-writing --active-deliverable "Try the harness" --why "Prove routing" --target-surface docs --lane docs --boundary "No deployment" --proof "npm run docs:verify"
npm run regress:protected -- --files README.md
npm run finish:iteration -- --intentional-files README.md --applied-skill codebase-report --skip-git
npm run manage:refresh
ai-sdlc verify-completion --intentional-files README.md
```
