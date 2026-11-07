# F-INCIDENT-RESPONSE: Incident ownership and response

Status: partial

Depends on: F-AUTH-ACCESS, F-RULE-CONFIG

## Behavior

An accepted device report persists one workspace incident with event time, source and rule snapshots, severity, configured recipients, owner, and timeline. Evidence remains pending. F-ALERT-PUSH now records independent initial background-notification attempts. Operators can respond before a saved clip exists.

Acknowledge changes open to acknowledged and records the responding member as owner. Resolve changes acknowledged to resolved. Dismiss changes open or acknowledged to dismissed and records incorrect-alert feedback. Dismissed and resolved are distinct terminal states. Opening an incident changes nothing. Every response requires the last-read version, increments it, and appends one timeline entry atomically. Any current workspace member can respond, including resolving a colleague's acknowledged incident. Ownership is preserved after resolution or dismissal.

## Entry points

Members open **Incidents** in shared navigation, then select an inbox row. `/incidents` shows up to 100 incidents with open and acknowledged responses first. `/incidents/$incidentId` shows context, evidence availability, ownership, and response actions. Both refresh every five seconds and offer explicit reload. Failed reads hide the data and response controls. Conflicting commands show an error and require current state before another successful response.

Devices use the HTTP endpoints below. There is no production synthetic-event button. F-ALERT-INAPP now consumes incident reads and commands for incoming response; scene-clear observations and evidence updates remain unconnected and never auto-resolve an incident.

## Wiring and compatibility

Custom incident definitions may carry optional exclusions. The shared rule schema preserves them in immutable incident snapshots, and the incident detail uses `conditionText` to show them. Older template snapshots and custom snapshots without exclusions remain readable.

F-RULE-CONFIG owns [rule, source, and recipient references](../../../apps/app/src/lib/rules.ts). Report insertion checks the current enabled rule version and matching workspace source in the same SQL statement. It snapshots that source and complete authoritative rule definition, including recipients, severity, and escalation delay. Later configuration changes do not rewrite incident context. Client-provided recipient or severity fields are rejected.

F-AUTH-ACCESS `member` protects inbox, detail, and commands. `monitoringDevice` protects session and report endpoints and checks revocation for every request. Workspace and device IDs come from the principal. Inserts recheck device revocation, and command writes recheck current membership. Devices cannot read the operator inbox or issue response commands. Cross-workspace reads and writes cannot access incidents.

`POST /api/incidents/sessions` accepts `{sourceId}` and returns `{id,sourceId,startedAt,expiresAt}`. It creates a 12-hour session for that device and source, superseding the previous session. `POST /api/incidents/sessions/end` accepts `{id}` and invalidates only that device's matching current session. Starting or ending an API session does not operate the browser camera. The assessment producer must start a session for each capture run and end it on Stop. This connection to local capture remains missing.

`POST /api/incidents/reports` accepts `{sessionId,eventId,ruleId,ruleVersion,eventTime}`. Event time is a UTC millisecond timestamp, separate from server receipt time and source media position. A new report requires a current session, current enabled rule, and a matching source. Event time can precede session start by up to 30 seconds for buffered footage and can be at most 60 seconds ahead of server receipt. Expired, ended, superseded, foreign, and stale-version reports cannot create incidents.

The idempotency key is device, session, event ID, and rule ID. The producer must reuse it for retrying delivery and repeated reports of the same event. The endpoint returns `{incident}` with 201 for insertion or 200 for an exact retry. Reusing a key with another event time or rule version returns 409. An authenticated retry can retrieve its existing incident after the rule or session changes, but cannot create another one. Revoked devices are denied even on retry. This slice does not yet enrich observations or infer ongoing-event identity across capture runs.

`GET /api/incidents/inbox` returns `{incidents}`. `GET /api/incidents/detail/:id` returns the shared incident view. `POST /api/incidents/commands/:id` accepts `{action,version}` with acknowledge, dismiss, or resolve and returns the updated incident. Unavailable or stale transitions return 409 without a write. Reads are workspace scoped. The list is bounded to 100 rows and has no pagination yet.

[Shared schemas and transitions](../../../apps/app/src/lib/incidents.ts) publish the report, receipt, incident view, and command contract for assessment, alerts, evidence, escalation, and MCP. `GET /api/incidents/alerts` now supplies F-ALERT-INAPP with open incidents addressed to the current workspace member. It uses snapshotted recipients and the same incident identity. Incoming response uses the existing versioned commands. Local open or silence never writes the incident. F-ALERT-PUSH now consumes accepted reports through [the push service](../../../apps/app/src/server/push.ts), rechecks live recipients and open status, and persists one initial attempt per incident and endpoint. The report request awaits bounded provider calls; retries reuse the attempt claim. `notificationStatus` is `not-sent`, `attempting`, `accepted`, or `failed`, with acceptance taking precedence. Accepted means a provider accepted at least one attempt, not device display. [Push integration tests](../../../apps/app/tests/api/push.test.ts) verify this shared contract against the real Worker and D1. In-app rendering still has no persisted receipt. Evidence upload, scheduling, and external-agent authentication remain unimplemented. Future paging must consult incident status so acknowledgment or a terminal response prevents new attempts. A response never deletes capture data.

## Implementation

[Incident service](../../../apps/app/src/server/incidents.ts), [route adapter](../../../apps/app/src/routes/api/incidents/$.ts), [D1 schema](../../../apps/app/src/server/schema.ts), and [real migration](../../../apps/app/migrations/0003_incident_response.sql) implement persistence, authorization, deduplication, sessions, and versioned responses.

[Inbox and detail screens](../../../apps/app/src/components/incidents/workspace.tsx), [inbox route](../../../apps/app/src/routes/incidents.index.tsx), [detail route](../../../apps/app/src/routes/incidents.$incidentId.tsx), and [access gate](../../../apps/app/src/components/access/app.tsx) implement operator handling. Status remains partial because assessment submission, capture lifecycle integration, observation enrichment, evidence, and escalation consumers are not connected. In-app alerts and initial background push are connected, with target-device push verification still pending.

## Verification

[Real-handler API tests](../../../apps/app/tests/api/access.test.ts) use the built Worker, isolated D1, and committed migrations. The incident cases passed locally and cover concurrent retries, persisted reads, immutable source/rule context, idempotency collisions, stale or disabled rules, stale and expired sessions, invalid event times, device revocation, origin checks, workspace and membership boundaries, acknowledgment ownership, competing operators, stale commands, terminal states, and distinct dismissal.

[Complete-screen UI tests](../../../apps/app/tests/integration/incidents.test.tsx) passed locally through MSW HTTP boundaries. They cover inbox and detail loading, empty and failed reads, reload recovery, opening without acknowledgment, pending evidence, acknowledge then resolve, dismissal, stale-action recovery, current navigation, and device exclusion.

`pnpm verify` passed with 28 UI integration tests and 18 real-handler API tests. Interactive Chromium QA against the production Worker and isolated D1 exercised account creation, joining, pairing, trigger creation, empty inbox, duplicate synthetic delivery, persistence after refresh, two-operator ownership conflicts, reload recovery, cross-session resolution, separate dismissal, keyboard incident entry, and a 390-pixel mobile layout. A temporary HTTP 503 interception verified inbox failure and recovery; successful report and response paths used real handlers without mocks. Screenshots, video, tested revision, and results are recorded in the PR.

## Decisions and sources

[Issue #19](https://github.com/KenEzekiel/lookout-ai/issues/19), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

The current PR introduces this contract. Synthesis decision: reuse D1 and the configuration schemas, store immutable context and the short timeline as JSON, and update response state and timeline in one version-checked SQL statement. This avoids a second rule format and a separate event framework. Sessions provide server-verifiable freshness independently of the unfinished assessment loop. Schema variants require an owner for acknowledged and resolved states. Polling fits the demo's shared-state requirement without another transport.

## Open questions

Connect local capture runs and assessment to session start/end and report retries. Integrate observation enrichment, private evidence, and escalation against the published incident identity and version. Incoming alerts are connected through F-ALERT-INAPP. Long-lived capture needs a new session after the 12-hour lease. No session-renewal endpoint, incident pagination, reopening, or reassignment is included. Feedback does not imply automatic retraining.
