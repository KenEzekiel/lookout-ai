# Horizon access UI verification

Verified the production build for this PR with `main` through `7b78114`, using Chromium through Playwright. The browser server used Wrangler's Worker harness, real migrations, and isolated temporary D1 storage at `http://127.0.0.1:4173`. Test users Alex Lane and Taylor Reed and workspace Westside studio were created through visible forms. No HTTP or service mocks were used in this manual run.

## Observed journeys

- Checked the merged trigger feature: navigated Devices → Triggers → Team, created a source and fall trigger, then switched to device mode and received enabled version 1. Desktop and 390-pixel layouts showed no page errors or horizontal overflow. [Merged Triggers](triggers-merged.png) and [mobile device configuration](configuration-merged-mobile.png).

- Signed up and created a workspace. The focused onboarding form led to Devices. [Sign-in](sign-in.png) and [onboarding](onboarding.png).
- Opened Add device using Enter. Focus moved to Device name; Escape returned focus to Add device. Tab stayed within the open dialog.
- Submitted an invalid pairing code. The error appeared and both fields retained their values. Replacing the code successfully approved the device. [Invalid-code recovery](invalid-code.png).
- Generated a code in a separate device session at 390 × 844. Approval changed that session to Device connected. Open capture station reached the existing capture screen. [Pairing screen](pairing-mobile.png) and [owner Devices](devices.png).
- Reloaded Team and retained the selected view. Created an invitation and followed it through signup in a separate mobile session. Joining showed no competing workspace-creation form and replaced the invitation URL with Devices. [Invitation onboarding](join-mobile.png).
- Verified the operator could view Team and Devices but had no invitation, pairing, or removal controls. [Operator Team](team-mobile.png) and [owner Team](team.png).
- Cancelled device-access removal. The device remained paired. Confirmed removal on a second attempt; the separate device displayed the revoked-access error and returned to sign-in successfully.
- Cancelled same-browser setup and retained owner access. Then confirmed it; both owner tabs became restricted device sessions. [Confirmation](switch-confirmation.png) and [connected state](device-connected.png).
- Inspected 1440 × 1000 desktop and 390 × 844 mobile layouts. Devices, Team, pairing, and capture entry fit without horizontal overflow. [Mobile Devices](devices-mobile.png) and [mobile pairing dialog](pair-dialog-mobile.png).
- No JavaScript page errors or failed transport requests were observed in the instrumented owner session. The deliberate invalid-code request returned the expected HTTP 400 console message. The operator and device sessions reported no page errors.

## Automated checks

- `pnpm verify` passed: formatting, lint, comment policy, types, feature records, dependency boundaries, 22 app UI tests, 13 API tests, 92 Oracle tests, 7 pitch-deck tests, harness validation, and production builds.
- `pnpm exec playwright test` passed all three checks, including separate owner/operator/device sessions, membership removal, revocation, cross-tab switching, capture entry, and reloads.
- UI integration tests use MSW at the HTTP boundary. API tests and browser checks use the real Worker and isolated D1 storage.

## Limits

The existing capture engine's physical camera behavior was not reverified for this visual change. Its five integration checks passed and its paired route was exercised manually. AI assessment, incident alerts, and cloud deployment remain outside this change. Screenshots document the state transitions; no animation or timing behavior was added.
