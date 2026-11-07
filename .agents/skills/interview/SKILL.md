---
name: interview
description: >-
  Clarify a loose idea, stress-test a plan or design, or gather material requirements through focused questions. Use for "interview me", "grill me", "grill-me", or unclear product decisions. Can draft a questionnaire for someone else. A settled plan goes directly to spec or authorized implementation.
---

Read the [repository runtime contract](../poteto-mode/references/codex-tools.md) and root `AGENTS.md` before using this skill. Host instructions and the user's scope take precedence.

# Interview

Resolve the decisions the user actually needs to make. Read the conversation first; investigate code and sources for facts rather than asking the user to do that work.

## Choose the output

- **Conversation:** The default for exploring or challenging an idea. End with the goal, decisions, non-goals, and remaining uncertainty. Do not create files.
- **Spec:** When a written spec is requested, pass the agreed decisions to `spec` using the repository's conventions. Do not repeat the interview.
- **Questionnaire:** When someone else holds the missing information, establish who will answer and what decision their answers must unblock. Draft focused questions in the conversation, or a file only if requested. Do not send it.

## Ask in dependency order

Start with the material gaps in goal, audience, current state, constraints, or success criteria. Skip anything already answered or safely inferable from evidence.

Map unresolved decisions and their dependencies as a design tree. For a stress-test, probe the assumptions and failure cases that could change the plan, rather than just collecting requirements. Keep the tree in the conversation; a separate artifact is unnecessary unless requested.

Group a small number of independent questions whose prerequisites are settled in one round. Defer a question if an unanswered prerequisite could change it. Number questions when asking more than one. Ask one at a time when requested or when one consequential answer determines the next question.

For each decision question, give your recommended answer and the main tradeoff. If evidence is insufficient for a recommendation, explain what is missing. Word a recommended choice so that "yes" accepts it, so agreeing never requires answering "no". Keep fact-finding questions neutral.

After each answer, update settled decisions, check for contradictions, and revisit which questions are now unblocked. An investigation still in progress is an unsettled prerequisite: continue with independent questions while its dependent questions wait. Research facts with available tools; delegate only when authorized by the current request or applicable instructions.

Use the host's available question tools according to their rules, or plain text when appropriate. Do not invent a `question` tool. Research can proceed while a user decision is pending, but silence is not approval and dependent work must wait.

Check consequential statements against the actual code. Explain contradictions plainly. Preserve established project terms; propose clarified meanings only when ambiguity affects a decision. Glossary and ADR writes require authorized documentation scope.

If talking cannot settle a visual, state-model, or feasibility question, propose one bounded experiment with `show-me` or available tools. A question alone does not authorize code, external calls, or data access.

Stop when material branches in the agreed scope are settled or explicitly deferred, the user can make the core decision, and acceptance criteria are clear. Recap the agreed direction and any open decisions before a handoff. Do not exhaust hypothetical branches, impose a fixed number of rounds, or reopen accepted choices. If the user asks to proceed, resolve routine gaps with stated assumptions and act within scope; keep material decisions and approvals explicit.

## Questionnaire mode

Ask about the recipient and desired outcome, not facts the user already said they do not know. Provide enough context for the recipient to answer without this chat. Group questions by decision, identify which are essential, accept "unknown", and ask for evidence where a factual claim matters. Omit questions whose answers would not affect the next action. Drafting is complete when the questionnaire is ready for the user to review or send.

Informed by Matt Pocock's [grill-me](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/productivity/grill-me/SKILL.md) and [grilling](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/productivity/grilling/SKILL.md), and AI Hero's [to-questionnaire](https://www.aihero.dev/skills-to-questionnaire). Adapted for bounded rounds, authorized research, and the user's scope; no external skill dependencies.
