# Testing

How to run the tests for this project.

We have two sections: [Unit Tests](#unit-tests) and [Quality Tests](#quality-tests). Might add integration tests in the future.

## Unit Tests

These tests ensure that some of the msot important code we have is working as expected. I'm not going to test every single function or aim for high coverage, since I don't believe that this sort of test-driven development actually gives me any useful information. However, if any of these break, I know that I've made a critical mistake.

Run test commands from the repository root. Node.js/npm and the installed frontend dependencies are required. Backend tests also require Docker Desktop with Docker Compose available.

To run both suites, use the following command at the main repository root:

```bash
npm run test
```

By default, this runs the frontend and backend suites concurrently.

In a non-interactive terminal, it'll print plain status lines instead of a dynamic progress bar.


To run these tests with verbose output, add the `v` keyword:

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

The standalone commands run only their named suite and return a nonzero exit status if that suite fails.

## Quality Tests

This is for stuff like linting, formatting, type checking, and dead code detection. These are here to detect "easy" issues that can be fixed quickly, in order to prevent obvious vulnerabilities or bugs from being introduced into the codebase.

Run this from the repository root:

```bash
npm run lint
```

This also supports the `v` keyword:

```bash
npm run lint -- v
```

The `fix` keyword enables automatic fixes:

```bash
npm audit fix
npm run lint:frontend -- fix
# and so on
```
