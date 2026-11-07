# Verify a change

Identify affected codes in the [feature map](features/README.md), including consumers of changed contracts. Verify their required wiring and regression cases, and update the affected records in the same PR. `pnpm check:features` validates record structure and references and runs checker integration tests. It cannot establish behavior or completeness.

Run `pnpm install --frozen-lockfile`.
Run `pnpm verify` before opening a PR. CI runs the same command on every PR to `main`.

- `pnpm check` runs Oxfmt, Oxlint, the comment ban, strict TypeScript, dependency-cruiser, and workspace tests.
- `pnpm test` runs Vitest UI integration tests with React Testing Library and jsdom, plus Oracle tests.
- `pnpm build` checks the production client and Worker bundles.
- `pnpm --filter @lookout/app test:api` runs API integration tests against that build. `pnpm verify` runs this after building.
- `pnpm qa:browser` runs optional browser smoke tests for manual QA of the production build. Install Chromium first with `pnpm exec playwright install chromium`.
- `python3 scripts/check-harness.py` validates the repository's agent tooling.

Playwright is outside CI. Manual browser verification is required for frontend feature implementations and frontend bug fixes that affect a user journey.
Its repeatable smoke and access-journey tests supplement interactive manual QA. It owns a local HTTP server on port 4173 and refuses to reuse an existing process. `apps/app/tests/support/browser-server.mjs` forwards requests to the built Worker through Wrangler’s test harness, applies real migrations to isolated D1 storage, and generates an ephemeral auth secret. It does not use the development database.
Focused tests fail even locally. Retries are disabled so intermittent failures stay visible.
Local browser QA retains traces and screenshots after failures. Open traces with `pnpm exec playwright show-trace <path>`.

## Verify frontend user journeys

The implementation agent performs this check before marking the work complete or opening a ready PR. A separate QA agent is not required.
Documentation-only changes and backend-only changes do not require browser QA. A frontend change affects a journey when it changes what a user sees, enters, navigates, or can complete, including layout or shared component changes in that flow.

1. Identify the affected journey and its expected outcome. For a bug fix, reproduce the reported failure in the browser before editing when possible. If reproduction is unavailable, record why and use the reported steps for post-fix verification.
2. Run the current production build locally and exercise it in a real browser with Playwright or a browser-control tool permitted by the host. If the production runtime is unavailable, identify the runtime used and the resulting verification gap.
3. Complete the changed flow through its visible controls. Check the successful outcome and the relevant error or recovery path. Inspect loading, empty, validation, and permission states when the change affects them. For a bug fix, repeat the original failing steps and a nearby successful path.
4. Inspect the rendered result, browser console errors, and failed requests. Check keyboard interaction and narrow-screen layout when the changed flow supports them. Fix failures caused by the change and rerun the affected steps.
5. Add a manual QA section to the PR description with the build or commit tested, runtime, journey steps, expected and observed results, and any mocked services or remaining gaps. Use short bullets under Setup, Steps and results, Evidence, and Gaps and blockers, as shown in the PR template. Give each action or scenario its own bullet with the expected and observed result. Keep automated coverage separate from manually exercised steps. Embed screenshots captured during that manual QA run, with captions identifying the step or state and observed result. Cover the changed flow and its relevant success, error, or recovery states.
6. Add a short demo video when screenshots cannot adequately show the behavior, such as a multi-step interaction, animation, or timing issue. Embed or link the recording in the PR description and explain what it demonstrates. Traces may supplement this evidence.

Keep QA screenshots, videos, traces, and reports outside version control. Capture them in ignored `test-results/` or a temporary directory. Do not commit QA media under `docs/qa` or elsewhere, and do not use raw repository URLs as evidence hosting. Product assets and intentional test fixtures are separate from QA evidence.

Upload images and videos as GitHub PR attachments and embed their returned URLs in the description. Check `gh pr edit --help` for `--attach` support before using the CLI. A supported version can upload local images referenced in a body file and replace their paths with attachment URLs:

```sh
gh pr edit <number> --body-file /tmp/pr-body.md --attach /absolute/path/to/test-results/screen.png
```

Use the same absolute image path in the body Markdown and the attachment argument. The authenticated GitHub description editor also supports drag-and-drop uploads. Preserve captions, the tested revision, and the observed results. For existing evidence, upload and verify the attachments before deleting repository copies, then update all documentation links. Keep lasting verification instructions and feature records in the repository; put per-run observations and media in the PR.

Verify every uploaded media URL opens and returns the expected media type, and inspect the saved PR body for attachment links and remaining local or raw repository references. A partial CLI upload can update the description even when the command exits unsuccessfully; inspect the saved body before retrying failed files. Local filesystem paths and screenshots kept only in chat do not satisfy this requirement. If capture or upload is blocked, report the exact gap and keep the PR in draft under the verification rule below. Do not commit media as a fallback. `scripts/check-harness.py` rejects QA media under `docs/qa`; review the staged diff for evidence saved elsewhere.

Use safe test data and identify any HTTP mocks in the evidence. Do not claim to have verified an integration that was mocked.
Vitest results, a successful build, and `pnpm qa:browser` alone do not satisfy journey verification. The generic smoke suite does not exercise a newly implemented flow.
If browser tools, credentials, or services prevent verification, report the exact blocker and keep the PR in draft. Do not claim completion or silently waive the requirement. The user may explicitly waive a documented verification gap.

## Place code at its boundary

Keep route composition and server-function adapters in `apps/app/src/routes`.
Keep reusable UI in `components`, environment-independent shared code in `lib`, and persistence and external-service adapters in `server`.
Create these directories only when a feature needs them.

Dependency-cruiser rejects cycles, unresolved imports, undeclared packages, and production imports of tests.
The generated route tree is exempt from cycle checks because TanStack generates a type reference back to the router.
It also rejects imports from `lib` into routes, components, or server code, from components into routes or server code, and from server code into routes or components.
Cloudflare bindings belong in `server`. Route adapters must access server code only through TanStack Start server handlers.
The resolver recognizes the runtime-provided `cloudflare:workers` module explicitly; the separate server-only binding rule still rejects imports outside `server`.
The import graph cannot prove that an import is used only inside a server handler. Check that boundary when reviewing route changes.

The root TypeScript 6 dependency supports dependency-cruiser's parser. The app retains its TypeScript 7 compiler.
Do not upgrade the root compiler until dependency-cruiser supports its parser API. The check fails if the parser scans zero modules.

## Write behavior tests

Use integration or end-to-end tests. Do not add unit tests, shallow component tests, or tests of private helpers.
Put automated UI integration tests in `apps/app/tests/integration/*.test.tsx`. Render complete screens with real routing and application components.
Use React Testing Library role-based queries and user-event for interactions.
The UI suite covers account forms, create-or-join onboarding, invitations, device controls, and unavailable access, plus the home and not-found routes.
API integration tests live in `apps/app/tests/api` under `vitest.api.config.ts`. They call the built Worker over HTTP using Wrangler’s `createTestHarness`. Do not run Worker database tests inside jsdom.

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

The access slice uses Cloudflare D1. Its API fixture resets isolated local Worker storage before each test, applies committed migrations, and closes the harness in teardown. It covers real Better Auth handlers, workspace membership, single-use invitations, pairing, and revocation. All later persistence tests must retain this production-engine fixture and real migrations.
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
