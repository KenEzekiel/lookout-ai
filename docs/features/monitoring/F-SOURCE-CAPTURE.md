# F-SOURCE-CAPTURE: Source capture and local buffer

Status: partial

Depends on: F-AUTH-ACCESS

## Behavior

A paired operational device selects a browser camera or local video, starts and stops capture, and retains timestamped frame samples and a rolling camera buffer in browser memory. Replayed footage is visibly labeled. Selecting a file does not upload it.

## Entry points

Open `/device` using **Open capture station** from the paired-device home screen. The capture header reuses the approved Horizon identity from the access shell. The operator client can close while a separate active capture device continues.

## Wiring and compatibility

F-RULE-CONFIG creates named source metadata with stable `id`, `name`, and `kind` (`camera` or `replay`) in its [shared contract](../../../apps/app/src/lib/rules.ts). `/monitor` reads the catalog from `GET /api/config/device`. The existing `/device` capture screen still selects a camera or file independently; connecting its capture identity to this source ID remains unimplemented. Creating a source does not start capture.

Use the paired device identity from F-AUTH-ACCESS. Pairing grants workspace-wide source access but does not start capture. The route gates capture on the device principal, and samples and recent-video handles carry its workspace and device IDs. A revoked principal unmounts the screen and stops capture on the next access check. No capture data is sent to the server in this slice.

Expose source timestamps, capture run identity, lifecycle changes, and buffer access for later assessment and clip preservation. Seeking or restarting starts a new run and clears old frame samples. Camera segments rotate in browser memory; Stop releases the camera, sampler, and buffer. Event-interval extraction, rule assignment, assessment, and clip upload remain unconnected. Never persist untriggered video on the Lookout server.

## Implementation

[Capture route](../../../apps/app/src/routes/device.tsx), [paired-device gate](../../../apps/app/src/components/access/app.tsx), [device screen](../../../apps/app/src/components/device-screen.tsx), and [capture session](../../../apps/app/src/lib/capture-session.ts) implement local capture. The server-owned assessment and incident path remains planned.

## Verification

[UI integration tests](../../../apps/app/tests/integration/device.test.tsx) cover paired access, local-video playback states, stop/restart, permission refusal, camera absence, and disconnection. Production-build Chromium QA used an isolated workspace and paired device. It exercised a generated local video, a simulated camera, track release on Stop, seek, revocation during capture, and a narrow layout with no browser errors or failed requests. A separate 37-second camera run loaded each retained segment after rollover. A physical camera indicator check and event-interval extraction remain unverified. No upload endpoint is called by local capture.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#17](https://github.com/KenEzekiel/lookout-ai/issues/17). Issue status is not implementation evidence.

## Open questions

Supported CCTV protocols, buffer duration, and codecs are undecided. A suspended browser is not guaranteed to keep recording.
