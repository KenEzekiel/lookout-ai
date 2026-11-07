# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: none

## Behavior

Visitors can open the home route and see Lookout AI. Unknown routes show Not Found. This is a scaffold, not a monitoring dashboard.

## Entry points

Open `/` or an unknown URL. Future operator and device routes must preserve a usable entry and unknown-route fallback.

## Wiring and compatibility

Existing route composition is the entry point for future product journeys. Installed UI components do not establish implemented monitoring behavior.

## Implementation

[Home route](../../apps/app/src/routes/index.tsx), [root route](../../apps/app/src/routes/__root.tsx), and [router](../../apps/app/src/router.tsx).

## Verification

[Route integration tests](../../apps/app/tests/integration/app.test.tsx) cover the visible home heading and unknown-route fallback. Run `pnpm test`. This record adds no new browser-verification claim.

## Decisions and sources

[Product direction](../../PRD.md), [experience design](../architecture/design.md), [visual design](../../DESIGN.md), and [service roadmap](../architecture/roadmap.md).

## Open questions

The home page is a placeholder.
