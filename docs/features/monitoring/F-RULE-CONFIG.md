# F-RULE-CONFIG: Rules, assignments, and recipients

Status: partial

Depends on: F-AUTH-ACCESS

## Behavior

Workspace owners and operators create named camera or replay sources, then create fall/crash template triggers or custom observable descriptions. Each trigger selects one source, warning/critical severity, current workspace recipients, and one escalation delay. The owner is the default recipient. Duration is optional and never imposed on falls or crashes. Duration and escalation delay accept whole seconds from 1 to 3600.

Triggers save enabled or disabled. Every edit, disable, or re-enable increments the version. A stale edit cannot overwrite another save. Invalid conditions, cross-workspace sources, and unauthorized recipients reject the entire save. Removing an operator disables and version-bumps every rule naming that recipient in the same D1 transaction.

Source type, template, source assignment, and severity use the existing [shadcn Select](../../../apps/app/src/components/ui/select.tsx) built on Base UI. Controls display human-readable labels, submit the existing values, and support keyboard selection, Escape dismissal, and focus return. Native browser dropdowns are replaced; source and rule API contracts are unchanged.

## Entry points

Members open `/triggers` from the shared navigation. Add a named source, choose **New trigger**, review recipients, and save. Cards expose edit and disable. **Reload triggers** retrieves current configuration after a conflict. Paired browsers open `/monitor` to inspect source labels and received trigger versions.

## Wiring and compatibility

F-AUTH-ACCESS `member` protects operator reads and writes. `monitoringDevice` protects device reads, including revocation on every request. Workspace IDs come from the principal, never the request body. All paired devices in a workspace receive its sources and rules; other workspaces cannot. Per-source device access remains deferred by the accepted access decision.

[Shared contract](../../../apps/app/src/lib/rules.ts) owns `sourceSchema`, `ruleInputSchema`, `ruleSchema`, and `deviceConfigurationSchema`. A rule has `id`, `sourceId`, `version`, `enabled`, and `definition`. The definition owns `name`, a template/custom condition, nullable `durationSeconds`, `severity`, `recipientIds`, and `escalationDelaySeconds`. `conditionText` resolves template text. Downstream callers import this contract instead of inventing a second format.

`GET /api/config/operator` returns sources, rules, and current recipient choices. `GET /api/config/device` returns sources and rules without the member directory. Device snapshots include disabled rules and their versions so clients can stop obsolete work. The device UI refreshes every five seconds and on request, and hides configuration on access or transport failure. Receiving a version does not acknowledge application by a capture or assessment loop.

`POST /api/config/sources` creates source metadata. `POST /api/config/rules/create` saves a validated definition. `POST /api/config/rules/update` requires the last-read `id` and `version`. `POST /api/config/rules/disable` requires the same version pair. All mutations use the existing same-origin boundary. Membership validation and the rule write happen in one SQL statement.

Local capture now exists at `/device`, but connecting its capture identity to configured source IDs remains unimplemented. Relay authorization, assessment, incident submission, notifications, and escalation execution remain planned consumers. They must use the source/rule IDs and current versions, respect disabled rules, and derive recipients from stored configuration. Stale incident-report rejection belongs to the incident endpoint when implemented. Saving settings does not send an alert or start capture.

## Implementation

[Shared schemas](../../../apps/app/src/lib/rules.ts), [configuration handlers](../../../apps/app/src/server/rules.ts), [route adapter](../../../apps/app/src/routes/api/config/$.ts), [D1 schema](../../../apps/app/src/server/schema.ts), and [migration](../../../apps/app/migrations/0002_rule_configuration.sql) implement storage and delivery. [Workspace operations](../../../apps/app/src/server/workspaces.ts) disable rules when recipients leave.

[Trigger route](../../../apps/app/src/routes/triggers.tsx), [workspace screen](../../../apps/app/src/components/rules/workspace.tsx), [editor and summaries](../../../apps/app/src/components/rules/editor.tsx), and [device screen](../../../apps/app/src/components/access/monitor.tsx) connect the operator-to-device configuration journey. Connecting local capture to configured sources and downstream execution remain unimplemented, so status stays partial.

## Verification

The Horizon shell merge preserves the Triggers destination, device configuration polling, and denial behavior. New form consumers provide action-specific pending labels. The route integration suite covers navigation from Devices to Triggers and Team with one active destination. Production-build QA created a source and fall trigger through the merged shell, then verified the received enabled version in device mode at 390 pixels without overflow or page errors. [Merged Triggers screen](https://github.com/user-attachments/assets/c9de9b10-a3f1-4d4c-a53c-c35a7879efa4) and [mobile device configuration](https://github.com/user-attachments/assets/05ff7f7d-56ec-4005-aa6d-320fb8c32434) show the integration.

[API integration tests](../../../apps/app/tests/api/access.test.ts) call the production Worker with isolated D1 storage and real migrations. They cover template/custom persistence, source isolation, recipient validation without partial saves, concurrent edits, disabled-version delivery, device revocation, operator permissions, and recipient removal.

[UI integration tests](../../../apps/app/tests/integration/rules.test.tsx) drive complete routes through MSW HTTP boundaries. They cover template/custom creation, edit/disable/reload, source setup, empty/error states, preserved drafts, recipient validation, and device configuration denial. Both suites run in `pnpm verify`.

Production-build Chromium QA used separate owner/device sessions and real local D1 without HTTP mocks. It verified fall/crash/custom creation, reload persistence, recipient-validation recovery, automatic edit/disable version delivery, revocation, keyboard navigation, and a 390-pixel layout without horizontal overflow. The existing capture station remained accessible. No page errors or failed network requests were observed. [Saved templates](https://github.com/user-attachments/assets/f25c8a7a-dfe2-4629-8654-d069a6d8ee3e), [recipient validation](https://github.com/user-attachments/assets/e4524e89-10a4-425f-8708-7dbd5e87cc96), [device versions](https://github.com/user-attachments/assets/dfb19e27-aad5-416c-803c-21980bc4907c), and [mobile editor](https://github.com/user-attachments/assets/bb0bbabe-0c02-4f5d-a3db-fd13d0250654) record the observed states. The PR identifies the tested revision. Saved source/rule settings do not establish capture, alert delivery, or stale incident-report rejection.

Dropdown integration tests exercise real shadcn controls, submitted values, readable labels, keyboard selection, Escape dismissal, and focus return. They mount the full router document at `document` so portal focus events use the production root structure. Production-build browser verification covers saved source/severity values, validation recovery, and 320px/390px layouts, including long source labels. Run `pnpm verify`; per-run captures and observations belong in the PR.

## Decisions and sources

[Issue #18](https://github.com/KenEzekiel/lookout-ai/issues/18), [product direction](../../../PRD.md), [accepted workspace-wide device access](../../../PRD.md#demo-accounts-and-device-access), [experience design](../../architecture/design.md), and [visual design](../../../DESIGN.md).

The current PR introduces this configuration contract. Synthesis decision: keep sources and rules in D1 and share one Zod definition across forms, handlers, and consumers. Store the definition as JSON instead of duplicating condition variants across relational columns. A single write checks source/recipient membership, and optimistic versions reject concurrent overwrites. Poll complete snapshots for the demo rather than adding a push transport. Escalation settings describe one follow-up to the same recipients; executing that policy remains F-ALERT-ESCALATE.

The current interface-refinement PR follows Ken's request to use shadcn in-app dropdowns. No new component dependency or backend contract is introduced.

## Open questions

Connect capture, assessment, relay authorization, incident reports, alerts, and escalation to the published contract. Device application acknowledgments and production deployment remain unverified. No fixed sampling rate is agreed. Source renaming/deletion and per-device assignments are outside this slice.
