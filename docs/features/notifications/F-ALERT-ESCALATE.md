# F-ALERT-ESCALATE: Sequential acknowledgment-based escalation

Status: implemented

Depends on: F-RULE-CONFIG, F-INCIDENT-RESPONSE, F-ALERT-INAPP

## Behavior

Level 1 receives the incident immediately. Each non-final level waits its configured 1–3600 whole seconds for acknowledgment, then activates the next level only while the incident remains open. A rule contains one to six levels, each with one to twenty distinct workspace recipients. The final level has no timeout. Any authorized acknowledgment, dismissal or resolution stops pending levels. Opening and local silence do not acknowledge.

Each activated level gets a full window from its persisted activation time, including after delayed alarm recovery. Earlier recipients retain response access. Final-level activation leaves the incident open without repeating the chain. Removed members cannot receive alerts; an empty surviving recipient group still follows its snapshotted timeout. Rule edits never rewrite an existing incident policy.

Publication means eligibility for in-app delivery, not browser display or human receipt. Background escalation push, calls, SMS and email are outside this feature. Initial background push remains F-ALERT-PUSH.

## Entry points

Configure ordered levels in the trigger editor. Each level selects recipients; adding a level gives the previous final level a default 60-second window. The final level has no timeout field. Incident detail shows per-level activation and cancellation, the next deadline and exhaustion. Incoming alerts use a distinct delivery identity per activated level and recipient.

## Wiring and compatibility

[IncidentFollowUp](../../../apps/app/src/server/incident-follow-up.ts) retains one Durable Object per incident. Durable creation intent and a prearmed recovery alarm protect incident insertion. D1 stores the immutable policy snapshot, activation timestamps and next deadline in the incident row. A conditional SQL update activates exactly one next level, appends its timeline entry and calculates its new deadline atomically. It does not change the response command version. Response and activation serialize at the D1 write boundary; no activation commits after acknowledgment commits. Failures rearm the alarm for 30 seconds later.

[Alert reads](../../../apps/app/src/server/incidents.ts) filter workspace membership and activated-level recipient eligibility before the existing 100-incident limit. They return the newest eligible deliveryLevel for that recipient, separately from overall progression. Level 1 keeps the incident ID silence key; level 2 keeps the legacy follow-up key; later levels use incident ID plus level ordinal. This preserves old local silence and lets later levels interrupt overlapping recipients once.

[Migration](../../../apps/app/migrations/0007_escalation_levels.sql) converts old rules and incident snapshots into two levels with identical recipients, preserving the initial alert and former follow-up. Pending deadlines remain unchanged. Attempted follow-ups become already-activated level 2 with no remaining deadline; historically unscheduled incidents stay unscheduled. Existing alarm object identities and durable intent format remain unchanged. Server and client schema changes must roll out together; an already-open old configuration editor must reload before saving.

The existing followUp response remains a compatibility summary for incoming presentation and prior incident consumers. escalationActivations, escalationDueAt and recipient-specific deliveryLevel carry multi-level progression. There is one scheduler and publication path.

## Implementation

[Rule schema](../../../apps/app/src/lib/rules.ts), [assignment validation](../../../apps/app/src/server/rules.ts), [member removal](../../../apps/app/src/server/workspaces.ts), [trigger editor](../../../apps/app/src/components/rules/editor.tsx), [incident schema](../../../apps/app/src/lib/incidents.ts), [D1 schema](../../../apps/app/src/server/schema.ts), [durable scheduler](../../../apps/app/src/server/incident-follow-up.ts), [incident reads](../../../apps/app/src/server/incidents.ts), [incoming alerts](../../../apps/app/src/components/incidents/incoming-alerts.tsx) and [detail](../../../apps/app/src/components/incidents/workspace.tsx) implement the connected path. Production-build Chromium verification completed the editor, escalation and acknowledgment journey with isolated real D1 and alarms.

## Verification

[Worker/D1 integration tests](../../../apps/app/tests/api/access.test.ts) cover sequential activation, full windows after late dispatch, distinct recipients, duplicate dispatch, final-level exhaustion, earlier-recipient acknowledgment, membership removal, migration, response races, creation recovery, real alarms after eviction and database failures. [Editor tests](../../../apps/app/tests/integration/rules.test.tsx), [alert tests](../../../apps/app/tests/integration/incoming-alerts.test.tsx) and [detail tests](../../../apps/app/tests/integration/incidents.test.tsx) exercise the consumer contract through real UI components and HTTP-boundary fixtures.

Run `pnpm verify` and the contained production-build journey in [verification](../../verification.md). The current implementation passed pnpm verify with 86 UI and 73 API integration tests. Contained Chromium QA verified validation recovery, three-level persistence, removal and focus restoration, closed-page progression, distinct recipients, later-level silence identity, acknowledgment cancellation beyond the deadline, and 320/390-pixel layouts. The 320-pixel detail check exposed recipient-ID wrapping; the fix and full journey recheck passed. Current-run captures and tested build identity belong in the PR. Production alarm operation remains a separate environment check.

## Decisions and sources

[Issue #87](https://github.com/KenEzekiel/lookout-ai/issues/87) records Ken's sequential-level requirement and the approved scope. This supersedes the single-follow-up behavior from [issue #25](https://github.com/KenEzekiel/lookout-ai/issues/25). The implementation extends the existing incident-owned Durable Object and atomic D1 publication rather than introducing another queue or browser timer. Activation timestamps share the incident row so progression, response status and timeline remain one database transaction.

## Open questions

Production environment validation remains unverified. Per-level background push needs its own provider idempotency and receipt contract and is excluded.
