# F-EVIDENCE-REPLAY: Private event clips and replay

Status: partial

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE, F-INCIDENT-RESPONSE

## Behavior

Saved replay reserves a video-shaped area with specific loading and buffering feedback. Media errors offer Retry replay without hiding incident response controls. Preparation and upload show an indeterminate indicator and never claim measured progress.

Confirmed incidents upload an event clip to private storage for authorized later replay. Target ten seconds of available lead-in and ten seconds of aftermath. Server-saved clips expire after seven days. Show preparing, uploading, ready, or unavailable states. Incident response remains available while evidence is missing.

## Entry points

Open incident evidence in the operator client. Offer seekable saved replay only after the server confirms readiness.

## Wiring and compatibility

Use F-AUTH-ACCESS device identities for workspace-scoped uploads and current human membership for replay reads. Uploads match the incident's device, capture session, and event ID. Membership removal and device revocation affect later requests. The Worker serves private R2 bytes through the authenticated route; no public object URL is returned.

Attach retrying uploads to the same incident. The browser pins the interval before awaiting the report receipt, converts that interval to a video-only H.264 MP4, verifies playback and seeking, then starts and sends the upload. Its retry map keeps the same clip bytes and incident ID while the device page stays open. If preparation fails, the device records an unavailable reason. If upload is interrupted, the server shows unavailable after two minutes and accepts a retry. Notification does not wait for upload. Acknowledge never deletes evidence. Local-file media time positions the event within the clip. Camera recorder segments use wall-clock time, so their handoff uses the candidate frame's captured-at timestamp rather than video playback time.

F-INCIDENT-RESPONSE publishes the incident ID and report receipt in [the shared contract](../../../apps/app/src/lib/incidents.ts). An incident without an evidence row appears as preparing. Its response status/version and evidence status are independent. The detail and inbox read preparing, uploading, ready, or unavailable; only ready shows a replay control. Saved clips expire in application reads seven days after upload. R2 must also receive the seven-day object lifecycle rule when the bucket is provisioned: `pnpm --filter @lookout/app exec wrangler r2 bucket lifecycle add lookout-evidence evidence-seven-days --expire-days 7`. Verify with `pnpm --filter @lookout/app exec wrangler r2 bucket lifecycle list lookout-evidence`. The rule is not part of local Wrangler bindings and has not been applied to a cloud bucket.

## Implementation

[Saved replay](../../../apps/app/src/components/incidents/saved-replay.tsx) owns browser media loading, buffering, and retry feedback.

[Capture session](../../../apps/app/src/lib/capture-session.ts) pins the available event interval. [Event clip builder](../../../apps/app/src/lib/event-clip.ts) creates a seekable video-only MP4 from a local file or camera segments. [Confirmed-event evidence handoff](../../../apps/app/src/lib/incident-evidence.ts) uses the monitoring report receipt and supports a same-incident retry. [Evidence service](../../../apps/app/src/server/evidence.ts), [D1 schema](../../../apps/app/src/server/schema.ts), [migration](../../../apps/app/migrations/0006_evidence_replay.sql), [private R2 binding](../../../apps/app/wrangler.jsonc), and [incident route](../../../apps/app/src/routes/api/incidents/$.ts) implement storage and replay. [Operator incident UI](../../../apps/app/src/components/incidents/workspace.tsx) shows each state and the ready-only player.

## Verification

[Loading journey integration tests](../../../apps/app/tests/integration/loading.test.tsx) cover delayed access, lists, configuration, navigation away, submission failure, and refresh retention. [Incident integration tests](../../../apps/app/tests/integration/incidents.test.tsx) cover pending responses and replay loading, buffering, failure, and retry. Existing feature tests remain the regression checks for this consumer. Browser observations and evidence for the current change belong in its PR.

[Real-browser clip checks](../../../tests/clip/clip.spec.ts) cover local-file trimming, a late camera event across segments, and a confirmed camera review-to-upload handoff, continued assessment during preparation, and retrying the same encoded bytes in Chromium. [Worker/D1/local-R2 tests](../../../apps/app/tests/api/access.test.ts) cover retry after a lost response, state timeout, cross-workspace and removed-member denial, missing objects, expiry, and byte ranges. [UI integration tests](../../../apps/app/tests/integration/incidents.test.tsx) cover all four states and the ready-only player. Manual Chromium QA on the production Worker with isolated D1/R2 exercised separate operator and device sessions, preparing, uploading, acknowledgment before readiness, unavailable, playback and seeking on desktop and a 390-pixel viewport. Keyboard focus and Space playback worked. Pixel 7 Chrome emulation loaded clip metadata without overflow. Capture controls, live detection, physical Android/iOS playback, iOS WebKit emulation, and the cloud R2 lifecycle rule remain unverified.

## Decisions and sources

The current PR fixes the missing assessment-to-upload connection. [Device monitoring](../../../apps/app/src/lib/device-monitoring.ts) pins footage once on confirmation, preserves it across report retries, and starts upload only after an accepted receipt. The former synthetic-only combined report/upload API is removed. Monitoring does not wait for encoding or upload. Preparation failures are sent to the evidence service; failed uploads retain their bytes for the latest-incident retry action.

The current PR implements the user’s request for app-wide loading feedback. It reuses [shared loading UI](../../../apps/app/src/components/ui/loading.tsx) and [busy buttons](../../../apps/app/src/components/ui/button.tsx) without changing backend contracts or unfinished feature status.

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#22](https://github.com/KenEzekiel/lookout-ai/issues/22). Issue status is not implementation evidence.

## Open questions

F-DETECT-REVIEW now calls the evidence handoff with the current epoch, source time, accepted incident ID, session ID, and event ID. Failed upload bytes survive only in this page, and the device retry action covers its latest incident while monitoring remains active. The seven-day retention and video-only H.264 MP4 output are decided for this slice. Cloud bucket lifecycle setup and real device QA remain delivery gates.
