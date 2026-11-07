# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: F-AUTH-ACCESS

## Behavior

Visitors open Lookout to sign in or register. Access and capture headers share the approved Horizon SVG mark; the document uses its matching favicon. Workspace members navigate between Devices (default) and Team using a URL search parameter, with reload and browser history support. Forms and lists adapt to narrow screens. Authenticated people see onboarding or workspace access controls. Devices see their restricted authorization status and a link to local capture. Members can also open trigger configuration from the Triggers link, with exactly one current navigation destination. Unknown routes still show Not Found. This is not yet a monitoring dashboard.

## Entry points

Open `/`, `/join`, `/monitor`, `/device`, `/triggers`, or an unknown URL. The paired-device capture route has its own video-led header; access routes retain the shared access header and unknown-route fallback.

## Wiring and compatibility

The shell uses the completed account/session portion of F-AUTH-ACCESS through same-origin HTTP requests. A paired device can reach capture from its access screen; visitors and human members do not see capture controls. The capture screen still does not assess incidents.

## Implementation

[Trigger route](../../../apps/app/src/routes/triggers.tsx) and [rule-screen integration tests](../../../apps/app/tests/integration/rules.test.tsx) add authenticated configuration navigation under F-RULE-CONFIG.

[Home route](../../../apps/app/src/routes/index.tsx), [capture route](../../../apps/app/src/routes/device.tsx), [root route](../../../apps/app/src/routes/__root.tsx), [router](../../../apps/app/src/router.tsx), [access UI](../../../apps/app/src/components/access/app.tsx), [brand](../../../apps/app/src/components/access/brand.tsx), and [favicon](../../../apps/app/public/favicon.svg).

## Verification

The Horizon access redesign passed `pnpm verify` and the three Chromium end-to-end checks. Interactive production-build QA exercised signup, workspace creation, invitation-based joining, invalid-code recovery, pairing, keyboard focus, cancellation, revocation, capture entry, and same-browser switching at desktop and narrow widths. [Screenshots and observations](https://github.com/KenEzekiel/lookout-ai/pull/53) record the changed journeys.

[Route integration tests](../../../apps/app/tests/integration/app.test.tsx) cover the visible home heading and unknown-route fallback. [Capture UI tests](../../../apps/app/tests/integration/device.test.tsx) cover paired-device entry and visitor denial. Run `pnpm test`. [Access browser journeys](../../../tests/e2e/access.spec.ts) exercise entry, joining, and monitoring-mode navigation against the built app.

## Decisions and sources

The merge with main preserves F-RULE-CONFIG navigation and device configuration delivery alongside the redesigned access screens.

The user approved the Horizon cobalt/graphite identity and focused access-screen mockup in the implementation conversation. This PR implements that direction while preserving the newly merged capture route. The shared identity belongs to the access shell and is reused by the capture header.

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

## Open questions

The monitoring dashboard remains planned. The entry and fallback routes are complete.
