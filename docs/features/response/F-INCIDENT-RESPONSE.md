# F-INCIDENT-RESPONSE: Incident ownership and response

Status: planned

Depends on: F-AUTH-ACCESS, F-RULE-CONFIG

## Behavior

An incident records source, event time, rule match, owner, evidence, and timeline. Acknowledge records ownership and stops new paging. Resolve closes the response. Dismiss records incorrect-alert feedback.

## Entry points

Open an incident from the dashboard or alert. A cleared scene adds evidence without resolving the incident automatically.

## Wiring and compatibility

Deduplicate event reports and repeated observations. Share authoritative incident state with alerts, escalation, replay, and MCP. Keep severity, response status, notification state, and evidence readiness separate.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify repeated reports create one incident, distinct acknowledge/dismiss/resolve actions, cross-user denial, concurrent responses, and scene-clear behavior. Verify acknowledgment while replay is unavailable.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#19](https://github.com/KenEzekiel/lookout-ai/issues/19). Issue status is not implementation evidence.

## Open questions

Identity, state, deduplication keys, and persistence contracts must be agreed with dependent work. Feedback does not imply automatic retraining.
