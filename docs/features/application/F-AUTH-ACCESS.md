# F-AUTH-ACCESS: Operator identity and device pairing

Status: partial

Depends on: none

## Behavior

People register with email/password and immediately create or join one workspace. Verification email and password recovery are deferred. The creator is its owner. Invitation links and six-digit codes admit one signed-in operator within 15 minutes. Owners remove operators and authorize or revoke devices. Operators do not manage access.

Monitoring browsers display a five-minute pairing code. The owner approves it in a separate session or switches their current browser directly into restricted device mode. The latter invalidates that browser's human session across tabs. Devices can access every monitoring source in their workspace for this demo, replacing the original per-source assignment requirement. Device credentials survive refresh and restart while browser storage remains. Revocation blocks the next request. Signing out of a separate owner session leaves the device paired.

## Entry points

Open `/` for registration, sign-in, create-or-join onboarding, and workspace access controls. `/join?token=...` preserves an invitation through signup. `/monitor` pairs a browser without entering the owner's password. The workspace also offers a same-browser switch. Revoked devices display the failure and can return to sign-in.

## Wiring and compatibility

Better Auth owns accounts and human sessions. D1 owns application workspace membership, invitations, devices, and pending pairing. `principal` resolves visitor, unassigned-user, member, or device identities. `member` protects human handlers and its owner check protects administration. `monitoringDevice` protects device handlers. Consumers derive workspace scope from these identities and include it in resource queries.

All existing access handlers use this boundary. The local capture route requires a device principal, carries its workspace and device IDs in local samples and video handles, and stops on revocation when the principal check fails. Source configuration, assessment relay, incident reports, evidence uploads, notifications, and MCP remain planned and are not wired or verified yet. These gaps keep this record partial; a paired screen alone is not evidence of active monitoring. Those consumers must enforce the delivered identities and add endpoint coverage as they arrive.

## Implementation

[Auth configuration](../../../apps/app/src/server/auth.ts), [principal checks](../../../apps/app/src/server/access.ts), [workspace operations](../../../apps/app/src/server/workspaces.ts), [device operations](../../../apps/app/src/server/devices.ts), [schema](../../../apps/app/src/server/schema.ts), [auth migration](../../../apps/app/migrations/0000_auth.sql), and [access migration](../../../apps/app/migrations/0001_access.sql). [Shared contracts](../../../apps/app/src/lib/access.ts) and [access UI](../../../apps/app/src/components/access/app.tsx) connect the current screens to these handlers.

## Verification

[API integration tests](../../../apps/app/tests/api/access.test.ts) exercise real built Worker handlers and isolated D1 migrations, including concurrent invitation redemption, workspace isolation, restricted device access, session invalidation, expiry, attempt limits, and revocation. [UI integration tests](../../../apps/app/tests/integration/access.test.tsx) cover complete screens through MSW HTTP boundaries. Both run in `pnpm verify`.

[Browser journey](../../../tests/e2e/access.spec.ts) verifies separate owner/operator/device sessions, link registration, refresh, owner sign-out, revocation, member removal, same-browser switching, and recovery. Interactive Playwright QA on the production build also exercised code-based joining, an invalid invitation, keyboard navigation, narrow-screen layout, and cross-tab access changes without internal mocks. The current PR records the tested revision and results. Cloud deployment and monitoring consumers remain unverified.

## Decisions and sources

[Issue #16](https://github.com/KenEzekiel/lookout-ai/issues/16), [accepted demo decisions](../../../PRD.md#demo-accounts-and-device-access), and [access architecture](../../architecture/tech-spec.md#implemented-access-boundary). The current PR implements the user's planning decisions to allow public signup and teams, retain one workspace per person, and grant devices workspace-wide source access. Better Auth handles accounts and sessions; custom bearer invitations avoid its organization plugin's email-bound contract.

## Open questions

Connect the planned monitoring and incident consumers before claiming complete product access enforcement. Cloud deployment still needs a real D1 binding, deployed origin, auth secret, and target-runtime verification. Ownership transfer, promotions, workspace deletion, and password recovery are outside this demo slice.
