# F-ALERT-PUSH: Background notification setup and delivery

Status: partial

Depends on: F-AUTH-ACCESS, F-ALERT-INAPP

## Behavior

An operator explicitly enables background alerts for their signed-in browser session. Setup explains blocked permission, unsupported or insecure browsers, missing server configuration, and the iPhone or iPad Home Screen prerequisite. Turning alerts off removes the server subscription before unsubscribing the browser. Signing out ends delivery for that session. Membership removal deletes that operator's workspace subscriptions.

A notification contains only a generic Lookout title, generic sign-in guidance, and an incident ID. Clicking it focuses and navigates an existing same-origin window or opens the corresponding incident page. It never acknowledges the incident. The existing access gate and member-authorized detail endpoint protect evidence and context after navigation. Already dispatched notifications can remain after sign-out or a response, but contain no incident details.

Delivery is best effort. No native call UI, continuous ringtone, silent-mode bypass, confirmed device display, or automatic retry is promised. An open app still receives F-ALERT-INAPP independently. Background push does not keep capture running.

## Entry points

The shared workspace layout keeps the **Background alerts** disclosure mounted across Devices, Team, Triggers, inbox, and detail navigation. Every member screen has a **Background alerts** disclosure with **Enable alerts** and **Turn off background alerts** controls. Permission is requested only after a click. iPhone and iPad users must add Lookout to the Home Screen in Safari and open it there on a supported OS. The manifest and PNG icons support installation; no authenticated content is cached for offline use.

## Wiring and compatibility

`GET /api/push/settings` returns `{configured,publicKey,endpoints}` for the current member session. `POST /api/push/subscribe` accepts the browser's `{endpoint,expirationTime,keys:{p256dh,auth}}`. `POST /api/push/unsubscribe` accepts `{endpoint}` and deletes only the caller's session subscription. Device and visitor principals cannot register. IDs, user ownership and workspace come from server authorization, never submitted fields. Encryption keys are validated on entry. Registration permits at most ten subscriptions per account and twenty save attempts per minute.

D1 subscriptions reference the live Better Auth session, user and workspace. Signing out or switching to capture deletes the human session; expired sessions and missing membership also fail delivery eligibility. Removing an operator deletes subscriptions in the membership-removal batch, preventing a later rejoin from restoring them. An endpoint cannot move between active accounts. A new session for the same account can explicitly enable its existing endpoint. HTTPS endpoints are limited to Google's FCM, Mozilla's production push service and Apple's web push service, with no credentials, custom port, or followed redirects. Other push providers remain unsupported.

The existing incident report path calls [the push service](../../../apps/app/src/server/push.ts) after validating and persisting the authoritative event. Delivery uses the immutable recipient snapshot, current workspace membership, live session and open incident status. It runs independently of evidence readiness. Each incident and endpoint has one durable initial-attempt claim, including across report retries, concurrent calls, unsubscribe and resubscribe. New eligible endpoints can receive an open incident when a device retries its report. This is not a backfill scheduler.

The request awaits provider attempts with a five-second fetch timeout per endpoint. Each encrypted RFC 8291 message uses VAPID authentication and a 60-second TTL. Provider 404 or 410 removes the subscription; other errors retain it for later incidents and record failure. A response or sign-out stops new eligible claims, but cannot retract an in-flight provider request. A crash after claiming can lose the attempt and leave an attempting receipt. There is no queue or retry scheduler in this slice.

F-INCIDENT-RESPONSE publishes `notificationStatus` as `not-sent`, `attempting`, `accepted`, or `failed`. At least one provider acceptance takes precedence over pending or failed attempts. Accepted means provider acceptance, not display on a device. A failed aggregate includes expired subscriptions. In-app visibility and replay readiness remain separate. F-ALERT-ESCALATE is still unimplemented and must not reuse the initial-attempt claim as an escalation receipt.

## Implementation

[Subscription schemas](../../../apps/app/src/lib/push.ts), [push service](../../../apps/app/src/server/push.ts), [HTTP route](../../../apps/app/src/routes/api/push/$.ts), [D1 schema](../../../apps/app/src/server/schema.ts), and [migration](../../../apps/app/migrations/0004_background_push.sql) own registration, authorization, delivery and attempt receipts. [Incident reporting](../../../apps/app/src/server/incidents.ts) is the producer. [Member removal](../../../apps/app/src/server/workspaces.ts) deletes subscriptions with membership.

[Setup UI](../../../apps/app/src/components/incidents/push-setup.tsx) mounts in [the access shell](../../../apps/app/src/components/access/app.tsx). [The public service worker](../../../apps/app/public/push-worker.js) handles push and notification clicks. [The manifest](../../../apps/app/public/manifest.webmanifest) and [root links](../../../apps/app/src/routes/__root.tsx) provide Home Screen metadata. [Incident detail](../../../apps/app/src/components/incidents/workspace.tsx) explains provider acceptance and failures. Setup instructions are in [the application README](../../../README.md#background-push-setup).

Implementation and local integration coverage are present. Physical desktop background delivery, Android and iOS installation and notification delivery, and deployment configuration remain unverified, so this feature stays partial.

## Verification

[Complete-screen integration tests](../../../apps/app/tests/integration/push.test.tsx) exercise explicit enable and disable, dismissed permission, registration failure and retry, blocked permission, unsupported browser, missing server configuration, and iOS Home Screen guidance. Browser platform interfaces and HTTP services are boundary fixtures; real UI components and routing remain in use.

[Production-Worker integration tests](../../../apps/app/tests/api/push.test.ts) use isolated D1 with every real migration, including the independent peer-view migration. They cover session ownership, visitor and device denial, endpoint validation, recipient and workspace isolation, custom incident definitions with exclusions, real VAPID encryption with independent decryption, report deduplication, terminal provider errors, transient provider failure, sign-out, expiry, and membership removal. The external push service alone is mocked. The published service-worker script also runs with browser-platform fixtures to verify minimal notifications and matching protected navigation without acknowledgment.

Manual browser QA and its exact mocks, tested build and media belong in the PR. Actual OS notification delivery, foreground and background operation on target desktop, Android and iOS devices, Home Screen installation, and denied-permission recovery remain required target-device checks. Emulation and CI do not establish those results.

## Decisions and sources

[Issue #24](https://github.com/KenEzekiel/lookout-ai/issues/24), [experience design](../../architecture/design.md#operator-notifications), and [visual design](../../../DESIGN.md). This PR introduces the subscription and attempt contracts above.

Synthesis decision: extend the existing member/session authorization and incident report path rather than add a second event transport or durable scheduler. The database owns subscriptions and attempt claims, the setup UI owns permission consent, and the service worker owns only generic notification display and navigation. Type System Discipline keeps setup states explicit and validates external subscriptions. Prove It Works requires real Worker and D1 tests plus separate device verification.

The provider adapter uses [webcrypto-web-push](https://github.com/block65/webcrypto-web-push) for standard encryption and VAPID. Platform behavior follows [WebKit's Home Screen requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) and [the Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

## Open questions

Configure stable VAPID keys and the deployed HTTPS origin before enabling real delivery. Finish target-device testing and record OS and browser versions. Reliable retry, delivery confirmation, subscription renewal after browser rotation, and additional push-provider hosts are outside this best-effort slice. Explicitly enable again after a new sign-in. VAPID key rotation requires removing the old browser subscription before enabling again. Assessment-to-report integration remains a separate prerequisite for AI-generated incidents.
