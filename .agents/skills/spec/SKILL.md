---
name: spec
description: >-
  Create or update specifications, implementation plans, and task breakdowns grounded in the current codebase. Use for "spec this", "plan this feature", "break this down", capturing agreed decisions, or turning a spec into tickets.
---

Read the [repository runtime contract](../poteto-mode/references/codex-tools.md) and root `AGENTS.md` before using this skill. Host instructions and the user's scope take precedence.

# Spec

One entrypoint for requirements, design, planning, and task breakdown. Start from the conversation and actual code; do not ask the user to repeat settled decisions.

## Choose the smallest useful route

- **Plan:** For a planning question, give a concise plan in the conversation. A plan request alone does not authorize implementation or repository files.
- **Create a spec:** When a written spec is requested, use the repository's established location and format. Read the existing product documents and `docs/architecture/` first. Extend the relevant document instead of introducing a parallel `.specs/` tree. Omit empty sections and unnecessary files.
- **Capture decisions:** If the conversation already settles the approach, synthesize it without another interview. Preserve constraints, rejected alternatives that explain the choice, and unresolved questions. Never present an inference as a user decision.
- **Break down work:** From an existing spec or agreed conversation, produce tasks without rewriting settled requirements. Keep them in the conversation or the authorized `tasks.md`.
- **Export tickets:** Draft first; publish only with explicit approval for the tracker, target, and scope. Use available tools and existing tracker conventions. No tracker setup is required for local planning.

For a simple implementation request, plan briefly and continue authorized work. If a large effort has unresolved decisions that block a reliable plan, use [interview](../interview/SKILL.md) to settle those decisions. File count alone does not require a larger workflow, delegation, or a new artifact.

## Ground the work

1. Establish the desired behavior, observable acceptance criteria, non-goals, and files or surfaces that must remain untouched.
2. Read the relevant code paths, callers, tests, repository instructions, and existing decisions. Use primary documentation for unfamiliar external behavior. Label current facts, assumptions, and unknowns.
3. Check whether an existing module or smaller change already meets the goal. Every proposed abstraction, migration, dependency, and test needs a requirement or demonstrated regression to justify it.
4. Resolve factual questions from evidence. Ask only about missing decisions that materially affect behavior, scope, safety, or ownership; reuse existing answers and approvals. Use `interview` only when that would help.

Requirements-first and design-first are both valid: choose from the uncertainty, not a mandatory setup question. When an assumption fails against current source, revise the affected requirements, design, and tasks together within the authorized artifact scope.

## Requirements and design

State the problem, target behavior, relevant failure cases, acceptance criteria, and non-goals. Use user stories only when they clarify the outcome. Distinguish what exists from what is proposed.

Design only the affected behavior: ownership, data flow, interfaces, invariants, errors, and relevant migration or rollout constraints. Name the public behavior to verify and reuse existing test conventions. Add a small diagram only when it clarifies a decision. Keep one authoritative location for each decision; link instead of duplicating it across files.

Where words conflict with the implementation, show the concrete discrepancy and settle its meaning before relying on it. Read existing glossaries or ADRs if relevant; do not create or modify them as an incidental side effect.

## Verifiable task slices

Prefer a narrow behavior that can be exercised end to end through the layers it actually needs. Implementation and its necessary tests belong in the same slice. A backend-only task need not add a UI; a task is not split merely because its title contains "and".

Each task should be understandable by a fresh session, with:

| Field | Content |
| --- | --- |
| Outcome | The behavior this task delivers and its requirement reference |
| Scope | Relevant files or modules, existing pattern, and untouched surfaces |
| Acceptance | Observable success and important invariants |
| Automated verify | Repository commands plus the result that means pass |
| Manual verify | Journey or environment checks, such as a UI flow, a deploy, or a vendor console; the agent runs these when tools and authorization permit; `None` when there are none |
| Blocked by | Only tasks whose outputs are required before this task can work |

In a `tasks.md`, write each verify item as a checkbox. Ticked boxes are the resume point for a later session.

Size tasks so each can be implemented and verified coherently. Show parallel opportunities only if useful; dependencies and file ownership must permit them, and marking a task parallel does not authorize delegation.

For broad mechanical migrations, do not force artificial vertical slices. Use one atomic change when practical; use expand–migrate–contract only for a demonstrated compatibility or rollout need. If tasks cannot pass independently, name the shared integration gate and do not claim earlier slices are independently complete.

Keep concrete file references in local plans where they help execution, and recheck them before use. Tracker exports follow the repository's issue template and include sufficient context, acceptance criteria, verification, and blockers. Do not create a second status store or modify parent issues without authorization.

## Review, handoff, and tracking

Before presenting, check that every requirement is covered, tasks have meaningful verification, dependencies are acyclic, parallel ownership is compatible, and non-goals still hold. Remove tasks that add no required outcome.

Present the result once at the appropriate level. Do not insert separate approval rounds for requirements, design, and tasks when the request already authorizes the next step. A planning-only request ends with the plan; a plan is not approval to commit, publish, deploy, or implement.

When implementation is authorized, continue with the repository implementation workflow and available tools. Track completion in the conversation, an available host tool, or the authorized task artifact. Recheck material source assumptions and relevant gates before executing an inherited plan. Report what is verified and what remains blocked; a passed build alone does not prove deployment or user-visible behavior.

Incorporates task-slicing ideas from [AI Hero to-tickets](https://www.aihero.dev/skills-to-tickets), adapted to the repository's planning and authorization rules.
