# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: F-AUTH-ACCESS

## Behavior

Visitors open Lookout AI to sign in or register. Authenticated people see onboarding or workspace access controls. Devices see their restricted authorization status. Unknown routes still show Not Found. This is not yet a monitoring dashboard.

## Entry points

Open `/`, `/join`, `/monitor`, or an unknown URL. Product routes preserve the shared header and unknown-route fallback.

## Wiring and compatibility

The shell uses the completed account/session portion of F-AUTH-ACCESS through same-origin HTTP requests. Planned monitoring consumers do not gate shell navigation. Installed UI components and paired-device screens do not establish implemented monitoring behavior.

## Implementation

[Home route](../../../apps/app/src/routes/index.tsx), [root route](../../../apps/app/src/routes/__root.tsx), [router](../../../apps/app/src/router.tsx), and [access UI](../../../apps/app/src/components/access/app.tsx).

## Verification

[Route integration tests](../../../apps/app/tests/integration/app.test.tsx) cover the visible home heading and unknown-route fallback. Run `pnpm test`. [Access browser journeys](../../../tests/e2e/access.spec.ts) also exercise entry, joining, and monitoring-mode navigation against the built app. Interactive QA inspected desktop and narrow-screen layout.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

## Open questions

The monitoring dashboard remains planned. The entry and fallback routes are complete.
