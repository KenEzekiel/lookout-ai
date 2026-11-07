# F-RULE-CONFIG: Rules, assignments, and recipients

Status: planned

Depends on: F-AUTH-ACCESS

## Behavior

Operators create a trigger from a template or blank description and configure source, severity, recipient, and escalation delay. Duration is an optional condition, not a universal detection delay.

## Entry points

Open New trigger in the operator client, review the intended recipient, and enable the assigned rule.

## Wiring and compatibility

Publish one versioned rule contract for devices, relay authorization, and incident reporting. Distribute rule changes and revocations. Model output cannot replace configured recipients or permissions.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify template and custom creation, invalid settings, recipient visibility, assigned-device delivery, rule updates, and rejection of stale or unauthorized reports.

## Decisions and sources

[Product direction](../../PRD.md), [experience design](../architecture/design.md), [visual design](../../DESIGN.md), and [service roadmap](../architecture/roadmap.md). Delivery issue from the roadmap: [#18](https://github.com/KenEzekiel/lookout-ai/issues/18). Issue status is not implementation evidence.

## Open questions

Rule schema, distribution mechanism, and escalation destination remain open. No fixed sampling rate is agreed.
