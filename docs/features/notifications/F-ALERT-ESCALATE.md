# F-ALERT-ESCALATE: One durable follow-up

Status: implemented

Depends on: F-RULE-CONFIG, F-INCIDENT-RESPONSE, F-ALERT-INAPP

## Behavior

A new incident schedules one in-app follow-up to its snapshotted recipients after the rule's delay of 1 to 3600 whole seconds from server receipt. Scheduling and publication continue without operator clients. Acknowledge, dismiss, and resolve stop pending follow-up. Opening and silencing do not change shared status.

The incident detail shows scheduled, cancelled, or attempted follow-up separately from human ownership. An attempt records publication for recipient-scoped in-app delivery, not proof that a browser rendered it or a person saw it. An attempted follow-up reopens the incoming alert once, including after the initial alert was locally silenced. Silencing that follow-up survives repeated polling and reload. Already published notifications may arrive after acknowledgment; no new attempt commits after acknowledgment commits.

## Entry points

Configure the delay and recipients with the rule. Device reports use the existing incident endpoint. Inspect follow-up state in incident detail and acknowledge through either incoming alert or detail. No public dispatch endpoint or policy builder is added.

## Wiring and compatibility

[The report adapter](../../../apps/app/src/server/incidents.ts) authenticates the device and calls the incident's Durable Object before inserting. [IncidentFollowUp](../../../apps/app/src/server/incident-follow-up.ts) durably saves the creation intent and arms a recovery alarm before the D1 write. The insert keeps the existing source, session, rule-version and revocation guards, and saves the due time with the authoritative rule snapshot in the same statement. It then moves the alarm to that due time. The short creation operation blocks other object events while coordinating the two stores. Recovery replays the idempotent insertion from durable intent if interrupted. Duplicate reports retain the existing device/session/event/rule key; a losing object's alarm is removed.

The alarm consults D1 and publishes only while the incident is open, due and never attempted. One conditional SQL statement records the attempt timestamp and timeline entry. The same persisted timestamp identifies the follow-up in existing recipient-scoped alert reads. No external provider is called and no browser timer owns scheduling. A competing response and publication serialize at the D1 write boundary. Follow-up publication does not increment the operator command version, so a timer alone cannot invalidate acknowledgment. Acknowledgment's status commit logically cancels pending work; a later alarm observes it and removes itself.

Alarm failures retain the pending state and durably rearm for 30 seconds later. Repeated delivery cannot append a second attempt. [The shared incident schema](../../../apps/app/src/lib/incidents.ts) exposes `followUp` as none, scheduled with dueAt, cancelled with dueAt, or attempted with dueAt and attemptedAt. Existing incidents with no due time remain unscheduled; the migration does not page historical incidents. The separate `notificationStatus` field preserves F-ALERT-PUSH provider state as not-sent, attempting, accepted or failed. It does not describe in-app follow-up publication or operator acknowledgment.

F-ALERT-INAPP uses incident ID for the initial alert and incident ID plus the follow-up suffix for the one follow-up. Its local silence remains independent of shared ownership. Existing workspace/member authorization, immutable recipient filtering, five-second polling and sound opt-in remain in effect. F-ALERT-PUSH now provides the separate initial background delivery path; future external follow-up delivery needs its own idempotency contract and cannot treat the in-app timestamp as a provider receipt.

## Implementation

[Durable alarm and incident insertion](../../../apps/app/src/server/incident-follow-up.ts), [Worker export](../../../apps/app/src/server.ts), and [binding/migration configuration](../../../apps/app/wrangler.jsonc) own scheduling. The Durable Object binding is explicit in both local and production environments because bindings do not inherit across environments. [D1 columns](../../../apps/app/src/server/schema.ts) and [migration](../../../apps/app/migrations/0005_incident_follow_up.sql) store due and attempted times. [Incident reads](../../../apps/app/src/server/incidents.ts) derive cancellation from shared status. [Detail](../../../apps/app/src/components/incidents/workspace.tsx) and [incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) consume the state.

Implementation is connected to real device reports, recipient delivery and response commands. Capture and assessment producers remain separate unfinished work; synthetic device reports exercise the same production endpoint.

## Verification

[Runtime integration tests](../../../apps/app/tests/api/access.test.ts) use the production Worker, isolated D1, real migrations and Durable Object storage/alarms. They cover recovery of interrupted creation through a real alarm after the object resets, a naturally firing alarm after object eviction, snapshotted delay after a rule edit, repeated runtime dispatch, duplicate report delivery, response cancellation, acknowledgment racing publication, and a real D1 trigger failure followed by retry with no partial attempt. Existing report, recipient, workspace, membership, and revocation cases remain regression checks.

[Incoming full-screen integration tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) cover the fresh follow-up after local silence and deduplication after silencing the follow-up. [Detail integration tests](../../../apps/app/tests/integration/incidents.test.tsx) cover scheduled/cancelled copy and distinguish an attempted notification from ownership. Run `pnpm verify` and the production-build browser journey in [the verification guide](../../verification.md). Contained Chromium QA exercised an unacknowledged synthetic incident with the operator page closed across its deadline, one follow-up after reopening, duplicate report delivery, silence across reload/polling, keyboard acknowledgment before another deadline, cancellation after the deadline, resolution, and 390/320-pixel layouts without overflow. It used the production Worker, real alarms and isolated D1 without HTTP mocks. No browser errors or failed requests were observed. Repeated runtime dispatch and failure injection remain automated coverage. The PR contains per-run build identity, screenshots and video attachments.

## Decisions and sources

[Issue #25](https://github.com/KenEzekiel/lookout-ai/issues/25), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [Cloudflare alarm semantics](https://developers.cloudflare.com/durable-objects/api/alarms/) define the requirement and runtime boundary. The current PR introduces this implementation.

Synthesis decision: one SQLite-backed Durable Object per incident owns wakeup and recovery; the existing D1 incident owns shared status, policy and publication. The caller only submits the existing report and reads the incident. A browser timer would lose work when clients close. A D1-only due queue with a minute cron would add global scanning and coarse timing to a seconds-based policy. Moving all incident reads and commands into object storage would duplicate the existing authorization/read model. The selected design keeps those public interfaces and concentrates alarm recovery in one server class.

The accepted tradeoff is cross-store coordination during incident creation. Durable intent, a prearmed recovery alarm and idempotent insertion cover interruption before final scheduling. In-app publication is atomic because it is a D1 state change. This does not promise exactly-once external push or perceptual receipt. No broader provider framework is introduced.

## Open questions

Production deployment and remote alarm operation need environment validation. Background follow-up push and native calls remain outside this slice. Initial background push remains owned by F-ALERT-PUSH and is preserved by the report adapter. Capture and AI assessment producers remain incomplete prerequisites for non-synthetic events.
