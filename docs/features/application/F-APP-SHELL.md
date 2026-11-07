# F-APP-SHELL: Application entry and fallback

Status: implemented

Depends on: F-AUTH-ACCESS

## Behavior

The shared header mark now layers Paper Liquid Metal over the original Horizon SVG using a local [mask](../../../apps/app/public/horizon-mask.svg). The wordmark, accessible name, footprint, and favicon stay unchanged. The shader loads only on the client, unmounts for reduced motion or hidden documents, and leaves the static SVG visible while loading or when WebGL cannot render. This decision follows Ken's request to animate the logo with Paper shaders.

Action buttons share a 40-pixel minimum height, 16-pixel icons, and consistent spacing. Compact header, row, and alert-preference actions use the explicit 36-pixel size. Inline text actions keep their compact layout. Labels wrap on narrow screens; icons supplement visible labels and remain hidden from assistive technology.

Initial access and route waits use shared, labeled skeletons. List and detail placeholders reserve content space without exposing protected records. Route fallback starts after 200 ms and imposes no minimum wait. Reduced motion keeps all loading indicators static. Shared buttons support an explicit busy state. Background polling retains existing content while requests are in flight.

Visitors open Lookout to sign in or register. Access and capture headers share the approved Horizon SVG mark; the document uses its matching favicon. Workspace members navigate between `/devices` (default), `/team`, `/triggers`, and `/incidents` using path routes, with direct links, reload, and browser history support. `/` redirects to `/devices`; `?view` no longer selects a page. A shared workspace layout keeps the header, access polling, and incoming alerts mounted while child pages change, so navigation does not replay the workspace-opening state or reset alert sound opt-in. Forms and lists adapt to narrow screens. Authenticated people see onboarding or workspace access controls. Devices see their restricted authorization status and a link to local capture. Members can also open trigger configuration from the Triggers link, with exactly one current navigation destination. Unknown routes still show Not Found. This is not yet a monitoring dashboard.

Shared controls use the [interaction motion styles](../../../apps/app/src/styles.css): enabled buttons give subtle press feedback, overlays use reversible opacity/transform transitions, and new feedback appears briefly. Navigation and typing remain immediate. The active workspace underline slides between destinations in 220 ms through Motion shared layout, including browser history and incident detail navigation. Reduced motion moves it immediately. Dialogs enter in 180 ms and exit in 120 ms; menus use 120 ms. Reduced motion disables CSS animation and transitions, including existing control effects. No animation delays an action or changes focus management.

Devices separates an owner-only **This browser** card from the **Connected devices** list. The card explains local capture and cross-tab sign-out. Device rows pair authorization status with a primary Live view action and secondary owner-only removal. Connected devices leads the reading order, with a count of all registered records, including removed access. The browser card sits beside the list on wide screens and follows it on narrow screens. Raised surfaces, larger device names, icon tiles, and a blue Paired badge distinguish device identity, authorization, and actions. The layout wraps at narrow widths and reuses the shared Button and Badge components.

## Entry points

Every workspace page exposes **Switch to device mode** in the shared header. The [device-mode action](../../../apps/app/src/components/access/device-mode-action.tsx) uses F-AUTH-ACCESS membership to open the owner's existing activation dialog or send an operator to `/monitor` for owner-approved pairing. Header actions wrap on narrow screens. The pairing screen offers **Back to workspace** before a successful device claim. Visitors, unassigned users, paired devices, and the pairing screen do not receive the switch action.

The shared member navigation also opens `/incidents` and `/incidents/$incidentId` through the existing access gate. Devices do not receive incident response controls. [Incident routes and screens](../../../apps/app/src/components/incidents/workspace.tsx) use the existing theme, buttons, and responsive layout.

Open `/`, `/devices`, `/team`, `/join`, `/monitor`, `/device`, `/triggers`, `/incidents`, an incident detail URL, or an unknown URL. The paired-device capture route has its own video-led header; access routes retain the shared access header and unknown-route fallback.

## Wiring and compatibility

Member screens now mount [incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) for F-ALERT-INAPP. Visitors, unassigned users, paired devices, and pairing screens do not subscribe. The alert view and sound controls appear before each screen's content; opening or silencing never changes ownership. [Complete-screen alert tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) cover the shared shell integration. Device copy explains that pairing grants workspace access and capture must run before Live view. Authorization never claims active monitoring.

Member screens also mount [background-alert setup](../../../apps/app/src/components/incidents/push-setup.tsx) for F-ALERT-PUSH. The public manifest and root links provide Home Screen metadata. The service worker caches no authenticated pages. [Setup integration tests](../../../apps/app/tests/integration/push.test.tsx) cover consent, platform guidance, and recovery. Notification clicks use the existing protected incident URL.

The shell uses the completed account/session portion of F-AUTH-ACCESS through same-origin HTTP requests. A paired device can reach capture from its access screen; visitors and human members do not see capture controls. The capture screen still does not assess incidents.

## Implementation

The shared [accordion panel](../../../apps/app/src/components/ui/accordion-panel.tsx) uses the base-nova shadcn [collapsible](../../../apps/app/src/components/ui/collapsible.tsx). Its measured height transitions in both directions over 220 ms, including interrupted toggles. Children stay mounted to preserve form values. Reduced motion removes the transition. This implements Ken’s request to animate all disclosure state changes. Production Chromium verification passed all five panels at 320, 390, and 1280 px in normal and reduced-motion modes, including intermediate opening/closing heights, keyboard toggling, rapid reversal, hidden-panel visibility, and retained source drafts. No browser or network errors were recorded. `pnpm verify` passed 84 UI and 70 API tests.

[Workspace navigation](../../../apps/app/src/components/access/workspace-navigation.tsx) renders typed router links and a decorative shared-layout indicator inside the persistent header. Router link state owns both the active styling and indicator; the animation does not delay navigation or change keyboard semantics.

[Trigger route](../../../apps/app/src/routes/_workspace.triggers.tsx) and [rule-screen integration tests](../../../apps/app/tests/integration/rules.test.tsx) add authenticated configuration navigation under F-RULE-CONFIG.

[Workspace layout](../../../apps/app/src/routes/_workspace.tsx), [Devices route](../../../apps/app/src/routes/_workspace.devices.tsx), [Team route](../../../apps/app/src/routes/_workspace.team.tsx), [member context](../../../apps/app/src/components/access/workspace-context.tsx), [home redirect](../../../apps/app/src/routes/index.tsx), [capture route](../../../apps/app/src/routes/device.tsx), [root route](../../../apps/app/src/routes/__root.tsx), [router](../../../apps/app/src/router.tsx), [access UI](../../../apps/app/src/components/access/app.tsx), [brand](../../../apps/app/src/components/access/brand.tsx), and [favicon](../../../apps/app/public/favicon.svg).

## Verification

Browser QA at 390 × 844 confirmed changing shader pixels, reduced-motion unmounting and restoration, and a visible static mark with WebGL disabled, without page errors. The access integration suite checks the retained home link and static mark. QA media remains outside version control; PR attachment publication remains pending.

The [access integration tests](../../../apps/app/tests/integration/access.test.tsx) verify the header action from Team for both member roles, cancellation, activation retry, and the operator pairing journey. Production-build Chromium QA verified owner entry from Devices, Team, Triggers, and Incidents, keyboard activation and dismissal, and both roles reaching restricted device mode. The main-branch integration recheck preserved the browser-card shortcut. Header, owner-dialog, and operator-pairing checks passed at 1280, 390, and 320 pixels. The implementation PR records the isolated runtime, one mocked activation failure, and screenshots.

The [rendered-button regression](../../../tests/e2e/buttons.spec.ts) checks actual production CSS dimensions and decorative icons at 1280px and 320px. It covers default trigger/source/dialog/inbox actions, compact header/alert/device-row actions, reload pending/failure/recovery, and overflow. Run `pnpm exec playwright test tests/e2e/buttons.spec.ts` after building, or `pnpm qa:browser` for the full browser suite. Reinstating the historical form height and standalone-button size made both viewport cases fail with a 44px Reload where 40px was expected; restoring the shared sizes made them pass. HTTP principal, team, configuration, and incident fixtures keep this a UI layout regression rather than backend verification. Browser tests remain outside required CI under the repository verification policy.

Button-consistency verification passed `pnpm verify`, including 46 complete-screen UI tests and 33 real-Worker API tests. The new [reload regression](../../../apps/app/tests/integration/rules.test.tsx) covers decorative icons, accessible labels, pending submission, failure, and retry. Production-build Chromium QA measured Reload and New trigger at 40 pixels with 16-pixel icons and device-row actions at 36 pixels. It exercised trigger creation/edit/disable, reload recovery, invitation copy, pairing, and incident response at desktop and narrow widths. Per-run screenshots, exact HTTP interceptions, revision, and remaining platform limitations belong in the PR.

[Loading journey integration tests](../../../apps/app/tests/integration/loading.test.tsx) cover delayed access, lists, configuration, navigation away, submission failure, and refresh retention. [Incident integration tests](../../../apps/app/tests/integration/incidents.test.tsx) cover pending responses and replay loading, buffering, failure, and retry. Existing feature tests remain the regression checks for this consumer. Browser observations and evidence for the current change belong in its PR.

The sliding indicator passed production-browser checks at 320, 390, and 1280 px in normal and reduced-motion modes. Frame samples showed intermediate positions only in normal mode. All four destinations, history, keyboard activation, and rapid switching retained the header and aligned indicator without overflow. A direct unavailable incident detail route retained Incidents as current. The navigation run recorded no browser or network errors; the unavailable detail check intentionally received the local not-found response. `pnpm verify` passed with 72 UI and 68 API tests.

The routing update passed complete-screen integration checks and contained Chromium QA against the production Worker with isolated D1. Devices, Team, Triggers, inbox, detail, and browser history retained the same header and alert controls without replaying the workspace-opening state. Direct links, reload, keyboard navigation, sign-out, inbox error recovery, and 320px/390px layouts passed. Inbox failure/recovery and detail used HTTP fixtures; authentication, workspace, team, configuration, and initial empty-alert reads used real handlers. [PR #74](https://github.com/KenEzekiel/lookout-ai/pull/74) records the tested build, observations, screenshots, and navigation recording.

The Horizon access redesign passed `pnpm verify` and the three Chromium end-to-end checks. Interactive production-build QA exercised signup, workspace creation, invitation-based joining, invalid-code recovery, pairing, keyboard focus, cancellation, revocation, capture entry, and same-browser switching at desktop and narrow widths. [Screenshots and observations](https://github.com/KenEzekiel/lookout-ai/pull/53) record the changed journeys.

[Route integration tests](../../../apps/app/tests/integration/app.test.tsx) cover the home redirect, direct Devices and Team links, visitor denial, persistent header and access connection, path navigation, browser back and forward, and unknown-route fallback. [Capture UI tests](../../../apps/app/tests/integration/device.test.tsx) cover paired-device entry and visitor denial. Run `pnpm test`. [Access browser journeys](../../../tests/e2e/access.spec.ts) exercise entry, joining, and monitoring-mode navigation against the built app.

The Devices layout integration coverage in [access tests](../../../apps/app/tests/integration/access.test.tsx) exercises first-device pairing from the empty state, the registered-device count, authorization labels, and list-before-browser reading order. Existing tests retain removal confirmation, owner/operator permissions, activation cancellation, load retry, and Live view recovery. Manual production-build verification and evidence for this layout are recorded in [PR #90](https://github.com/KenEzekiel/lookout-ai/pull/90); do not infer remote capture health from a Paired badge.

## Decisions and sources

[Issue #86](https://github.com/KenEzekiel/lookout-ai/issues/86) adds device-mode entry in the shared member header while retaining the owner-only **This browser** card introduced by [PR #84](https://github.com/KenEzekiel/lookout-ai/pull/84). Model the Domain keeps role-dependent header entry in one component using the existing `Member` shape. Both owner shortcuts use the existing activation dialog and endpoint. Owner-approved operator pairing, capture entry, and device restrictions retain their existing endpoints and permissions.

The current PR implements Ken’s approved browser-card mockup and request to restore and emphasize connected-device Live view. Existing access and peer behavior is preserved. Complete-screen access integration tests cover activation confirmation/cancellation, role restrictions, viewing entry/retry/close, and removal of viewing access after revocation. Manual QA results belong in the PR.

The shared [Button and buttonVariants](../../../apps/app/src/components/ui/button.tsx) own sizes and icon placement. [ActionForm](../../../apps/app/src/components/access/forms.tsx) requires an explicit Lucide action icon, substitutes a decorative busy icon while submitting, and inherits Button sizing. Button-like links reuse buttonVariants. This follows Kenneth's request to audit inconsistent button sizing and add action icons. A second form-only height was rejected because it caused the observed 44-pixel Reload versus 32-pixel New trigger mismatch. The typed icon prop follows Model the Domain and Type System Discipline by making form callers declare their action icon. No endpoint or permission contract changes.

The current PR implements the user’s request for app-wide loading feedback. It reuses [shared loading UI](../../../apps/app/src/components/ui/loading.tsx) and [busy buttons](../../../apps/app/src/components/ui/button.tsx) without changing backend contracts or unfinished feature status.

The current animation change follows Ken’s request to show navigation state sliding between destinations. It builds on PR #74’s persistent workspace layout, keeps route/session ownership intact, and uses the existing Motion dependency with reduced-motion support.

The current PR follows Arsa’s request to keep dashboard UI in a layout and replace `?view` navigation with paths. Synthesis decision: a pathless TanStack workspace parent owns the access shell and renders page content through its outlet. Member context shares the resolved actor and refresh action with Devices and Team; existing pairing, invitation, and capture entry routes retain their access gates. Keeping a separate shell in each page would continue resetting access and sound state. Fix Root Causes moved ownership to the shared route; Model the Domain replaced page booleans with typed child routes and a typed navigation table.

The merge with main preserves F-RULE-CONFIG navigation and device configuration delivery alongside the redesigned access screens.

The user approved the Horizon cobalt/graphite identity and focused access-screen mockup in the implementation conversation. This PR implements that direction while preserving the newly merged capture route. The shared identity belongs to the access shell and is reused by the capture header.

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

Ken requested improved design and layout for `/devices` in the Slack conversation for the current PR. Synthesis decision: keep the existing schema-derived team snapshot, Workspace state, dialogs, and API calls. Make the device list primary and browser activation secondary, rather than adding a dashboard or remote-health state. The [workspace screen](../../../apps/app/src/components/access/workspace.tsx) owns the layout. No shared signature, session, capture, or peer contract changes.

## Open questions

The monitoring dashboard remains planned. The entry and fallback routes are complete.
