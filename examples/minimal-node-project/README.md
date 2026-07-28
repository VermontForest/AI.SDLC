# Minimal AI.SLDC Example

Last updated: 2026-07-07

From the example project root:

```bash
ai-sldc init
npm run assess:change-impact -- --files README.md --applied-skill readme-writing --active-deliverable "Try the harness" --why "Prove routing" --target-surface docs --lane docs --proof "npm run docs:verify"
npm run regress:protected -- --files README.md
npm run finish:iteration -- --intentional-files README.md --applied-skill codebase-report --skip-git
npm run manage:refresh
```
