# Local GitHub Actions parity

## Purpose

Before a release-candidate push, run the same `quality` and `web-acceptance` jobs defined in `.github/workflows/verify.yml` locally. The runner is Linux Docker via `act`; it creates a temporary LF Git clone from the committed candidate and binds that clone into the job container. Linux `npm ci` output never contaminates the Windows workspace, Git metadata remains available to the workflow, and CRLF cannot create a false `git diff --check` failure.

GitHub remains the release authority because it is the hosted runner and publishes immutable release images. This gate catches clean-install, workspace resolution, PostgreSQL-service, and browser-acceptance faults before the remote run.

## Commands

Install once on Windows:

```powershell
winget install --id nektos.act --exact --source winget
```

Run only the fast quality gate after an API/dependency/CI change:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-ci-parity.ps1 -Job quality
```

Run the browser gate after a web or Playwright change:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-ci-parity.ps1 -Job web-acceptance
```

Run both sequentially for a release candidate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-ci-parity.ps1 -Job all
```

## When it is mandatory

- Before pushing a release candidate.
- After changing `package.json`, `package-lock.json`, a workspace export, `.github/workflows/verify.yml`, Docker files, Prisma tooling, or test-runner configuration.
- After repairing a failure that appeared only in GitHub Actions.

For a small isolated UI or domain change, run its targeted test first; do not rerun the full 20+ minute browser suite unless its impact reaches the trigger list above. Commit the release candidate, run this gate, then push only if it passes. The final GitHub run still must be green before release images can be accepted.
