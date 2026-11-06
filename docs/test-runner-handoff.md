# Test Runner Handoff

## Scope

This is a focused handoff on the root test/lint commands, their dependency manifests, Docker test environment, and current terminal output. It is not a review of application logic. The observed test assertion failures are intentionally deferred per the user's instruction; investigate the runner/environment issues below first.

## Issues to Investigate, in Priority Order

### 1. Backend Docker image does not contain the expected venv

The current root runner invokes:

```text
docker compose --profile dev run --rm -T backend-dev /app/.venv/bin/python -m pytest /app/test -q
```

The reported error says `/app/.venv/bin/python` does not exist. The current `Dockerfile` sets `UV_PROJECT_ENVIRONMENT=/app/.venv`, runs `uv sync --frozen --no-dev`, and adds `/app/.venv/bin` to `PATH`. The likely first check is whether the image used by `compose run` predates that Dockerfile change; the runner currently does not request a build. Verify with:

```powershell
docker compose --profile dev build backend-dev
npm run test:backend
```

If it still fails after rebuilding, inspect the built image's venv creation and the resolved Compose service/image. Do not replace the container Python command with host Python.

### 2. Progress display appends a new full snapshot every second

`scripts/run-tests.mjs` deliberately avoids cursor-up/clear-line ANSI sequences, but `refreshBars()` appends both status rows every second. This preserves scrollback at the cost of flooding the terminal. It also appends repeated failed/passed rows after a suite completes, refreshes statuses on close and again at the end, and prints a second summary. Child chunks are prefixed individually, so a chunk boundary can split a logical output line and repeat `[frontend]` mid-line.

Replace this with a terminal strategy tested in Windows PowerShell that:

- Keeps progress in a dedicated status area without clearing or rewriting prior command history.
- Streams child output in readable lines (including carriage-return progress where practical).
- Does not redraw completed suite statuses on every tick or print duplicate final statuses.
- Has a sensible non-TTY fallback (plain streamed output plus one final result per suite).

If stable simultaneous bars cannot coexist reliably with streamed output in the target terminal, prioritize readable streaming and one concise status update per state change over a screen full of animated snapshots.

### 3. Frontend test dependencies span two npm installations

The root `package-lock.json` resolves React and ReactDOM `19.3.1` as peers of root-level test tooling, while `frontend/package-lock.json` resolves React and ReactDOM `18.3.1`. The frontend source is in the `frontend` package, but its test command resolves `@testing-library/react` through the root package installation. This split is a plausible cause of the reported “React Element from an older version” message. The failing assertion itself is deferred; when addressed, place test tooling and React peer dependencies in one coherent package/install tree and regenerate only the relevant lockfile(s).

### 4. Bun and npm lockfiles disagree

`frontend/bun.lock` records Vite `5.0.0` and `@vitejs/plugin-react` `4.2.0`, while `frontend/package.json` and the npm lockfile use Vite `8.3.6` and plugin `6.2.1`. Decide whether Bun is supported; if yes, reconcile the Bun lock with the manifest. Otherwise document npm as canonical and avoid using the stale Bun lock. Do not migrate the test framework to `bun test` as part of the runner repair: the frontend currently uses Vitest/Vite, and backend tests remain pytest in Docker.

### 5. Testing documentation is stale about root lint

Root `package.json` now defines `lint` as `npm --prefix frontend run lint`, but `docs/testing.md` still says lint is not defined at the repository root. Update that statement and show the root invocation, or clearly distinguish it from the frontend-scoped equivalent. Separately verify the existing Python lint script: `frontend/package.json` invokes `uv run ruff check ..`, while Ruff was not present in the inspected `pyproject.toml` dependency declarations.

## Current Commands and Files

- `npm test` — concurrent root runner: frontend Vitest and Docker-backed pytest.
- `npm run test:frontend` / `npm run test:backend` — standalone suite commands.
- `npm run lint` — delegates to the frontend lint script.
- Runner: `scripts/run-tests.mjs`.
- Docker env: `Dockerfile`; one-off service and read-only `/app/test` mount: `docker-compose.override.yml`.
- Frontend test config: `frontend/vite.config.js`; current smoke test: `frontend/test/App.test.jsx`.

## Acceptance Checks for Follow-up

- [ ] Backend-only command succeeds in a freshly built image and demonstrably uses `/app/.venv/bin/python`.
- [ ] Combined and standalone commands behave correctly in Windows PowerShell.
- [ ] Live output remains readable, with no scrollback deletion, unbounded repeated progress snapshots, or duplicate final suite statuses.
- [ ] Non-TTY output and aggregate exit status remain correct.
- [ ] Test dependency resolution uses one compatible React/ReactDOM version for app and renderer.
- [ ] Docs and lockfile policy agree with actual root commands and package manifests.
