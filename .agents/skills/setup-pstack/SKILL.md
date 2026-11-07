---
name: setup-pstack
description: Configure repository-local pstack model preferences for Codex. Use when asked to change pstack role models or reasoning effort.
---

# Configure local pstack

Read the [repository runtime contract](../poteto-mode/references/codex-tools.md) first.

1. Read `.agents/pstack-models.md` and the user's requested changes. Defaults inherit the active session's model and effort.
2. Inspect the current host's advertised models and supported delegation settings. In T3, use its capability discovery when explicit settings require delegation. Do not infer support from upstream Claude aliases or a cached model list.
3. Apply choices the user already specified. Ask only for missing preferences needed to make the requested change. For a panel, record its members explicitly and explain any unavailable diversity. Never substitute another model for an unavailable choice.
4. Edit `.agents/pstack-models.md` with readable role-to-model preferences and optional explicit effort settings. Preserve unrelated choices. These are instructions for the agent, not native config syntax.
5. Report the file changed and any host limitation. Run `python3 scripts/check-harness.py` from the repository root.

Routing lives in the root `AGENTS.md`. If the user asks to change routing, edit it there. There is no plugin, session hook, generated model table, global override sheet, or global configuration to install or update.
