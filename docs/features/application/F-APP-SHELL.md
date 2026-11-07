# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: F-AUTH-ACCESS

## Behavior

Action buttons share a 40-pixel minimum height, 16-pixel icons, and consistent spacing. Compact header, row, and alert-preference actions use the explicit 36-pixel size. Inline text actions keep their compact layout. Labels wrap on narrow screens; icons supplement visible labels and remain hidden from assistive technology.

Visitors open Lookout to sign in or register. Access and capture headers share the approved Horizon SVG mark; the document uses its matching favicon. Workspace members navigate between `/devices` (default), `/team`, `/triggers`, and `/incidents` using path routes, with direct links, reload, and browser history support. `/` redirects to `/devices`; `?view` no longer selects a page. A shared workspace layout keeps the header, access polling, and incoming alerts mounted while child pages change, so navigation does not replay the workspace-opening state or reset alert sound opt-in. Forms and lists adapt to narrow screens. Authenticated people see onboarding or workspace access controls. Devices see their restricted authorization status and a link to local capture. Members can also open trigger configuration from the Triggers link, with exactly one current navigation destination. Unknown routes still show Not Found. This is not yet a monitoring dashboard.

Shared controls use the [interaction motion styles](../../../apps/app/src/styles.css): enabled buttons give subtle press feedback, overlays use reversible opacity/transform transitions, and new feedback appears briefly. Navigation and typing remain immediate. The active workspace underline slides between destinations in 220 ms through Motion shared layout, including browser history and incident detail navigation. Reduced motion moves it immediately. Dialogs enter in 180 ms and exit in 120 ms; menus use 120 ms. Reduced motion disables CSS animation and transitions, including existing control effects. No animation delays an action or changes focus management.

## Entry points

The shared member navigation also opens `/incidents` and `/incidents/$incidentId` through the existing access gate. Devices do not receive incident response controls. [Incident routes and screens](../../../apps/app/src/components/incidents/workspace.tsx) use the existing theme, buttons, and responsive layout.

Open `/`, `/devices`, `/team`, `/join`, `/monitor`, `/device`, `/triggers`, `/incidents`, an incident detail URL, or an unknown URL. The paired-device capture route has its own video-led header; access routes retain the shared access header and unknown-route fallback.

## Wiring and compatibility

Member screens now mount [incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) for F-ALERT-INAPP. Visitors, unassigned users, paired devices, and pairing screens do not subscribe. The alert view and sound controls appear before each screen's content; opening or silencing never changes ownership. [Complete-screen alert tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) cover the shared shell integration. Device status copy distinguishes missing automatic reports from working operator alert delivery.

Member screens also mount [background-alert setup](../../../apps/app/src/components/incidents/push-setup.tsx) for F-ALERT-PUSH. The public manifest and root links provide Home Screen metadata. The service worker caches no authenticated pages. [Setup integration tests](../../../apps/app/tests/integration/push.test.tsx) cover consent, platform guidance, and recovery. Notification clicks use the existing protected incident URL.

The shell uses the completed account/session portion of F-AUTH-ACCESS through same-origin HTTP requests. A paired device can reach capture from its access screen; visitors and human members do not see capture controls. The capture screen still does not assess incidents.

## Implementation

Button action text uses a unitless 1.4 line height with the 15 px action size so the shared 40 px and 36 px minimum heights remain consistent after the type-scale update. Longer labels can still grow and wrap. The current PR preserves the shared action icons and sizing from PR #76.

The shared [typography scale](../../../apps/app/src/styles.css) gives Devices, Team, Triggers, Incidents, incident detail, and Capture a 30 px page title, 20 px panel/dialog headings, 15 px body/actions, and 13 px metadata. Account panels retain 24 px titles. Geist Variable, semantic colors, and existing navigation remain shared. Sizes use rem units with unitless line heights; editable controls use 16 px on narrow screens. [Production-browser typography journeys](../../../tests/e2e/typography.spec.ts) check desktop and narrow screens, computed typography, focus return, and overflow. This PR introduces the consistency fix requested in Slack; per-run browser evidence is recorded in its PR description.

[Workspace navigation](../../../apps/app/src/components/access/workspace-navigation.tsx) renders typed router links and a decorative shared-layout indicator inside the persistent header. Router link state owns both the active styling and indicator; the animation does not delay navigation or change keyboard semantics.

[Trigger route](../../../apps/app/src/routes/_workspace.triggers.tsx) and [rule-screen integration tests](../../../apps/app/tests/integration/rules.test.tsx) add authenticated configuration navigation under F-RULE-CONFIG.

[Workspace layout](../../../apps/app/src/routes/_workspace.tsx), [Devices route](../../../apps/app/src/routes/_workspace.devices.tsx), [Team route](../../../apps/app/src/routes/_workspace.team.tsx), [member context](../../../apps/app/src/components/access/workspace-context.tsx), [home redirect](../../../apps/app/src/routes/index.tsx), [capture route](../../../apps/app/src/routes/device.tsx), [root route](../../../apps/app/src/routes/__root.tsx), [router](../../../apps/app/src/router.tsx), [access UI](../../../apps/app/src/components/access/app.tsx), [brand](../../../apps/app/src/components/access/brand.tsx), and [favicon](../../../apps/app/public/favicon.svg).

## Verification

The [rendered-button regression](../../../tests/e2e/buttons.spec.ts) checks actual production CSS dimensions and decorative icons at 1280px and 320px. It covers default trigger/source/dialog/inbox actions, compact header/alert/device-row actions, reload pending/failure/recovery, and overflow. Run `pnpm exec playwright test tests/e2e/buttons.spec.ts` after building, or `pnpm qa:browser` for the full browser suite. Reinstating the historical form height and standalone-button size made both viewport cases fail with a 44px Reload where 40px was expected; restoring the shared sizes made them pass. HTTP principal, team, configuration, and incident fixtures keep this a UI layout regression rather than backend verification. Browser tests remain outside required CI under the repository verification policy.

Button-consistency verification passed `pnpm verify`, including 46 complete-screen UI tests and 33 real-Worker API tests. The new [reload regression](../../../apps/app/tests/integration/rules.test.tsx) covers decorative icons, accessible labels, pending submission, failure, and retry. Production-build Chromium QA measured Reload and New trigger at 40 pixels with 16-pixel icons and device-row actions at 36 pixels. It exercised trigger creation/edit/disable, reload recovery, invitation copy, pairing, and incident response at desktop and narrow widths. Per-run screenshots, exact HTTP interceptions, revision, and remaining platform limitations belong in the PR.

The sliding indicator passed production-browser checks at 320, 390, and 1280 px in normal and reduced-motion modes. Frame samples showed intermediate positions only in normal mode. All four destinations, history, keyboard activation, and rapid switching retained the header and aligned indicator without overflow. A direct unavailable incident detail route retained Incidents as current. The navigation run recorded no browser or network errors; the unavailable detail check intentionally received the local not-found response. `pnpm verify` passed with 72 UI and 68 API tests.

The routing update passed complete-screen integration checks and contained Chromium QA against the production Worker with isolated D1. Devices, Team, Triggers, inbox, detail, and browser history retained the same header and alert controls without replaying the workspace-opening state. Direct links, reload, keyboard navigation, sign-out, inbox error recovery, and 320px/390px layouts passed. Inbox failure/recovery and detail used HTTP fixtures; authentication, workspace, team, configuration, and initial empty-alert reads used real handlers. [PR #74](https://github.com/KenEzekiel/lookout-ai/pull/74) records the tested build, observations, screenshots, and navigation recording.

The Horizon access redesign passed `pnpm verify` and the three Chromium end-to-end checks. Interactive production-build QA exercised signup, workspace creation, invitation-based joining, invalid-code recovery, pairing, keyboard focus, cancellation, revocation, capture entry, and same-browser switching at desktop and narrow widths. [Screenshots and observations](https://github.com/KenEzekiel/lookout-ai/pull/53) record the changed journeys.

[Route integration tests](../../../apps/app/tests/integration/app.test.tsx) cover the home redirect, direct Devices and Team links, visitor denial, persistent header and access connection, path navigation, browser back and forward, and unknown-route fallback. [Capture UI tests](../../../apps/app/tests/integration/device.test.tsx) cover paired-device entry and visitor denial. Run `pnpm test`. [Access browser journeys](../../../tests/e2e/access.spec.ts) exercise entry, joining, and monitoring-mode navigation against the built app.

## Decisions and sources

The shared [Button and buttonVariants](../../../apps/app/src/components/ui/button.tsx) own sizes and icon placement. [ActionForm](../../../apps/app/src/components/access/forms.tsx) requires an explicit Lucide action icon, substitutes a decorative busy icon while submitting, and inherits Button sizing. Button-like links reuse buttonVariants. This follows Kenneth's request to audit inconsistent button sizing and add action icons. A second form-only height was rejected because it caused the observed 44-pixel Reload versus 32-pixel New trigger mismatch. The typed icon prop follows Model the Domain and Type System Discipline by making form callers declare their action icon. No endpoint or permission contract changes.

The current animation change follows Ken’s request to show navigation state sliding between destinations. It builds on PR #74’s persistent workspace layout, keeps route/session ownership intact, and uses the existing Motion dependency with reduced-motion support.

The current PR follows Arsa’s request to keep dashboard UI in a layout and replace `?view` navigation with paths. Synthesis decision: a pathless TanStack workspace parent owns the access shell and renders page content through its outlet. Member context shares the resolved actor and refresh action with Devices and Team; existing pairing, invitation, and capture entry routes retain their access gates. Keeping a separate shell in each page would continue resetting access and sound state. Fix Root Causes moved ownership to the shared route; Model the Domain replaced page booleans with typed child routes and a typed navigation table.

The merge with main preserves F-RULE-CONFIG navigation and device configuration delivery alongside the redesigned access screens.

The user approved the Horizon cobalt/graphite identity and focused access-screen mockup in the implementation conversation. This PR implements that direction while preserving the newly merged capture route. The shared identity belongs to the access shell and is reused by the capture header.

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

## Open questions

The monitoring dashboard remains planned. The entry and fallback routes are complete.
