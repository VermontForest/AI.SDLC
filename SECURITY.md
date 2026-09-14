# Security Policy

## Supported versions

Security fixes are accepted against the default branch (`main`) of this repository.

## Reporting a vulnerability

Do not open a public GitHub issue for security problems or leaked secrets.

Email **carl@vermontforest.com** with:

- a short description of the issue
- steps to reproduce, or a proof of concept if available
- affected files, commits, or release tags if known

You should receive an acknowledgment within a few business days. Please give a reasonable window for a fix before any public disclosure.

## Scope notes

- This harness coordinates project-declared checks. It is not a sandbox, authorization service, or complete security boundary for shell or patch tools.
- Do not commit secrets, provider tokens, `.env` files, or premium Jeffrey Skills (`JSM`) skill bodies into this repository.
- Rolling ops artifacts under `ops/` and generated status files are intentionally untracked.
