# Approved routing change: 2026-11-14

Carl explicitly directed removal of the five unavailable mandatory skill requests blocking the Use Cases release: planning-workflow, readme-writing, testing-real-service-e2e-no-mocks, reality-check-for-project, and codebase-report.

The repository routing configuration and generated default configuration no longer request these five methods. Empty method lists are explicit. The repository validator accepts an empty routed list rather than requiring at least one method in every stage. Configured methods still require genuine package presence and truthful stage attestations.

This change does not remove the official dependency lock, dependency integrity verification, Assess work contracts, protected test packs, Finish evidence, completion verification, LEQ, JouleWork, external proof, GitHub protections, or production approval. Therefore this change alone does not guarantee that completion or release passes. Existing consumer-specific configurations are not silently rewritten.

Rollback: restore the three changed routing/validator files from commit 358c361. No claim is made that any removed skill was applied.
