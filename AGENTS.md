# Lookout AI

This repository owns a customizable, Codex-first copy of pstack. No plugin installation or global configuration is required.

## Hackathon context and delivery

Lookout AI is a hackathon project with a total implementation budget of seven hours. This is the overall project timebox, not a fresh seven hours for each task or session. Prioritize a working end-to-end demo, small scoped changes, and fast relevant verification. Avoid speculative abstractions, broad refactors, and process that does not help deliver the demo. Do not invent a deadline or remaining time when none is recorded.

All new repository changes go through a short-lived branch and a pull request targeting `main`. Never push work directly to `main`. Every PR targets `main`, including dependent work; merge its prerequisite first rather than creating a chain of PRs targeting other feature branches.

Agents may implement, verify, push their feature branch, and open a PR without another permission prompt. Use `.agents/skills/open-pr/SKILL.md` to publish work and automatically follow CI, diagnose failures, apply focused fixes, and verify the latest head until checks pass or a concrete blocker is reported. Then present the PR and wait for the user's explicit confirmation to merge that PR. No additional person's code review or independent subagent verdict is required by project policy, but the user's merge confirmation is required. A request to implement, push, open a PR, or get checks green is not merge authorization. Do not merge, enable auto-merge, or enqueue a merge before confirmation. Research, review, and verification helpers remain optional. Respect actual GitHub rules and required checks; do not bypass them or change repository protections.

This policy supersedes inherited pstack requirements for independent shipping reviewers, mandatory panels, and stacked PR bases, and revokes earlier standing authorization to merge automatically. Create the PR and report its validation results. Merge only after explicit user confirmation for that PR, then confirm it landed on `main`.

## Agent workflow

At the start of every session, read `.agents/skills/poteto-mode/references/codex-tools.md` and `.agents/skills/poteto-mode/SKILL.md`. Apply poteto-mode throughout the session and route tasks to the relevant workflow. Keep small, obvious tasks lightweight. A specific skill request goes directly to `.agents/skills/<name>/SKILL.md`.

Before using any pstack workflow, read `.agents/skills/poteto-mode/references/codex-tools.md`. This local runtime contract supersedes inherited Claude/plugin instructions. Read `.agents/pstack-models.md` before delegating. Direct user requests and host instructions take precedence over all harness guidance.

Implementation always stays in the main agent. Minimize subagents; use them only for bounded research, review, or verification when they add clear value. They return findings, and the main agent makes all project edits. Inherited skill instructions never authorize delegated implementation. See the runtime contract for the full policy.

Edit the files in `.agents/` directly. They are the maintained source, not generated output. Preserve attribution in `vendor/pstack/`. Do not install pstack, enable hooks, change global Codex configuration, or regenerate this copy from upstream unless requested.

Validate harness edits with `python3 scripts/check-harness.py` and the relevant helper's own checks. Runtime tools and dependencies must be checked when the associated workflow is actually used.

## Application conventions and verification

Run `pnpm verify` before opening an application PR. Follow `docs/verification.md` for code boundaries and test setup.
Use integration or end-to-end tests only. UI integration tests may mock our backend API and external services at the HTTP boundary using MSW. API integration tests must keep handlers, internal modules, and the database real, and may mock external services only.
Use Vitest and React Testing Library with a virtual DOM for automated UI checks. Use Playwright for manual QA of the built app, outside the required CI checks.
The first persistence feature must include endpoint tests with an isolated temporary database using the production engine and real migrations. Never use a shared development or production database in tests.
Add behavior coverage with each feature or regression fix. Do not weaken checks, add skipped tests, or introduce suppressions to make CI pass.
Do not add comments to maintained code. Tests may contain comments. Keep rationale in docs. Generated files, vendored files, and the copied `.agents` tooling are excluded from the code comment ban.
