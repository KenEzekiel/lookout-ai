---
name: better-interface
description: Design or review a Lookout screen using the relevant layout, typography, color, accessibility, writing and UI skills. Use for interface design, screen polish or a cross-discipline UI review.
---

# Interface design and review

Read the [repository runtime contract](../poteto-mode/references/codex-tools.md), root `DESIGN.md`, affected feature records and `docs/verification.md`. Preserve the two-client responsibilities and recorded product behavior. A design review does not authorize implementation.

## Choose the relevant disciplines

Load only the skills needed for the task. For a full interface review, inspect each discipline and report any coverage you could not verify.

| Need | Skill |
| --- | --- |
| Grouping, spacing, responsive structure | [better-layout](../better-layout/SKILL.md) |
| Text hierarchy, wrapping, changing numbers | [better-typography](../better-typography/SKILL.md) |
| Semantic tokens and measured contrast | [better-colors](../better-colors/SKILL.md) |
| Keyboard, focus, forms, screen readers | [better-accessibility](../better-accessibility/SKILL.md) |
| Labels, errors, empty states, recovery | [better-writing](../better-writing/SKILL.md) |
| Surfaces, icons, state transitions, motion | [better-ui](../better-ui/SKILL.md) |

Use existing components and tokens before creating new ones. Do not replace the project's visual direction with generic recipes. Keep severity, incident status, notification delivery and evidence readiness distinct. Opening or silencing an alert must not imply acknowledgment.

## Work and verify

For authorized implementation, identify the user journey, relevant states and smallest change first. Include loading, empty, error and recovery states where applicable. Apply [loading-state guidance](loading-states.md) to every async boundary in the changed journey, including shared controls and background refreshes. Preserve keyboard operation and mobile response controls. Keep capture controls in the operational client and incident response in the operator client.

For a review, inspect source and the rendered journey when tools permit. Consolidate findings by root cause, with the concrete trigger, affected workflow, evidence and smallest fix. Distinguish observed failures from unverified risks. Do not report personal style preferences as defects or measured contrast without a measurement.

Work in the main agent by default. This skill does not require delegation or an external design plugin. Follow host restrictions for browser and visual presentation tools. Source inspection alone does not prove rendered behavior.

Run the repository's relevant checks after changes. Frontend journey changes require the manual browser verification and evidence specified by `docs/verification.md`. Report unavailable devices or rendering tools as verification gaps. Keep the final report proportional to the work.
