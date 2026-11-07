# F-SOURCE-CAPTURE: Source capture and local buffer

Status: partial

Depends on: F-AUTH-ACCESS

## Behavior

Start and Stop use shared default Button sizing, typography, and decorative play/stop icons. Open capture station uses the same button styling while retaining navigation-link semantics.

A paired operational device selects a browser camera or local video, starts and stops capture, and retains timestamped frame samples and a rolling camera buffer in browser memory. Replayed footage is visibly labeled. Selecting a file does not upload it.

The camera/local-video selector uses the existing [shadcn Select](../../../apps/app/src/components/ui/select.tsx) built on Base UI, with visible labels and keyboard interaction. Changing its value retains the existing capture-stop behavior. File selection and camera permission remain browser-managed.

Capture controls share the button and dropdown motion. Local-video fields enter briefly when selected, and capture-status text uses a short opacity reveal. Reduced motion keeps all feedback immediate. Video playback and sampling are never remounted or delayed by these effects.

## Entry points

Open `/device` using **Open capture station** from the paired-device home screen. The capture header reuses the approved Horizon identity from the access shell. The operator client can close while a separate active capture device continues.

## Wiring and compatibility

F-RULE-CONFIG creates named source metadata with stable `id`, `name`, and `kind` (`camera` or `replay`) in its [shared contract](../../../apps/app/src/lib/rules.ts). `/monitor` reads the catalog from `GET /api/config/device`. The `/device` capture screen selects a configured source for F-DETECT-REVIEW and requires its camera/replay kind to match the local input. Unassigned capture remains preview-only. Creating a source does not start capture.

Use the paired device identity from F-AUTH-ACCESS. Pairing grants workspace-wide source access but does not start capture. The route gates capture on the device principal, and samples and recent-video handles carry its workspace and device IDs. A revoked principal unmounts the screen and stops capture on the next access check. Assigned monitoring sends selected JPEG frames through F-AI-RELAY; preview-only capture sends no assessment media. F-SOURCE-PEER can share video tracks with an authorized operator through direct WebRTC while capture runs.

Expose source timestamps, capture run identity, lifecycle changes, and buffer access for later assessment and clip preservation. Seeking or restarting starts a new run and clears old frame samples. Camera segments rotate in browser memory; Stop releases the camera, sampler, and buffer. A confirmed event can pin its available source interval across buffer rotation or Stop, then prepare a video-only MP4 covering up to ten seconds before and after its source time. The synthetic confirmation handoff uploads only after an accepted report. Rule assignment and live assessment now connect through F-DETECT-REVIEW; assessment-driven clip upload remains unconnected. Never persist untriggered video on the Lookout server.

F-SOURCE-PEER uses `getPeerStream()` to clone the active camera stream or capture the existing local-video element where supported. Each concurrent viewer receives its own outgoing tracks. Closing one viewer stops only its tracks and leaves capture and other viewers running. The capture station starts and ends source presence with its active capture run. Pausing, seeking, stopping, and capture errors end all associated live sessions; each viewer can retry to create another peer connection.

The incident service now has server-owned per-source session leases. The local capture epoch is not that session ID. F-DETECT-REVIEW selects a configured source, starts a `/api/incidents/sessions` lease for its capture epoch, and ends it on Stop or failure. Samples expose stable UUIDs, JPEG Blobs, source media time, and wall-clock capture time; overlapping windows reuse these values.

## Implementation

[Capture route](../../../apps/app/src/routes/device.tsx), [paired-device gate](../../../apps/app/src/components/access/app.tsx), [device screen](../../../apps/app/src/components/device-screen.tsx), and [capture session](../../../apps/app/src/lib/capture-session.ts) implement local capture. The [event clip builder](../../../apps/app/src/lib/event-clip.ts) prepares a playable MP4 from a pinned local-file interval or completed camera segments. The [synthetic confirmation handoff](../../../apps/app/src/lib/incident-evidence.ts) ties that clip to #19's accepted incident. [Device monitoring](../../../apps/app/src/lib/device-monitoring.ts) supplies real confirmed reports and server capture sessions. Calling the clip handoff remains incomplete.

## Verification

[UI integration tests](../../../apps/app/tests/integration/device.test.tsx) cover paired access, local-video playback states, stop/restart, permission refusal, camera absence, and disconnection. Production-build Chromium QA used an isolated workspace and paired device. It exercised a generated local video, a simulated camera, track release on Stop, seek, revocation during capture, and a narrow layout with no browser errors or failed requests. A separate 37-second camera run loaded each retained segment after rollover. [Real-browser clip checks](../../../tests/clip/clip.spec.ts) verify seekable MP4 extraction and a synthetic receipt-to-upload handoff in Chromium. A physical camera indicator check, operator replay, and live assessment-driven upload remain unverified. The local device screen never uploads untriggered footage.

The dropdown migration retains the existing capture integration coverage. Production-build browser QA verifies Camera/Local video selection, recovery to a generated local video when camera access is unsupported, and stopping capture when the source changes. Physical camera behavior remains unverified. Per-run evidence belongs in the PR.

Dropdown panels open outside the trigger with a six-pixel gap and matching width. Four-pixel padding separates the rounded options from the panel border; the selected row no longer overlays the trigger. This corrects the visual alignment reported in PR #59. The preview keeps its minimum height within the available container width, so its aspect ratio cannot force horizontal overflow on a 320-pixel screen.

## Decisions and sources

Kenneth requested a button consistency audit and clearer icons. [Capture controls](../../../apps/app/src/components/device-screen.tsx) and the [capture entry link](../../../apps/app/src/components/access/monitor.tsx) reuse F-APP-SHELL sizing. The existing capture lifecycle, identity, and media behavior remain unchanged.

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#17](https://github.com/KenEzekiel/lookout-ai/issues/17). Issue status is not implementation evidence.

The current interface-refinement PR follows Ken's request to use shadcn in-app dropdowns. No new component dependency or backend contract is introduced.

## Open questions

Supported CCTV protocols, buffer duration, and codecs are undecided. A suspended browser is not guaranteed to keep recording.
