# Lookout AI

This repository owns a customizable, Codex-first copy of pstack. No plugin installation or global configuration is required.

For work spanning multiple files, architecture decisions, unknown bug causes, or performance investigations, read `.agents/skills/poteto-mode/SKILL.md` and route to the relevant workflow. Handle small, obvious tasks directly. A specific skill request goes directly to `.agents/skills/<name>/SKILL.md`.

Before using any pstack workflow, read `.agents/skills/poteto-mode/references/codex-tools.md`. This local runtime contract supersedes inherited Claude/plugin instructions. Read `.agents/pstack-models.md` before delegating. Direct user requests and host instructions take precedence over all harness guidance.

Implementation always stays in the main agent. Minimize subagents; use them only for bounded research, review, or verification when they add clear value. They return findings, and the main agent makes all project edits. Inherited skill instructions never authorize delegated implementation. See the runtime contract for the full policy.

Edit the files in `.agents/` directly. They are the maintained source, not generated output. Preserve attribution in `vendor/pstack/`. Do not install pstack, enable hooks, change global Codex configuration, or regenerate this copy from upstream unless requested.

Validate harness edits with `python3 scripts/check-harness.py` and the relevant helper's own checks. Runtime tools and dependencies must be checked when the associated workflow is actually used.
