# F-INCIDENT-RESPONSE: Incident ownership and response

Status: partial

Depends on: F-AUTH-ACCESS, F-RULE-CONFIG

## Behavior

Inbox/detail reload and acknowledge, resolve, and dismiss actions use shared default sizing with descriptive icons and visible labels. Decorative icons do not change the accessible action names.

Inbox and detail first reads use layout-shaped skeletons. Manual reloads keep existing content visible with a busy button. Response buttons identify the active acknowledgment, resolution, or dismissal and disable conflicting responses until completion. Evidence preparation remains independent of response controls.

An accepted device report persists one workspace incident with event time, source and rule snapshots, severity, configured recipients, owner, and timeline. Evidence starts preparing and can become uploading, ready, or unavailable through F-EVIDENCE-REPLAY. F-ALERT-PUSH records independent initial background-notification attempts. Operators can respond before a saved clip exists.

Acknowledge changes open to acknowledged and records the responding member as owner. Resolve changes acknowledged to resolved. Dismiss changes open or acknowledged to dismissed and records incorrect-alert feedback. Dismissed and resolved are distinct terminal states. Opening an incident changes nothing. Every response requires the last-read version, increments it, and appends one timeline entry atomically. Any current workspace member can respond, including resolving a colleague's acknowledged incident. Ownership is preserved after resolution or dismissal.

Response buttons, confirmation dialogs, and newly shown errors use the shared interaction motion styles. Motion is presentation only: response commands and ownership updates do not wait for it, and reduced motion disables transitions. Existing labels and status colors remain the persistent feedback.

## Entry points

Members open **Incidents** in shared navigation, then select an inbox row. `/incidents` shows up to 100 incidents with open and acknowledged responses first. `/incidents/$incidentId` shows context, evidence availability, ownership, and response actions. Both refresh every five seconds and offer explicit reload. Failed reads hide the data and response controls. Conflicting commands show an error and require current state before another successful response.

Devices use the HTTP endpoints below. There is no production synthetic-event button. F-ALERT-INAPP consumes incident reads and commands for incoming response. Scene-clear observations remain unconnected and never auto-resolve an incident; evidence changes do not alter response state.

## Wiring and compatibility

Custom incident definitions may carry optional exclusions. The shared rule schema preserves them in immutable incident snapshots, and the incident detail uses `conditionText` to show them. Older template snapshots and custom snapshots without exclusions remain readable.

F-RULE-CONFIG owns [rule, source, and recipient references](../../../apps/app/src/lib/rules.ts). Report insertion checks the current enabled rule version and matching workspace source in the same SQL statement. It snapshots that source and complete authoritative rule definition, including recipients, severity, and escalation delay. Later configuration changes do not rewrite incident context. Client-provided recipient or severity fields are rejected.

F-AUTH-ACCESS `member` protects inbox, detail, and commands. `monitoringDevice` protects session and report endpoints and checks revocation for every request. Workspace and device IDs come from the principal. Inserts recheck device revocation, and command writes recheck current membership. Devices cannot read the operator inbox or issue response commands. Cross-workspace reads and writes cannot access incidents.

`POST /api/incidents/sessions` accepts `{sourceId}` and returns `{id,sourceId,startedAt,expiresAt}`. It creates a 12-hour session for that device and source, superseding the previous session. `POST /api/incidents/sessions/end` accepts `{id}` and invalidates only that device's matching current session. Starting or ending an API session does not operate the browser camera. F-DETECT-REVIEW starts a session for each selected-source capture epoch and ends it on Stop or failure.

`POST /api/incidents/reports` accepts `{sessionId,eventId,ruleId,ruleVersion,eventTime}`. Event time is a UTC millisecond timestamp, separate from server receipt time and source media position. A new report requires a current session, current enabled rule, and a matching source. Event time can precede session start by up to 30 seconds for buffered footage and can be at most 60 seconds ahead of server receipt. Expired, ended, superseded, foreign, and stale-version reports cannot create incidents.

The idempotency key is device, session, event ID, and rule ID. The producer must reuse it for retrying delivery and repeated reports of the same event. The endpoint returns `{incident}` with 201 for insertion or 200 for an exact retry. Reusing a key with another event time or rule version returns 409. An authenticated retry can retrieve its existing incident after the rule or session changes, but cannot create another one. Revoked devices are denied even on retry. This slice does not yet enrich observations or infer ongoing-event identity across capture runs.

`GET /api/incidents/inbox` returns `{incidents}`. `GET /api/incidents/detail/:id` returns the shared incident view. `POST /api/incidents/commands/:id` accepts `{action,version}` with acknowledge, dismiss, or resolve and returns the updated incident. Unavailable or stale transitions return 409 without a write. Reads are workspace scoped. The list is bounded to 100 rows and has no pagination yet.

[Shared schemas and transitions](../../../apps/app/src/lib/incidents.ts) publish the report, receipt, incident view, and command contract for assessment, alerts, evidence, escalation, and MCP. `GET /api/incidents/alerts` now supplies F-ALERT-INAPP with open incidents addressed to the current workspace member. It uses snapshotted recipients and the same incident identity. Incoming response uses the existing versioned commands. Local open or silence never writes the incident. F-ALERT-PUSH now consumes accepted reports through [the push service](../../../apps/app/src/server/push.ts), rechecks live recipients and open status, and persists one initial attempt per incident and endpoint. The report request awaits bounded provider calls; retries reuse the attempt claim. `notificationStatus` is `not-sent`, `attempting`, `accepted`, or `failed`, with acceptance taking precedence. Accepted means a provider accepted at least one attempt, not device display. [Push integration tests](../../../apps/app/tests/api/push.test.ts) verify this shared contract against the real Worker and D1. In-app rendering still has no persisted receipt. F-ALERT-ESCALATE now arms a durable alarm during incident creation and publishes one in-app follow-up only while open. Reads expose none, scheduled, cancelled, or attempted follow-up independently of owner and push delivery. Its conditional D1 write appends an attempt without incrementing the response version, so an acknowledgment commit prevents any later publication. F-EVIDENCE-REPLAY adds an incident-owned evidence record and enriches these views without changing response versions. External-agent authentication remains unimplemented. A response never deletes capture data.

## Implementation

[Incident service](../../../apps/app/src/server/incidents.ts), [route adapter](../../../apps/app/src/routes/api/incidents/$.ts), [D1 schema](../../../apps/app/src/server/schema.ts), and [real migration](../../../apps/app/migrations/0003_incident_response.sql) implement persistence, authorization, deduplication, sessions, and versioned responses. [The durable follow-up service](../../../apps/app/src/server/incident-follow-up.ts) owns insertion with the same SQL guards and a prearmed recovery alarm; the existing report adapter retains initial push delivery.

[Inbox and detail screens](../../../apps/app/src/components/incidents/workspace.tsx), [inbox route](../../../apps/app/src/routes/_workspace.incidents.index.tsx), [detail route](../../../apps/app/src/routes/_workspace.incidents.$incidentId.tsx), and [access gate](../../../apps/app/src/components/access/app.tsx) implement operator handling. Assessment submission and capture lifecycle integration now connect through [DeviceMonitoring](../../../apps/app/src/lib/device-monitoring.ts). Status remains partial because observation enrichment and assessment-driven evidence upload are not connected. The evidence service and operator replay are implemented through F-EVIDENCE-REPLAY. One durable in-app follow-up is connected through F-ALERT-ESCALATE. In-app alerts and initial background push are connected, with target-device push verification still pending.

## Verification

[Loading journey integration tests](../../../apps/app/tests/integration/loading.test.tsx) cover delayed access, lists, configuration, navigation away, submission failure, and refresh retention. [Incident integration tests](../../../apps/app/tests/integration/incidents.test.tsx) cover pending responses and replay loading, buffering, failure, and retry. Existing feature tests remain the regression checks for this consumer. Browser observations and evidence for the current change belong in its PR.

[Real-handler API tests](../../../apps/app/tests/api/access.test.ts) use the built Worker, isolated D1, and committed migrations. The incident cases passed locally and cover concurrent retries, persisted reads, immutable source/rule context, idempotency collisions, stale or disabled rules, stale and expired sessions, invalid event times, device revocation, origin checks, workspace and membership boundaries, acknowledgment ownership, competing operators, stale commands, terminal states, and distinct dismissal.

[Complete-screen UI tests](../../../apps/app/tests/integration/incidents.test.tsx) passed locally through MSW HTTP boundaries. They cover inbox and detail loading, empty and failed reads, reload recovery, opening without acknowledgment, evidence status changes, acknowledge then resolve, dismissal, stale-action recovery, current navigation, and device exclusion.

`pnpm verify` passed after F-EVIDENCE-REPLAY and F-ALERT-PUSH integration, including UI integration tests and 35 real-handler API tests. The original [#19 PR](https://github.com/KenEzekiel/lookout-ai/pull/61) recorded interactive Chromium QA against the production Worker and isolated D1 for account creation, joining, pairing, trigger creation, duplicate synthetic delivery, persistence after refresh, two-operator ownership conflicts, reload recovery, cross-session resolution, separate dismissal, keyboard incident entry, and narrow layout. A temporary HTTP 503 interception verified inbox failure and recovery; successful report and response paths used real handlers without mocks. Evidence replay QA is tracked in F-EVIDENCE-REPLAY.

## Decisions and sources

Kenneth requested button consistency and action icons. [Incident controls](../../../apps/app/src/components/incidents/workspace.tsx) use F-APP-SHELL Button sizing and explicit icons. Response transitions, version checks, and permissions remain unchanged.

The current PR implements the user’s request for app-wide loading feedback. It reuses [shared loading UI](../../../apps/app/src/components/ui/loading.tsx) and [busy buttons](../../../apps/app/src/components/ui/button.tsx) without changing backend contracts or unfinished feature status.

[Issue #19](https://github.com/KenEzekiel/lookout-ai/issues/19), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

The #19 PR introduced this contract. Synthesis decision: reuse D1 and the configuration schemas, store immutable context and the short timeline as JSON, and update response state and timeline in one version-checked SQL statement. This avoids a second rule format and a separate event framework. Sessions provide server-verifiable freshness independently of the unfinished assessment loop. Schema variants require an owner for acknowledged and resolved states. Polling fits the demo's shared-state requirement without another transport.

## Open questions

Local capture runs and assessment now connect to session start/end and stable report retries. The producer retains the approximate source interval locally; the existing report contract still persists only event time. Integrate observation enrichment and assessment-driven private evidence against the published incident identity and version. Incoming alerts are connected through F-ALERT-INAPP. Long-lived capture needs a new session after the 12-hour lease. No session-renewal endpoint, incident pagination, reopening, or reassignment is included. Feedback does not imply automatic retraining.
