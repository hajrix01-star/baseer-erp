# CI latency — BASEER-ARCH v1.0

- Classification: ARCHITECTURAL (CI scheduling); base/lastVerifiedCommit: `78673b512e0e8b0172d00b01a6635268a48602bb`.
- Owner: Alpha build / operations. Independent reviewer: ci_gate_review.
- G0: reduce GitHub merge waiting without dropping tests or weakening release provenance. Application, permissions, financial logic, data, deployment credentials and dependency versions are out of scope.
- G1: run 34054352319 measured quality 9m11s and web acceptance 10m04s; release run 34049609849 measured approximately 3m41s. User's 20-minute experience may include queues/retries; not reproduced as a single successful recent run. Target PR gate approximately 5–6 minutes, to be measured, not guaranteed. Three browser runners with two workers each add installation overhead/billable runner time; DB verifications stay sequential on one restricted database.
- G2 decision: PR -> quality (build once, same verification entrypoints) + three isolated Playwright shards -> stable fail-closed web-acceptance gate. Existing accepted-PR -> exact-main preflight -> three immutable images -> manifest -> constrained production deployment remains unchanged. No cross-run compiled-output cache. Superseded PR shards cancel independently; failures/cancellations/skips cannot pass the aggregate.
- G3: existing Node24, npm lockfile, GitHub Actions matrix and Playwright native sharding; no new libraries. Keep local npm wrappers building from source. Use fullyParallel already enabled; preserve both browser projects, all tests, screenshots/traces and unique shard artifacts.
- Direct-path alternatives: no path-based test skipping, no removed financial/auth checks, no extra retries, no dependency or infrastructure upgrade.
- Evidence plan: exact wrapper equivalence, workflow contract positive/negative tests, shard test-list union/disjointness, full GitHub run timing, independent diff review. Rollback: revert this CI-only change; no data restoration required.
- Sources: https://playwright.dev/docs/test-sharding and https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax (matrix, needs and always).

## Live log

- Discovery: reused registry and isolated a clean main worktree to preserve concurrent root edits. Read workflow, package scripts, Playwright config and release verifier; fetched job/step timings and checked branch protection (classic endpoint reports branch not protected). No protection settings changed.
- G0–G3: design submitted to independent gate review before workflow edits.
- G0–G3 independently accepted for implementation with the condition to preserve local CI parity. Implemented explicit sequential local shard executions; hosted shards remain isolated/parallel.
- G5–G7: five wrapper-equivalence checks passed; provenance contract passed; six in-memory unsafe workflow mutations were rejected (missing always, non-checking gate, missing shard, fail-fast, wrong denominator, colliding artifacts). PowerShell parser passed and reviewer verified shard argument expansion.
- Playwright collection at this candidate: 674 tests total, partitioned 225/225/224; exact union equals unsharded suite and no duplicate test identities. No tests deleted, filtered or disabled.
- Independent final diff review by ci_gate_review found no blockers: same DB sequence/entrypoints, unchanged release jobs and permissions, fail-closed aggregate and isolated evidence. Full GitHub execution/timing pending; no runtime-capacity or production behavior claims from local collection alone.
