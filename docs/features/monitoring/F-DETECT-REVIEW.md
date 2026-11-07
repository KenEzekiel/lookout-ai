# F-DETECT-REVIEW: Device assessment and candidate review

Status: partial

Depends on: F-SOURCE-CAPTURE, F-RULE-CONFIG, F-AI-RELAY, F-INCIDENT-RESPONSE

## Behavior

A paired operational device selects an assigned source at the capture station. Capture can run as preview without an assignment. With a compatible camera or replay source, enabled rules drive remote assessment, candidate review, and incident reporting. Source selection stops capture so a running input cannot silently acquire another source identity. Replay remains labeled.

A Decisions match probability of at least 0.70 creates a candidate without repeated-positive gating. The uncertainty probability does not veto a positive candidate. An optional duration requires successive positive observations across that source-time duration; an unavailable or uncertain observation, pause, configuration interruption, or gap longer than five source seconds restarts duration accumulation. Duration-free fall and crash rules can reach review on their first positive observation.

Review returns distinct outcomes. Positive reports the candidate. Rejected suppresses that candidate until scene clear. Need-more-evidence retains its identity and original interval while adding fresh evidence. Unavailable retains the candidate and shows degraded monitoring; it never counts as a negative. Reviews run at most once per twelve seconds across the source. Review evidence retains up to four early and four latest frames within thirty source seconds. A candidate that cannot be reviewed within that envelope becomes visibly inconclusive and waits for scene clear.

A confirmed candidate keeps one UUID and approximate event time through report retries. After a receipt, repeated positives do not report again. Dismissal or resolution does not rearm the device. Rearming requires observations entirely beyond the retained event interval, match at most 0.20 and uncertainty at most 0.30, spanning at least three source seconds. Scene clear does not resolve an operator incident.

## Entry points

On `/device`, choose **Assigned source**, select the compatible camera or local video, and press **Start**. **Stop**, source replacement, capture failure, hidden-tab capture shutdown, and seek invalidate pending results. Pausing playback suspends inference and retains event identity. **Refresh assigned rules** requests the current configuration; automatic polling runs every five seconds.

The panel displays applied rule names and versions, assessment and review outcomes, configuration failures, delayed requests, and the latest reported event's approximate time and source interval. The latest incident shows preparing, uploading, ready, or unavailable evidence feedback and offers Retry video upload when its encoded clip remains available. Operator health reporting remains F-DEVICE-HEALTH.

## Wiring and compatibility

[Monitoring controls](../../../apps/app/src/components/device-monitoring.tsx) load F-RULE-CONFIG snapshots and bind the selected source to the existing capture session. [DeviceMonitoring](../../../apps/app/src/lib/device-monitoring.ts) owns per-rule event state and one sequential request chain. Rule replacement or disable cancels pending requests and discards late results; unchanged versions preserve held events through configuration outages. No assessment proceeds while configuration is unavailable.

The capture owner provides UUID-tagged JPEG Blobs and source/wall-clock timestamps. One F-AI-RELAY client per capture epoch preserves frame acknowledgments across overlapping windows. The relay continues to own authoritative condition/exclusions lookup, credentials, inference, quotas, and frame-cache storage. The device never sends its own condition text.

The loop starts `/api/incidents/sessions` for the selected source and ends the session on disposal. A successful late session-start result is also ended. It uses the existing `/api/incidents/reports` contract and validates the full receipt. Only the incident service owns incident creation, recipient snapshots, deduplication, and notification attempts. A twelve-hour expired session requires Stop and restart; the device does not silently create a new event identity.

Each iteration selects the latest eight chronological capture samples and starts no work queue. Rules are scheduled round-robin with at least 1.5 seconds between iterations; a candidate can be assessed and reviewed within one iteration. A request chain has a twenty-second deadline and displays degradation after five seconds. Capture retains thirty samples, each candidate retains at most eight, and the relay client retains at most sixty-four cached receipts. More than eight enabled rules produces an explicit capacity error instead of silently omitting rules. These are demo limits, not validated detection-performance settings.

Event time is the wall-clock capture time of the first candidate-window frame, labeled approximate. The device retains source `from`/`to` separately from inference and receipt time. The current report API persists event time only; interval enrichment remains incomplete. F-EVIDENCE-REPLAY supplies [preservation and upload](../../../apps/app/src/lib/incident-evidence.ts). Positive review pins footage at the first candidate frame's source time before reporting. The reporting state retains that promise across report retries. Once a receipt arrives, clip preparation and upload run independently of the assessment loop, using the same incident, session, and event identity. Already accepted incidents finish their preserved upload even if capture stops; stale results do not update a replacement controller. Upload retries reuse encoded bytes without reporting another incident. Restarts and seeks deliberately begin a new capture identity; cross-run duplicate recognition is not implemented.

F-DEVICE-HEALTH now consumes typed per-rule assessment health, the oldest successful assessment time across enabled rules, and the controller-applied version set. Failures, delayed requests, configuration outages, and request errors cannot become healthy reports. The controller qualifies published state with capture epoch and source identity; health transport remains metadata-only and owns no assessment work.

## Implementation

[Controller](../../../apps/app/src/lib/device-monitoring.ts), [monitoring controls](../../../apps/app/src/components/device-monitoring.tsx), [capture station](../../../apps/app/src/components/device-screen.tsx), and [capture samples](../../../apps/app/src/lib/capture-session.ts) connect the existing relay and incident APIs. No additional server loop, incident store, or provider adapter is introduced.

## Verification

The current upload fix adds complete-route coverage for evidence preparation and unavailable footage without stopping monitoring. The real-browser camera journey in [clip checks](../../../tests/clip/clip.spec.ts) verifies confirmation, continued assessment during preparation, MP4 upload, and identical-byte retry without another report. The camera journey failed with no retained footage when given playback time and passed after using the camera frame timestamp. Manual production-build observations are recorded in the PR.

[Complete-route integration tests](../../../apps/app/tests/integration/device.test.tsx) exercise real capture and monitoring code with browser media input and MSW HTTP boundaries. They cover positive delivery, stable retry payloads, dismissed receipts without duplicate reports, rejected/more-evidence/unavailable review outcomes, slow inference with one pending request, Stop, disabled-rule and seek cancellation, configured duration, and deliberate rearming with a new event identity. Existing relay and incident API integration suites retain real Worker/D1 coverage.

`pnpm verify` passed after integration with the dashboard routes and durable follow-up on main. Contained production-build Chromium QA on `fbf4508` used isolated D1, real application endpoints, simulated camera input, and mocked external inference. It observed assigned-source keyboard selection, reviewed reporting, one persisted incident despite repeated positives after dismissal, delayed-provider degradation, Stop cancellation/session end, and a 390-pixel layout without overflow. There were no console errors; the stopped assessment was the only aborted browser request. Inbox and dismissal checks used the real API rather than the operator UI. A follow-up production-browser run on `ea0f9c4` verified the merged evidence receipt schema, rejected and more-evidence reviews without incidents, source-kind mismatch, unavailable-provider recovery, and delayed-assessment cancellation on Stop or rule disable. The 390-pixel layout had no overflow; only expected provider/cancellation errors were observed. The follow-up did not repeat keyboard navigation or sustained deduplication. [PR #81](https://github.com/KenEzekiel/lookout-ai/pull/81) records both runs. The nine screenshots and two recordings are published as verified GitHub attachments in PR #81. The installed GitHub CLI was upgraded to 2.103.3 to enable attachment uploads.

Required before claiming implemented: permitted fall, harmless, and crash footage with live provider responses. No local provider credential was available; the private secret request timed out. Mocked inference proves control behavior, not detection accuracy. Per-run results, latency, screenshots, video, and blockers belong in the PR. Run `pnpm verify`.

## Decisions and sources

The current PR fixes incident videos never uploading by connecting confirmed reviews to the existing evidence owner. Reporting remains cancellable and independent of video preparation. Evidence status is separate from detection state.

[Issue #21](https://github.com/KenEzekiel/lookout-ai/issues/21), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), [fall evidence](../../../experiments/decisions-falls/README.md), and [crash evidence](../../../experiments/decisions-crashes/README.md).

This PR's synthesis decision is one controller per configured source/capture epoch, with explicit armed, duration-observing, candidate, reporting, and held event states. React owns controls and renders controller status; capture, relay, and persistence retain their existing owners. This keeps retry identity and cancellation out of rendering and prevents independent polling effects from issuing concurrent assessment requests. The conservative clear thresholds and sampling policy are implementation defaults requiring live evaluation. The 0.70 candidate threshold follows the experiments; it is not a general accuracy guarantee. Repeated-positive gating is intentionally absent because it missed baseline falls.

## Open questions

Live model quality, latency, real camera/mobile operation, and production deployment remain unverified. Short footage that ends before remote review completes cancels the result with capture shutdown; live verification must record this limitation. The one-fps capture policy differs from the experiments' two-fps input and has not been calibrated. Event intervals are local and approximate until evidence/incident enrichment is connected. No automatic retry across page reload, cross-run duplicate recognition, or remote health heartbeat is claimed. The device retry action covers the latest incident while its controller remains active.
