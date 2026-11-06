# Testing

How to run the tests for this project.

We have two sections: [Unit Tests](#unit-tests) and [Quality Tests](#quality-tests). Might add integration tests in the future.

## Unit Tests

These tests ensure that some of the msot important code we have is working as expected. I'm not going to test every single function or aim for high coverage, since I don't believe that this sort of test-driven development actually gives me any useful information. However, if any of these break, I know that I've made a critical mistake.

Run test commands from the repository root. Node.js/npm and the installed
frontend dependencies are required. Backend tests also require Docker Desktop
with Docker Compose available.

To run both suites, use the following command:

```bash
npm run test
```

By default, this runs the frontend and backend suites concurrently with a
loading bar and a concise percentage summary. The backend suite runs in Docker
using `/app/.venv/bin/python`; the repository's `test/` directory is mounted
read-only at `/app/test`. A failure in either suite makes the combined command
exit nonzero. To see full test output, add the `v` keyword:

```bash
npm run test -- v
```

Ensure there is a space between `--` and `v`.

To run only the backend tests, use:

```bash
npm run test:backend
```

This starts a one-off Docker Compose container to run the backend tests.

To run only the frontend tests, use:

```bash
npm run test:frontend
```

The standalone commands run only their named suite and return a nonzero exit
status if that suite fails.

## Quality Tests

This is for stuff like linting, formatting, type checking, and dead code detection. These are here to detect "easy" issues that can be fixed quickly, in order to prevent obvious vulnerabilities or bugs from being introduced into the codebase.

The root lint command delegates to the frontend lint script. Run it from the
repository root:

```bash
npm run lint
```

By default, this shows a loading bar and a concise percentage summary. To see
the full build, audit, and Ruff output, add the `v` keyword:

```bash
npm run lint -- v
```

Ensure there is a space between `--` and `v`. Lint includes the frontend build
and audit checks, followed by Ruff checks for the repository's Python code. The
`fix` keyword enables automatic fixes: `npm audit fix` (without `--force`) and
Ruff's `--fix --unsafe-fixes`. Unsafe Ruff fixes may change runtime behavior;
review the changes and run tests afterward. Use `npm run lint -- fix`; include both keywords as
`npm run lint -- fix v` to see detailed output while fixes run. Ensure there is
a space between `--` and `fix` (and between `fix` and `v`). The
equivalent frontend-scoped command is `npm --prefix frontend run lint` (runs
with full output). npm is the canonical frontend package manager; install
frontend dependencies from `frontend/package-lock.json`. The legacy Bun lockfile
is not maintained.
