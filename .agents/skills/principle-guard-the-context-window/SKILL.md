---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Use targeted reads and compact summaries; delegate bounded research only when useful."
---

Read the [repository Codex runtime contract](../poteto-mode/references/codex-tools.md) before executing this skill. It overrides inherited platform, model, delegation, shipping, and configuration instructions below.


# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**
- **Size phases and cap scope.** Limit files per phase, set turn budgets, account for mechanism costs.
- **Reduce before delegating.** Filter searches, read relevant ranges, and summarize findings locally. A large file or long task alone does not justify a subagent.
