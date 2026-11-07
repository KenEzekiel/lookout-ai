# F-DEVICE-HEALTH: Source health and configuration freshness

Status: implemented

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE, F-RULE-CONFIG, F-DETECT-REVIEW

## Behavior

Operators open Devices to inspect each paired browser's latest selected source, device and source identities, last server contact, last captured observation, last successful assessment, and assigned versus applied trigger versions. Authorization and monitoring health remain separate. A paired browser is not proof of active monitoring.

Reports run every five seconds and after capture, configuration, or assessment state changes. Contact becomes disconnected or stale at twenty seconds without a report. Running capture becomes stalled at ten seconds without a sampled observation. Assessment becomes stale at forty-five seconds without a successful result for every enabled rule. Paused, stopped, starting, failed capture, preview without an assignment, missing configuration, no enabled triggers, unavailable assessment, and degraded assessment have explicit labels. Only fresh capture, current applied configuration, and fresh successful assessment of every enabled rule produce Monitoring.

A rule mismatch stays visible until the device reports the exact current set of versions, including disabled rules. Configuration receipt on `/monitor` does not acknowledge application. Stop and configuration failure clear readiness. The existing controller supplies typed per-rule assessment state; no status is inferred from its prose notices. A failure on one rule remains degraded even when another rule succeeds.

## Entry points

`/device` reports status while the capture station is mounted. `/devices` shows Monitoring health and refreshes every five seconds, with a manual Refresh health button. The device also shows whether health reporting is connected. Closing the operator client does not stop capture or reports. Leaving the capture station stops reporting, so the last report becomes stale.

`POST /api/health/report` accepts bounded JSON metadata from paired devices. `GET /api/health/operator` returns the authenticated member's workspace devices, stored reports, authoritative assigned versions, and server time. The operator advances freshness from server time using a monotonic local clock. On health-fetch failure, the view removes previous healthy results and shows status unavailable.

## Wiring and compatibility

F-AUTH-ACCESS derives device and workspace identity from the session and rechecks revocation on every report. The write itself also excludes revoked devices. Reports cannot nominate another device or workspace. Source IDs must belong to that workspace. Members can read only their own workspace; device principals cannot read the operator endpoint. All workspace members retain the existing source-access policy.

F-SOURCE-CAPTURE owns capture state and observation timestamps. F-DETECT-REVIEW owns assessment state and the applied rule set. The health reporter consumes these states and serializes requests, so an older in-flight heartbeat cannot overwrite a subsequent Stop report from that capture station. It never samples media, invokes inference, or creates a monitoring loop. Capture epoch and selected source qualify controller state, preventing previous runs from supplying readiness during restart or source replacement.

F-RULE-CONFIG remains the assigned-version authority. Its current source rule set is compared with the controller's applied set, including disabled versions. The service stores one latest report per device, for that capture station's selected source. It does not assert coverage for unselected sources. Multiple simultaneous capture stations sharing one browser credential are not separately identified.

Health accepts no media, unknown fields, or client-supplied identity. Requests are limited to 16 KiB and one hundred distinct rule references. Contact time comes from the server. Observation and assessment times remain device-provided and require the device clock to be within five seconds ahead of the server. Reconnect updates contact without synthesizing observations. For the same source, a missing timestamp retains its prior historical value; stopped or unavailable state still prevents readiness. Source changes clear that history. Reports and reads use no-store responses. There is no report history, video storage, server monitoring fallback, or delivery guarantee for an offline browser.

## Implementation

[Shared schemas and freshness policy](../../../apps/app/src/lib/device-health.ts), [health service](../../../apps/app/src/server/device-health.ts), [route adapter](../../../apps/app/src/routes/api/health/$.ts), [D1 migration](../../../apps/app/migrations/0007_device_health.sql), and [D1 schema](../../../apps/app/src/server/schema.ts) own persistence and authorization.

[Health reporter](../../../apps/app/src/components/device-health-reporting.tsx) consumes [monitoring controls](../../../apps/app/src/components/device-monitoring.tsx) and [controller state](../../../apps/app/src/lib/device-monitoring.ts). [Operator health panel](../../../apps/app/src/components/device-health.tsx) appears within the existing [device management screen](../../../apps/app/src/components/access/workspace.tsx). The capture-to-report-to-operator journey is connected and verified in the production build with isolated storage.

## Verification

[Real Worker/D1 integration coverage](../../../apps/app/tests/api/access.test.ts) exercises reporting, last-contact persistence, stop, pause, stalled observation, stale assessment, unavailable and degraded assessment, rule edit and disable mismatch, reconnect without fabricated timestamps, workspace isolation, revocation, Origin checks, strict metadata fields, future timestamps, and payload bounds. It uses isolated local D1 with real migrations.

[Operator route integration coverage](../../../apps/app/tests/integration/device-health.test.tsx) exercises loading, empty, never-reported, assigned/applied versions, stopped, stalled, degraded, stale, reconnect, fetch failure, and revoked UI states through HTTP boundaries. [Capture route integration coverage](../../../apps/app/tests/integration/device.test.tsx) exercises metadata reporting from real capture/controller code, applied versions, Stop/restart, provider failure, and unavailable configuration. External/browser media boundaries are simulated in automated tests.

`pnpm verify` passed with 89 app integration tests, 73 real-Worker API tests, and the repository checks. Contained production-build Chromium QA used two independent browser contexts, isolated D1 with real migrations, a simulated camera, and an external inference HTTP mock. It confirmed initial monitoring, Stop with historical observation and applied version retained, restart, stale contact after blocked reports, reconnection, assigned/applied version mismatch and recovery, provider degradation and recovery, capture error, revocation, metadata-only requests, keyboard source selection and refresh, and a 390-pixel layout without horizontal overflow. A focused recheck used exact status labels to confirm every recovery transition. Temporarily removing decodable video dimensions at the browser media boundary kept contact fresh while observations stopped; the operator showed Capture stalled and recovered after sampling resumed. No unexpected page errors were observed. Screenshots and videos are recorded in the PR; live model quality and physical camera hardware were not tested by this health feature.

## Decisions and sources

The current PR follows the user-approved HTML UI study and the instruction to keep trigger descriptions plain. Monitoring health sits directly on the Devices canvas with a bottom divider instead of an enclosing card. Health reporting, staleness rules, status text and refresh behavior are unchanged. Source: [UI implementation](../../../apps/app/src/components/device-health.tsx). Existing integration journeys remain regression coverage; manual browser evidence is recorded in the PR.

[Issue #33](https://github.com/KenEzekiel/lookout-ai/issues/33), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), and [visual design](../../../DESIGN.md).

Synthesis decision introduced by this PR: store one bounded latest metadata report per device and derive freshness on read/display. Reuse the existing capture and assessment controller instead of adding another loop or service. Five-second reports, twenty-second contact freshness, ten-second capture freshness, and forty-five-second assessment freshness are explicit demo policy, not measured reliability guarantees. Typed per-rule health follows Model the Domain and Type System Discipline; it avoids coupling remote health to local prose notices.

## Open questions

Deployment must apply migration 0007 before enabling the new endpoint. No deployment was performed. Simultaneous capture stations sharing one browser credential remain outside this latest-device-report contract.
