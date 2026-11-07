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

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify subscription, denial, unsupported setup, authorized recipient delivery, and incident opening on actual target devices. Record platform limitations rather than inferring delivery from CI.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#24](https://github.com/KenEzekiel/lookout-ai/issues/24). Issue status is not implementation evidence.

## Open questions

Real phone calls are optional. Browser and OS delivery limits require runtime verification.
