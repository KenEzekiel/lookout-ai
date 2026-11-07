# F-ALERT-PUSH: Background notification setup and delivery

Status: planned

Depends on: F-AUTH-ACCESS, F-ALERT-INAPP

## Behavior

Operators explicitly enable supported web push. A background notification opens the corresponding incident. Unsupported or denied permissions have visible explanations.

## Entry points

Use Enable alerts during setup. On supported iOS devices, Home Screen installation and a user-granted permission are prerequisites.

## Wiring and compatibility

Use F-AUTH-ACCESS human membership when registering recipients and subscriptions. Unverified account email is not a verified email-notification destination. Device pairing grants no recipient-administration permission. Subscription and delivery wiring remain unimplemented.

Authorize subscriptions and route only to configured recipients. Opening a push does not acknowledge the incident or keep a capture tab running. Delivery state remains independent of replay readiness.

F-ALERT-INAPP now publishes the member-scoped `GET /api/incidents/alerts` polling boundary in [the incident service](../../../apps/app/src/server/incidents.ts). It returns open incidents with immutable recipient snapshots, IDs and versions. Push can reuse those identities and response commands, but requires its own subscription authorization and delivery receipts. The browser's local silence does not cancel shared paging. No push subscription or delivery is introduced by the in-app feature.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify subscription, denial, unsupported setup, authorized recipient delivery, and incident opening on actual target devices. Record platform limitations rather than inferring delivery from CI.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#24](https://github.com/KenEzekiel/lookout-ai/issues/24). Issue status is not implementation evidence.

## Open questions

Real phone calls are optional. Browser and OS delivery limits require runtime verification.
