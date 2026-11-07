# Repository model preferences

Use GPT models through the Codex provider only. The allowed models are `gpt-6-astra`, `gpt-6.1-sol`, and `gpt-6.1-terra`. Do not use Claude, Luna, or other models unless the user changes this preference.

- Implementation: the main agent in the current session; never delegate it.
- Research: `gpt-6.1-sol`.
- Review: `gpt-6-astra`.
- Verification: `gpt-6.1-terra`.
- Default reasoning effort: inherit the current session's effort.

Apply these role choices to inherited workflow roles by purpose. Explorers and investigators are research; critics and auditors are review; test runners are verification. The main agent handles synthesis, explanations, and all project edits. These model preferences do not require subagents or panels; use helpers sparingly under the runtime contract.

Keep the main session on one of the allowed GPT models. This file cannot change the host's active model; if it is outside the allowed set, report that and ask the user to select an allowed model instead of launching an implementation subagent.

For T3 delegates, use provider `codex` and the role's exact model. These are explicit user model preferences, so follow the host's `delegate_task` routing. Resolve the active session's reasoning effort from host-provided context and pass it as `target.options.reasoningEffort`; do not assume the selected model's default inherits it. If the active effort cannot be determined, ask for an explicit effort rather than guessing. Do not apply upstream automatic effort adjustments.

A requested model or effort that is unavailable must be reported, never silently substituted. Do not fabricate model diversity: label a same-model panel accordingly. These preferences are agent instructions, not native Codex configuration or a plugin override-sheet format.
