# F-AI-RELAY: Secure assessment transport

Status: planned

Depends on: F-AUTH-ACCESS, F-RULE-CONFIG

## Behavior

An authenticated stateless relay protects long-lived model credentials for browser devices. It returns assessment results to the requesting device and enforces scope and usage limits.

## Entry points

The operational device calls the relay during assessment. This is a supporting product capability without a standalone operator screen.

## Wiring and compatibility

Custom rule conditions now include optional `exclusions`. The assessment integration must consume both the authored text and exclusions; `conditionText` provides their combined instruction text. Preserve a separate ambiguity assessment and candidate review rather than treating a predicate score as a confirmed incident. The relay and assessment execution remain unimplemented.

F-RULE-CONFIG now publishes [rule and source schemas](../../../apps/app/src/lib/rules.ts) through `GET /api/config/device`. Relay authorization must use the stored source ID and current enabled rule/version from that contract. This consumer remains unimplemented.

Use `monitoringDevice` from the delivered F-AUTH-ACCESS boundary. Demo scope is all sources in that device’s workspace. Validate requested sources against that workspace, and deny revoked credentials on every request. This relay connection is still unimplemented.

The device owns the monitoring loop. The relay must not persist non-triggered images, clips, or decision payloads in application storage or logs. Provider inference remains remote.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify assigned-device success, revoked and cross-user denial, bounded requests, provider errors, and absence of browser-exposed secrets or retained non-triggered payloads.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#20](https://github.com/KenEzekiel/lookout-ai/issues/20). Issue status is not implementation evidence.

## Open questions

Provider access and request/result contract require verification. This feature does not authorize server-owned monitoring as a fallback.
