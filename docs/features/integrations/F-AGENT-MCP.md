# F-AGENT-MCP: Agent incident inspection and acknowledgment

Status: planned

Depends on: F-AUTH-ACCESS, F-INCIDENT-RESPONSE, F-EVIDENCE-REPLAY

## Behavior

An authorized external agent can inspect incidents and evidence and acknowledge using the same state as the dashboard. This is a P2 product capability.

## Entry points

Connect an authorized MCP client and inspect an incident before requesting acknowledgment.

## Wiring and compatibility

The delivered F-AUTH-ACCESS contract distinguishes human members from monitoring devices. A monitoring credential must never authorize MCP incident responses. External-agent authentication and its mapping to workspace permissions are still undecided and unimplemented.

Reuse incident authorization, evidence access, and acknowledgment semantics. Agent action must stop escalation and appear in the operator view.

The [incident contract](../../../apps/app/src/lib/incidents.ts) now publishes response versions, ownership, and timeline. Its HTTP handlers currently authorize human members only. Future external-agent authentication must map to the same workspace boundary and use the shared versioned response service. No MCP endpoint or agent principal is implemented.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify authorized inspection and acknowledgment, cross-user denial, unavailable evidence, and dashboard consistency.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#27](https://github.com/KenEzekiel/lookout-ai/issues/27). Issue status is not implementation evidence.

## Open questions

Secondary to the core demos. Agent-driven rule configuration and tool contracts are deferred. This is unrelated to Oracle.
