---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

Read the [repository Codex runtime contract](../poteto-mode/references/codex-tools.md) before executing this skill. It overrides inherited platform, model, delegation, shipping, and configuration instructions below.


# How

On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following this skill.

On GitHub Copilot, read the [platform mapping](../poteto-mode/references/copilot-tools.md), including its per-skill notes, before following this skill.

On Muse, read the [platform mapping](../poteto-mode/references/muse-tools.md), including its per-skill notes, before following this skill.

On Antigravity, read the [platform mapping](../poteto-mode/references/agy-tools.md), including its per-skill notes, before following this skill.

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

## Explore and explain

1. State a reasonable scope when the question is ambiguous, then inspect the relevant files directly.
2. For a narrow question, trace the behavior and write the explanation yourself. No explainer subagent is needed.
3. For a complex subsystem, use targeted searches and follow the relevant boundaries. Delegate one bounded read-only research question only when it would materially improve the answer; avoid a fixed explorer panel.
4. Synthesize the evidence and explain it yourself. Use `references/explorer-prompt.md` and `references/explainer-prompt.md` as checklists, not mandatory agent roles. Distinguish observed behavior from inference.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
