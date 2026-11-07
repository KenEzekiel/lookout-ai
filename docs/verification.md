# Verify a change

Run `pnpm install --frozen-lockfile`.
Run `pnpm verify` before opening a PR. CI runs the same command on every PR to `main`.

- `pnpm check` runs Oxfmt, Oxlint, the comment ban, strict TypeScript, dependency-cruiser, workspace tests, and Oracle disclosure checks.
- `pnpm test` runs Vitest UI integration tests with React Testing Library and jsdom, plus Oracle tests.
- `pnpm build` checks the production client and Worker bundles.
- `pnpm qa:browser` runs optional browser smoke tests for manual QA of the production build. Install Chromium first with `pnpm exec playwright install chromium`.
- `python3 scripts/check-harness.py` validates the repository's agent tooling.

Playwright is outside CI. Use it to check layout, browser behavior, and hydration after changing a user journey.
Its repeatable smoke tests supplement interactive manual QA. It owns its preview server on port 4173 and refuses to reuse an existing process.
Focused tests fail even locally. Retries are disabled so intermittent failures stay visible.
Local browser QA retains traces and screenshots after failures. Open traces with `pnpm exec playwright show-trace <path>`.

## Place code at its boundary

Keep route composition and server-function adapters in `apps/app/src/routes`.
Keep reusable UI in `components`, environment-independent shared code in `lib`, and persistence and external-service adapters in `server`.
Create these directories only when a feature needs them.

Dependency-cruiser rejects cycles, unresolved imports, undeclared packages, and production imports of tests.
The generated route tree is exempt from cycle checks because TanStack generates a type reference back to the router.
It also rejects imports from `lib` into routes, components, or server code, from components into routes or server code, and from server code into routes or components.
Cloudflare bindings belong in `server`. Route adapters must access server code only through TanStack Start server handlers.
The import graph cannot prove that an import is used only inside a server handler. Check that boundary when reviewing route changes.

The root TypeScript 6 dependency supports dependency-cruiser's parser. The app retains its TypeScript 7 compiler.
Do not upgrade the root compiler until dependency-cruiser supports its parser API. The check fails if the parser scans zero modules.

## Write behavior tests

Use integration or end-to-end tests. Do not add unit tests, shallow component tests, or tests of private helpers.
Put automated UI integration tests in `apps/app/tests/integration/*.test.tsx`. Render complete screens with real routing and application components.
Use React Testing Library role-based queries and user-event for interactions.
The current app has no interactive controls, so its initial tests cover the home route and the not-found screen.
Add API integration tests in the real server runtime when endpoints arrive. Do not run Worker database tests inside jsdom.

For each changed behavior, cover its successful result and its important failure or permission boundary.
Assert observable responses, rendered UI, or persisted state. Avoid snapshots of implementation details.
Use asynchronous Testing Library queries to wait for visible results. Do not use fixed sleeps, skipped tests, or focused tests in committed changes.

UI integration tests may mock our backend API and external services at the HTTP boundary with MSW.
Import `server` from `tests/support/server` and register per-test handlers with `server.use(...)`.
The shared setup rejects unhandled HTTP requests and resets handlers and the rendered DOM after each test.
API integration tests must exercise real handlers, application logic, repositories, and a temporary database. Only external services may be mocked in those tests.
Never mock internal modules, components, or hooks. Oxlint rejects imports of Vitest's `vi` and `vitest` mocking APIs in the integration suite, along with focused and skipped Vitest tests. Cover success, loading, empty, and error states when a feature exposes them.
Do not require production credentials or paid API calls in CI. These semantic test rules require review; static import checks cannot establish whether a test covers a useful behavior.

## Add persistence tests with the first database feature

The application currently has no database or API endpoints. There is no database integration coverage yet.
The PR that introduces persistence must add a temporary database fixture using the production database engine and real migrations.
Allocate a unique database or namespace per worker, seed only that test's records, and clean up in teardown even after failures.
For D1, use an isolated local Worker binding. For Postgres, use a disposable container or CI service database with isolated schemas.
Never point tests at development or production databases. A mocked repository or SQLite replacement for Postgres does not satisfy this rule.
Exercise writes through the real endpoint, read the result back, and cover invalid input and unauthorized access.

## Keep explanations outside code

Comments are forbidden in maintained code. Tests may contain comments.
The parser-based check covers JavaScript, TypeScript, JSX, TSX, CSS, JSONC, and Python.
It allows comment-like text inside strings and executable Python shebangs.
Generated route trees, generated Worker types, `.agents`, and vendored code are excluded.
Keep rationale in documentation and use names to explain code. Do not add lint or typecheck suppression comments.
When adding a new source language, extend the comment checker in the same PR.

## Review and merge

The `verify` job checks the current app's UI integration tests and production build. Extend coverage as features arrive.
Passing checks reduce risk but do not prove the absence of regressions.
Keep PRs small and include the behavior changed, tests run, and remaining gaps in the PR description.
Require the `verify` status check in GitHub's main-branch rules before relying on it as a merge gate.
The workflow itself does not configure branch protection. The user's explicit merge confirmation remains required.

For the hackathon, prioritize a real login and primary demo journey, cross-user access denial, and provider-failure recovery as those features arrive.
Defer coverage percentages, mutation testing, large browser matrices, and broad dependency upgrades until the demo works.
