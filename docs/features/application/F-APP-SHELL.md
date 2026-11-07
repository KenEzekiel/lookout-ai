# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: F-AUTH-ACCESS

## Behavior

Action buttons share a 40-pixel minimum height, 16-pixel icons, and consistent spacing. Compact header, row, and alert-preference actions use the explicit 36-pixel size. Inline text actions keep their compact layout. Labels wrap on narrow screens; icons supplement visible labels and remain hidden from assistive technology.

Visitors open Lookout to sign in or register. Access and capture headers share the approved Horizon SVG mark; the document uses its matching favicon. Workspace members navigate between Devices (default) and Team using a URL search parameter, with reload and browser history support. Forms and lists adapt to narrow screens. Authenticated people see onboarding or workspace access controls. Devices see their restricted authorization status and a link to local capture. Members can also open trigger configuration from the Triggers link, with exactly one current navigation destination. Unknown routes still show Not Found. This is not yet a monitoring dashboard.

## Entry points

The shared member navigation also opens `/incidents` and `/incidents/$incidentId` through the existing access gate. Devices do not receive incident response controls. [Incident routes and screens](../../../apps/app/src/components/incidents/workspace.tsx) use the existing theme, buttons, and responsive layout.

Open `/`, `/join`, `/monitor`, `/device`, `/triggers`, `/incidents`, an incident detail URL, or an unknown URL. The paired-device capture route has its own video-led header; access routes retain the shared access header and unknown-route fallback.

## Wiring and compatibility

Member screens now mount [incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) for F-ALERT-INAPP. Visitors, unassigned users, paired devices, and pairing screens do not subscribe. The alert view and sound controls appear before each screen's content; opening or silencing never changes ownership. [Complete-screen alert tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) cover the shared shell integration. Device status copy distinguishes missing automatic reports from working operator alert delivery.

The shell uses the completed account/session portion of F-AUTH-ACCESS through same-origin HTTP requests. A paired device can reach capture from its access screen; visitors and human members do not see capture controls. The capture screen still does not assess incidents.

## Implementation

[Trigger route](../../../apps/app/src/routes/triggers.tsx) and [rule-screen integration tests](../../../apps/app/tests/integration/rules.test.tsx) add authenticated configuration navigation under F-RULE-CONFIG.

[Home route](../../../apps/app/src/routes/index.tsx), [capture route](../../../apps/app/src/routes/device.tsx), [root route](../../../apps/app/src/routes/__root.tsx), [router](../../../apps/app/src/router.tsx), [access UI](../../../apps/app/src/components/access/app.tsx), [brand](../../../apps/app/src/components/access/brand.tsx), and [favicon](../../../apps/app/public/favicon.svg).

## Verification

The Horizon access redesign passed `pnpm verify` and the three Chromium end-to-end checks. Interactive production-build QA exercised signup, workspace creation, invitation-based joining, invalid-code recovery, pairing, keyboard focus, cancellation, revocation, capture entry, and same-browser switching at desktop and narrow widths. [Screenshots and observations](https://github.com/KenEzekiel/lookout-ai/pull/53) record the changed journeys.

[Route integration tests](../../../apps/app/tests/integration/app.test.tsx) cover the visible home heading and unknown-route fallback. [Capture UI tests](../../../apps/app/tests/integration/device.test.tsx) cover paired-device entry and visitor denial. Run `pnpm test`. [Access browser journeys](../../../tests/e2e/access.spec.ts) exercise entry, joining, and monitoring-mode navigation against the built app.

## Decisions and sources

The shared [Button and buttonVariants](../../../apps/app/src/components/ui/button.tsx) own sizes and icon placement. [ActionForm](../../../apps/app/src/components/access/forms.tsx) requires an explicit Lucide action icon, substitutes a decorative busy icon while submitting, and inherits Button sizing. Button-like links reuse buttonVariants. This follows Kenneth's request to audit inconsistent button sizing and add action icons. A second form-only height was rejected because it caused the observed 44-pixel Reload versus 32-pixel New trigger mismatch. The typed icon prop follows Model the Domain and Type System Discipline by making form callers declare their action icon. No endpoint or permission contract changes.

The merge with main preserves F-RULE-CONFIG navigation and device configuration delivery alongside the redesigned access screens.

The user approved the Horizon cobalt/graphite identity and focused access-screen mockup in the implementation conversation. This PR implements that direction while preserving the newly merged capture route. The shared identity belongs to the access shell and is reused by the capture header.

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

## Open questions

The monitoring dashboard remains planned. The entry and fallback routes are complete.
