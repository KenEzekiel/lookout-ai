# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: F-AUTH-ACCESS

## Behavior

Visitors open Lookout AI to sign in or register. Authenticated people see onboarding or workspace access controls. Devices see their restricted authorization status and a link to local capture. Unknown routes still show Not Found. This is not yet a monitoring dashboard.

## Entry points

Open `/`, `/join`, `/monitor`, `/device`, or an unknown URL. The paired-device capture route has its own video-led header; access routes retain the shared access header and unknown-route fallback.

## Wiring and compatibility

The shell uses the completed account/session portion of F-AUTH-ACCESS through same-origin HTTP requests. A paired device can reach capture from its access screen; visitors and human members do not see capture controls. The capture screen still does not assess incidents.

## Implementation

[Home route](../../../apps/app/src/routes/index.tsx), [capture route](../../../apps/app/src/routes/device.tsx), [root route](../../../apps/app/src/routes/__root.tsx), [router](../../../apps/app/src/router.tsx), and [access UI](../../../apps/app/src/components/access/app.tsx).

## Verification

[Route integration tests](../../../apps/app/tests/integration/app.test.tsx) cover the visible home heading and unknown-route fallback. [Capture UI tests](../../../apps/app/tests/integration/device.test.tsx) cover paired-device entry and visitor denial. Run `pnpm test`. [Access browser journeys](../../../tests/e2e/access.spec.ts) exercise entry, joining, and monitoring-mode navigation against the built app.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

## Open questions

The monitoring dashboard remains planned. The entry and fallback routes are complete.
