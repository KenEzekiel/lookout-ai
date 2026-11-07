# F-ALERT-ESCALATE: One durable follow-up

Status: planned

Depends on: F-RULE-CONFIG, F-INCIDENT-RESPONSE, F-ALERT-INAPP

## Behavior

An unacknowledged incident executes one configured follow-up step after its delay. Acknowledgment stops new escalation attempts. Already delivered notifications may remain.

## Entry points

Configure delay and destination with the rule. Inspect the due follow-up in the incident panel and acknowledge to stop further paging.

## Wiring and compatibility

F-RULE-CONFIG now stores [recipient IDs and escalation delay](../../../apps/app/src/lib/rules.ts) in the rule definition. The delay is 1 to 3600 whole seconds. The demo policy is one follow-up to the same configured recipients. The future incident/escalation implementation must derive this policy from the authoritative rule version; saving it does not schedule or deliver a notification.

Use authoritative shared incident state and the configured policy. Handle retries and restarts without duplicate follow-up attempts. Cancellation must agree across operator devices.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify the unacknowledged timer, acknowledgment before execution, restart/retry behavior, delivery failure, and the acknowledgment/execution race. Record the boundary for an already dispatched notification.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#25](https://github.com/KenEzekiel/lookout-ai/issues/25). Issue status is not implementation evidence.

## Open questions

Scheduler, destination, and precise concurrency contract remain open. Broader on-call schedules are outside the core demo.
