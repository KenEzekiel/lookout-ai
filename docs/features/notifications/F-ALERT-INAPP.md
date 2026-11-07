# F-ALERT-INAPP: Incoming alerts and monitor response

Status: implemented

Depends on: F-INCIDENT-RESPONSE

## Behavior

An open operator client shows a prominent incoming alert for an open incident naming that member in its snapshotted recipients. It shows the trigger summary, source, event time, severity, and pending evidence before a clip exists. Open incident navigates to detail and silences locally. Silence here hides only that incident in the current browser tab. Neither action acknowledges it. Acknowledge alert uses the existing versioned command and records shared ownership.

Sound starts off. Enable sound and test requests browser playback and plays a two-tone chime. While enabled, the current incoming incident chimes every six seconds until silenced, opened, acknowledged, superseded by shared state, or disconnected. Test sound and Turn sound off remain available. Unsupported, suspended, or denied playback leaves a visible explanation and actionable alert. Sound permission is local to the mounted screen and must be enabled again after navigation or reload. No background delivery, continuous ringtone, or OS sound bypass is promised.

## Entry points

The member screens for Devices, Team, Triggers, inbox, and detail include the alert connection and sound controls. The incoming view leads the page at desktop and phone widths. It uses native links and buttons and a persistent live announcement region, without a focus trap or animation. Device, visitor, unassigned-user, and pairing screens do not subscribe.

## Wiring and compatibility

`GET /api/incidents/alerts` returns `{incidents}` using the [authoritative incident schema](../../../apps/app/src/lib/incidents.ts). The member-only read filters the current workspace, open status, and immutable recipient snapshot in SQL before its 100-row limit. It returns oldest first so a new arrival cannot displace the current alert. Other workspace members can still inspect and respond through the existing inbox without receiving an interruption. Removed members and devices cannot use this delivery endpoint. Later rule edits do not rewrite an incident's recipients.

The client reads on mount, every five seconds, and on browser focus or online events. It presents one incident at a time with the waiting count. Repeated delivery of the same ID does not mount another alert or restart its sound. Silence IDs use session storage keyed by workspace and user, survive navigation/reload, and never write shared incident state. If browser storage is unavailable, silence lasts only while the screen remains mounted. Acknowledged and terminal incidents disappear on the next successful read, stopping sound in every connected recipient client on the next successful poll, with network/render delay and browser timer throttling affecting end-to-end latency.

Failed delivery hides stale response controls, stops sound, shows reconnection status, and offers Retry alerts. Acknowledgment sends the last-read version to F-INCIDENT-RESPONSE and refreshes after a failed or conflicting command. An older in-flight delivery cannot restore a locally acknowledged alert. No delivery receipt is persisted; `notificationStatus: not-sent` remains the background-notification placeholder and does not describe whether this browser rendered the alert. F-ALERT-PUSH and F-ALERT-ESCALATE can reuse incident identity, recipient snapshots, status and version; they remain unimplemented.

## Implementation

[Incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) owns local presentation, sound, silence, polling and response feedback. [The access shell](../../../apps/app/src/components/access/app.tsx) mounts it only for members. [The incident service](../../../apps/app/src/server/incidents.ts) owns recipient filtering, and [the route adapter](../../../apps/app/src/routes/api/incidents/$.ts) exposes the delivery read beside existing commands. No second notification store or command path is introduced.

The in-app incident consumer is implemented. Assessment and capture-to-report integration remain separate unfinished prerequisites for AI-generated events; synthetic device reports use the real incident path.

## Verification

[Complete-screen integration tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) cover connected arrival, duplicate delivery, local silence across remount, open without acknowledgment, versioned acknowledgment, remote response removal, ordered waiting incidents, blocked playback, failed delivery/retry, and conflict refresh. [Real-handler tests](../../../apps/app/tests/api/access.test.ts) use the built Worker, isolated D1 and real migrations to verify recipient and workspace boundaries, device/member denial, duplicate report delivery, immutable recipients, shared ownership, and removal after acknowledgment.

`pnpm verify` passed locally with 36 UI integration tests and 19 API integration tests. Contained Chromium QA used the production Worker, isolated D1 and real reports with two operator sessions. It verified context, duplicate delivery, local silence, opening without acknowledgment, cross-session acknowledgment, keyboard Enter, and 390/320-pixel layouts without overflow. Temporary HTTP interceptions verified 503/retry and 409/refresh paths. A real Web Audio analyser measured a nonzero chime signal and no further oscillator starts after sound-off, silence or shared acknowledgment. Physical speaker output was not perceptually assessed. The final build repeated arrival, deduplication, keyboard silence and mobile checks after copy refinements; the PR records both tested builds, screenshots and video attachments.

## Decisions and sources

[Issue #23](https://github.com/KenEzekiel/lookout-ai/issues/23), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

The current PR's synthesis decision is recipient-filtered polling over the existing incident service. The inbox and commands already use polling and version checks, so a second event transport or durable delivery framework would add another ownership path. A focused incoming view keeps context and controls readable without interrupting keyboard focus. Local silence belongs to the browser session, while acknowledgment belongs to shared incident state.

## Open questions

The delivery window is bounded to 100 open eligible incidents and has no pagination. Sound opt-in resets on screen remount. Push, escalation scheduling, native calls, background guarantees, and persisted per-client delivery receipts are outside this slice.
