# F-AUTH-ACCESS: Operator identity and device pairing

Status: partial

Depends on: none

## Behavior

People register with email/password and immediately create or join one workspace. Verification email and password recovery are deferred. The creator is its owner. Invitation links and six-digit codes admit one signed-in operator within 15 minutes. Owners remove operators and authorize or revoke devices. Operators do not manage access.

Monitoring browsers display a five-minute pairing code. The owner approves it in a separate session or switches their current browser directly into restricted device mode. The latter invalidates that browser's human session across tabs. Devices can access every monitoring source in their workspace for this demo, replacing the original per-source assignment requirement. Device credentials survive refresh and restart while browser storage remains. Revocation blocks the next request. Signing out of a separate owner session leaves the device paired.

The interface separates Team and Devices. Only owners see invitation, pairing, and removal actions. Invitations and device approvals open focused dialogs. Removal requires confirmation; same-browser activation explains the cross-tab sign-out before submission. Signup keeps the password-recovery limitation visible beside the password field. Errors preserve entered values, and failed workspace loads can be retried.

Access dialogs and action buttons use the shared interaction motion styles. Pending labels and new validation feedback use a short opacity reveal while retaining the existing disabled state, field retention, and accessible feedback. Reduced motion presents these changes immediately.

## Entry points

Open `/` (redirects to `/devices`) for registration, sign-in, create-or-join onboarding, and workspace access controls. `/join?token=...` preserves an invitation through signup and opens the join action directly instead of showing a competing workspace-creation form. Successful onboarding replaces the invitation URL with the Devices destination so used invitations are not offered again after membership removal. A secondary action accepts an invitation code or returns to workspace creation. `/monitor` pairs a browser without entering the owner's password. Devices offers **Add device** for a code displayed on another device and **Use this device instead** for an explicitly confirmed same-browser switch. The paired screen links to the capture station and distinguishes local capture from unimplemented AI assessment. Revoked devices display the failure and can return to sign-in.

## Wiring and compatibility

The shared workspace layout preserves principal state and its five-second access check across `/devices`, `/team`, `/triggers`, and incident routes. Sign-out, onboarding completion, revoked access, and retry still use the same handlers. Successful onboarding replaces the invitation URL with `/devices`. The current PR changes navigation ownership and paths without changing authentication or workspace permissions.

Better Auth owns accounts and human sessions. D1 owns application workspace membership, invitations, devices, and pending pairing. `principal` resolves visitor, unassigned-user, member, or device identities. `member` protects human handlers and its owner check protects administration. `monitoringDevice` protects device handlers. Consumers derive workspace scope from these identities and include it in resource queries.

All existing access and configuration handlers use this boundary. F-RULE-CONFIG enforces member writes, device reads, workspace isolation, and revocation. Removing an operator atomically disables and version-bumps rules naming that recipient. The local capture route requires a device principal, carries its workspace and device IDs in local samples and video handles, and stops on revocation when the principal check fails. F-AI-RELAY uses the device principal and workspace-scoped enabled rule versions, with real endpoint coverage in [relay tests](../../../apps/app/tests/api/assessment.test.ts). F-INCIDENT-RESPONSE uses the same principals for device sessions and reports, member inbox/detail reads, and versioned response commands. Its real-handler tests cover workspace isolation, removed members, and revoked devices. F-ALERT-INAPP uses the member boundary for recipient-filtered delivery reads; its real-handler tests deny devices, removed members, and foreign workspaces. F-SOURCE-PEER uses current member/device principals on every signaling request and restricts session offers, answers, and polling to their participants and workspace. It ends live viewing on revocation or membership loss through polling and expiring leases. F-ALERT-PUSH binds subscriptions to live human sessions and workspace membership in [the push service](../../../apps/app/src/server/push.ts). Sign-out and same-browser capture activation invalidate that session; delivery rechecks session expiry and current membership. Member removal deletes workspace subscriptions in the same D1 batch. [Push endpoint integration tests](../../../apps/app/tests/api/push.test.ts) cover visitor and device denial, session ownership, sign-out, expiry, and removed members. F-EVIDENCE-REPLAY validates the current paired device against the incident's workspace, device, session, and event identity on writes, and checks current membership on every replay request. Its real-handler tests cover cross-workspace and removed-member denial. Live capture-to-report submission and MCP remain unconnected. These gaps keep this record partial; a paired screen alone is not evidence of active monitoring.

## Implementation

Access forms, workspace headings, and dialogs consume the [shared typography roles](../../../apps/app/src/styles.css) from F-APP-SHELL. Account titles remain 24 px; workspace titles use 30 px; dialogs use 20 px. Body/action text is 15 px and metadata is 13 px. Editable controls use 16 px on narrow screens. [Typography browser journeys](../../../tests/e2e/typography.spec.ts) exercise registration, navigation, dialog cancellation/focus, and same-browser device switching. Authentication and permission behavior remain unchanged.

[Auth configuration](../../../apps/app/src/server/auth.ts), [principal checks](../../../apps/app/src/server/access.ts), [workspace operations](../../../apps/app/src/server/workspaces.ts), [device operations](../../../apps/app/src/server/devices.ts), [schema](../../../apps/app/src/server/schema.ts), [auth migration](../../../apps/app/migrations/0000_auth.sql), and [access migration](../../../apps/app/migrations/0001_access.sql). [Shared contracts](../../../apps/app/src/lib/access.ts) and [access UI](../../../apps/app/src/components/access/app.tsx), [workspace actions](../../../apps/app/src/components/access/workspace-actions.tsx), and [onboarding](../../../apps/app/src/components/access/onboarding.tsx) connect the current screens to these handlers.

## Verification

The Horizon access redesign passed `pnpm verify` and the three Chromium end-to-end checks. Interactive production-build QA exercised signup, workspace creation, invitation-based joining, invalid-code recovery, pairing, keyboard focus, cancellation, revocation, capture entry, and same-browser switching at desktop and narrow widths. [Screenshots and observations](https://github.com/KenEzekiel/lookout-ai/pull/53) record the changed journeys.

[API integration tests](../../../apps/app/tests/api/access.test.ts) exercise real built Worker handlers and isolated D1 migrations, including concurrent invitation redemption, workspace isolation, restricted device access, session invalidation, expiry, attempt limits, and revocation. [UI integration tests](../../../apps/app/tests/integration/access.test.tsx) cover complete screens through MSW HTTP boundaries, including invitation-aware onboarding, copyable invitation links, invalid pairing codes, confirmation and cancellation, role restrictions, and load retry. Both run in `pnpm verify`.

[Browser journey](../../../tests/e2e/access.spec.ts) verifies separate owner/operator/device sessions, link registration, refresh, owner sign-out, revocation, member removal, same-browser switching, and recovery. Interactive Playwright QA on the production build also exercised code-based joining, an invalid invitation, keyboard navigation, narrow-screen layout, and cross-tab access changes without internal mocks. The current PR records the tested revision and results. Cloud deployment verification on November 7, 2026 exercised signup, workspace creation, sign-in, secure cookies, and sign-out against the deployed Worker and D1 database. The temporary account and workspace were removed. [Deployment setup](../../../README.md#cloudflare-deployment) records the production origin and commands. Monitoring consumers remain unverified.

## Decisions and sources

This PR implements the user-approved access-flow and copy refinement. API schemas, session semantics, invitation lifetimes, and device privileges remain unchanged. Existing capture and planned consumers continue to use the same principal boundary.

[Issue #16](https://github.com/KenEzekiel/lookout-ai/issues/16), [accepted demo decisions](../../../PRD.md#demo-accounts-and-device-access), and [access architecture](../../architecture/tech-spec.md#implemented-access-boundary). The current PR implements the user's planning decisions to allow public signup and teams, retain one workspace per person, and grant devices workspace-wide source access. Better Auth handles accounts and sessions; custom bearer invitations avoid its organization plugin's email-bound contract.

## Open questions

Connect the planned monitoring and incident consumers before claiming complete product access enforcement. Cloud deployment now has a real D1 binding, deployed origin, auth secret, and live access verification. Ownership transfer, promotions, workspace deletion, and password recovery are outside this demo slice.
