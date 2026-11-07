# F-ALERT-INAPP: Incoming alerts and monitor response

Status: planned

Depends on: F-INCIDENT-RESPONSE

## Behavior

An open operator client shows a prominent incoming alert with incident context, Open incident, and Acknowledge. User-enabled sound is optional. Opening or silencing an alert does not acknowledge it.

## Entry points

Receive a confirmed incident in the desktop or mobile operator client. Keep the incident actionable without sound or animation.

## Wiring and compatibility

Receive incident state without waiting for clip upload. Response actions use the shared incident service. Render evidence availability independently. Respect keyboard navigation and reduced motion.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify incoming alert, explicit acknowledgment, silent operation, open/close without acknowledgment, delayed replay, and narrow-screen and keyboard use.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#23](https://github.com/KenEzekiel/lookout-ai/issues/23). Issue status is not implementation evidence.

## Open questions

The simulated call does not promise a native telephone screen, continuous ringtone, or silent-mode bypass.
