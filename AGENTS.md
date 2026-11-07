# Lookout AI

This repository owns a customizable, Codex-first copy of pstack. No plugin installation or global configuration is required.

## Hackathon context and delivery

Lookout AI is a hackathon project with a total implementation budget of seven hours. This is the overall project timebox, not a fresh seven hours for each task or session. Prioritize a working end-to-end demo, small scoped changes, and fast relevant verification. Avoid speculative abstractions, broad refactors, and process that does not help deliver the demo. Do not invent a deadline or remaining time when none is recorded.

All new repository changes go through a short-lived branch and a pull request targeting `main`. Never push work directly to `main`. Every PR targets `main`, including dependent work; merge its prerequisite first rather than creating a chain of PRs targeting other feature branches.

The user authorizes agents to merge their completed PRs without another person's review or another permission prompt. Review your own diff, run relevant checks, and resolve known blockers before merging. Human approval and an independent subagent verdict are not required by project policy. Research, review, and verification helpers remain optional under the delegation policy below. Respect actual GitHub rules and required checks; do not bypass them or change repository protections. If blocked, report the blocker and use the host's PR watcher when appropriate.

This policy supersedes inherited pstack requirements for independent shipping reviewers, operator-only merges, mandatory panels, and stacked PR bases. Create the PR, merge when ready, and confirm it landed on `main`.

## Agent workflow

For work spanning multiple files, architecture decisions, unknown bug causes, or performance investigations, read `.agents/skills/poteto-mode/SKILL.md` and route to the relevant workflow. Handle small, obvious tasks directly. A specific skill request goes directly to `.agents/skills/<name>/SKILL.md`.

Before using any pstack workflow, read `.agents/skills/poteto-mode/references/codex-tools.md`. This local runtime contract supersedes inherited Claude/plugin instructions. Read `.agents/pstack-models.md` before delegating. Direct user requests and host instructions take precedence over all harness guidance.

Implementation always stays in the main agent. Minimize subagents; use them only for bounded research, review, or verification when they add clear value. They return findings, and the main agent makes all project edits. Inherited skill instructions never authorize delegated implementation. See the runtime contract for the full policy.

Edit the files in `.agents/` directly. They are the maintained source, not generated output. Preserve attribution in `vendor/pstack/`. Do not install pstack, enable hooks, change global Codex configuration, or regenerate this copy from upstream unless requested.

Validate harness edits with `python3 scripts/check-harness.py` and the relevant helper's own checks. Runtime tools and dependencies must be checked when the associated workflow is actually used.
