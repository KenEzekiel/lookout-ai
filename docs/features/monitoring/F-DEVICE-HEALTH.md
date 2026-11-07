# F-DEVICE-HEALTH: Source health and configuration freshness

Status: partial

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE, F-RULE-CONFIG, F-DETECT-REVIEW

## Behavior

Operators can distinguish active, paused, disconnected, stale, and degraded monitoring. A device that cannot capture or assess must not appear healthy.

## Entry points

Inspect device status in the operator client and local source health in the operational-device client.

## Wiring and compatibility

F-AUTH-ACCESS shows paired/revoked authorization. The local capture screen separately shows running, paused, stopped, disconnected, and source-error states. It stops capture when hidden or when the device principal is revoked on the next access check. Reuse device identity and workspace scope when adding server health reports. Assessment health, operator-visible heartbeat, and configuration freshness remain unimplemented.

Combine capture status, assessment status, last contact, and applied rule version. Revocation and configuration changes must affect reported readiness.

## Implementation

[Device screen](../../../apps/app/src/components/device-screen.tsx) shows local capture health, and [capture session](../../../apps/app/src/lib/capture-session.ts) releases resources on failure or Stop. Server health reporting is not implemented.

## Verification

The [UI integration tests](../../../apps/app/tests/integration/device.test.tsx) cover pause, disconnect, denied permission, and unavailable camera. Stale heartbeat, provider failure, reconnect, delayed configuration application, and operator-visible health still require implementation and verification. Closing the operator client must not stop a separate active device.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#33](https://github.com/KenEzekiel/lookout-ai/issues/33). Issue status is not implementation evidence.

## Open questions

Health payload, freshness thresholds, and transport remain implementation choices.
