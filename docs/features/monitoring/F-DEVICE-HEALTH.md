# F-DEVICE-HEALTH: Source health and configuration freshness

Status: planned

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE, F-RULE-CONFIG, F-DETECT-REVIEW

## Behavior

Operators can distinguish active, paused, disconnected, stale, and degraded monitoring. A device that cannot capture or assess must not appear healthy.

## Entry points

Inspect device status in the operator client and local source health in the operational-device client.

## Wiring and compatibility

F-AUTH-ACCESS currently shows paired/revoked authorization, not monitoring health. Reuse its device identity and workspace scope when adding health reports. Do not label an authorized but inactive browser healthy. Capture and assessment health remain unimplemented.

Combine capture status, assessment status, last contact, and applied rule version. Revocation and configuration changes must affect reported readiness.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify pause, disconnect, stale heartbeat, provider failure, reconnect, and delayed configuration application. Closing the operator client must not stop a separate active device.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#33](https://github.com/KenEzekiel/lookout-ai/issues/33). Issue status is not implementation evidence.

## Open questions

Health payload, freshness thresholds, and transport remain implementation choices.
