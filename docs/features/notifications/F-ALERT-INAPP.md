# F-ALERT-INAPP: Incoming alerts and monitor response

Status: implemented

Depends on: F-INCIDENT-RESPONSE

## Behavior

An open operator client shows a prominent incoming alert for an open incident naming that member in its snapshotted recipients. It shows the trigger summary, source, event time, severity, and pending evidence before a clip exists. Open incident navigates to detail and silences locally. Silence here hides only that incident in the current browser tab. Neither action acknowledges it. Acknowledge alert uses the existing versioned command and records shared ownership.

Sound starts off. Enable sound and test requests browser playback and plays an original 1.2-second, three-pulse incident alarm with sharp alternating 960/720 Hz tones and restrained harmonics. While enabled, the current incoming incident repeats the alarm every six seconds until silenced, opened, acknowledged, superseded by shared state, or disconnected. Test sound and Turn sound off remain available. Unsupported, suspended, or denied playback leaves a visible explanation and actionable alert. Sound permission is local to the shared workspace layout. It survives navigation between Devices, Team, Triggers, inbox, and detail, and must be enabled again after leaving that layout or reloading. No background delivery, continuous ringtone, or OS sound bypass is promised.

## Entry points

The member screens for Devices, Team, Triggers, inbox, and detail include the alert connection and sound controls. The incoming view leads the page at desktop and phone widths. It uses native links and buttons and a persistent live announcement region, without a focus trap or animation. Device, visitor, unassigned-user, and pairing screens do not subscribe.

## Wiring and compatibility

`GET /api/incidents/alerts` returns `{incidents}` using the [authoritative incident schema](../../../apps/app/src/lib/incidents.ts). The member-only read filters the current workspace, open status, and immutable recipient snapshot in SQL before its 100-row limit. It returns oldest first so a new arrival cannot displace the current alert. Other workspace members can still inspect and respond through the existing inbox without receiving an interruption. Removed members and devices cannot use this delivery endpoint. Later rule edits do not rewrite an incident's recipients.

The client reads on mount, every five seconds, and on browser focus or online events. It presents one incident at a time with the waiting count. Repeated delivery of the same ID does not mount another alert or restart its sound. Silence IDs use session storage keyed by workspace and user, survive navigation/reload, and never write shared incident state. If browser storage is unavailable, silence lasts only while the screen remains mounted. Acknowledged and terminal incidents disappear on the next successful read, stopping sound in every connected recipient client on the next successful poll, with network/render delay and browser timer throttling affecting end-to-end latency.

Failed delivery hides stale response controls, stops sound, shows reconnection status, and offers Retry alerts. Acknowledgment sends the last-read version to F-INCIDENT-RESPONSE and refreshes after a failed or conflicting command. An older in-flight delivery cannot restore a locally acknowledged alert. No in-app delivery receipt is persisted. F-ALERT-PUSH now records independent background attempts and publishes `notificationStatus` as `not-sent`, `attempting`, `accepted`, or `failed`; none describes whether this browser rendered the alert. Push reuses incident identity, recipient snapshots, status and version. F-ALERT-ESCALATE now records one durable in-app follow-up, with a separate local silence key so initial silence does not hide it. Repeated polling of a silenced follow-up does not reopen it. The same versioned acknowledgment command remains in use.

## Implementation

[Incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) owns local presentation, sound, silence, polling and response feedback. [The access shell](../../../apps/app/src/components/access/app.tsx) mounts it only for members. [The incident service](../../../apps/app/src/server/incidents.ts) owns recipient filtering, and [the route adapter](../../../apps/app/src/routes/api/incidents/$.ts) exposes the delivery read beside existing commands. No second notification store or command path is introduced.

The [original alarm asset](../../../apps/app/public/sounds/incident-alert.wav) is created before wiring playback and can be reproduced with `node scripts/generate-incident-alert.mjs` using [the deterministic generator](../../../scripts/generate-incident-alert.mjs). The mono 44.1 kHz, 16-bit WAV has three 280 ms pulses spaced 400 ms apart, an 8 ms attack and 18 ms release, and a capped digital peak. The sound is fetched and decoded only after opt-in, then cached in the mounted screen. Test playback and incoming repeats share `playAlarm(context: AudioContext, buffer: AudioBuffer): () => void`. One playback owner disconnects the previous sound before a test or repeat and on effect cleanup. Asset-fetch and decode failures use the existing blocked-playback message and retry control.

The in-app incident consumer is implemented. Assessment and capture-to-report integration remain separate unfinished prerequisites for AI-generated events; synthetic device reports use the real incident path.

## Verification

[Complete-screen integration tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) cover connected arrival, duplicate delivery, local silence across remount, open without acknowledgment, versioned acknowledgment, remote response removal, ordered waiting incidents, blocked playback, failed delivery/retry, and conflict refresh. [Real-handler tests](../../../apps/app/tests/api/access.test.ts) use the built Worker, isolated D1 and real migrations to verify recipient and workspace boundaries, device/member denial, duplicate report delivery, immutable recipients, shared ownership, and removal after acknowledgment.

`pnpm verify` passed locally with 36 UI integration tests and 19 API integration tests. Contained Chromium QA used the production Worker, isolated D1 and real reports with two operator sessions. It verified context, duplicate delivery, local silence, opening without acknowledgment, cross-session acknowledgment, keyboard Enter, and 390/320-pixel layouts without overflow. Temporary HTTP interceptions verified 503/retry and 409/refresh paths. A real Web Audio analyser measured a nonzero chime signal and no further oscillator starts after sound-off, silence or shared acknowledgment. Physical speaker output was not perceptually assessed. The final build repeated arrival, deduplication, keyboard silence and mobile checks after copy refinements; the PR records both tested builds, screenshots and video attachments.

The [sound browser integration tests](../../../tests/e2e/alert-sound.spec.ts) exercise the production app with HTTP-only principal and incident fixtures, real Web Audio and the real sound asset. They verify the three-pulse waveform, opt-in, test, sound-off, local silence, unavailable asset and retry. Run them after building with `pnpm exec playwright test tests/e2e/alert-sound.spec.ts`. The current sound-change PR records its executed checks and contained manual QA evidence; the earlier chime measurements above describe the prior sound. Physical speaker perception still requires a listener.

The follow-up PR adds complete-screen coverage for re-alerting an initially silenced incident and keeping a repeatedly delivered follow-up silenced. Production-build journey QA and per-run evidence are recorded in that PR.

## Decisions and sources

The current routing PR moves member dashboard pages under one persistent layout at Arsa’s request. Incoming alerts stay in that layout, preserving connection and sound state across child-route navigation. Polling cadence, recipient checks, local silence, and acknowledgment semantics remain unchanged.

[Issue #23](https://github.com/KenEzekiel/lookout-ai/issues/23), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

The incoming-alert implementation's synthesis decision is recipient-filtered polling over the existing incident service. The inbox and commands already use polling and version checks, so a second event transport or durable delivery framework would add another ownership path. A focused incoming view keeps context and controls readable without interrupting keyboard focus. Local silence belongs to the browser session, while acknowledgment belongs to shared incident state.

[Sound revision issue #68](https://github.com/KenEzekiel/lookout-ai/issues/68) records Kenneth's request for an incident-appropriate alert. The current PR replaces the soft rising chime with the original three-pulse alarm. A static generated WAV makes the exact sound reviewable and gives test and incoming playback identical audio; we accept one small asset fetch on opt-in. Continuing procedural oscillator synthesis would avoid that fetch but would require a separately rendered review artifact and could let the reviewed sound drift from playback. The six-second interval, opt-in, local silence and shared response contracts remain unchanged.

## Open questions

The delivery window is bounded to 100 open eligible incidents and has no pagination. Sound opt-in resets when the shared workspace layout unmounts or the page reloads. F-ALERT-PUSH owns the separate best-effort background path. Durable in-app follow-up scheduling is connected through F-ALERT-ESCALATE. Native calls, background guarantees, and persisted in-app delivery receipts remain outside this slice.
