# F-DETECT-REVIEW: Device assessment and candidate review

Status: planned

Depends on: F-SOURCE-CAPTURE, F-RULE-CONFIG, F-AI-RELAY, F-INCIDENT-RESPONSE

## Behavior

The operational device samples observations, flags a candidate, and obtains second-stage review before reporting a confirmed incident. Uncertain observations may require more evidence.

## Entry points

Start monitoring an assigned source and rule. Show assessment failures rather than implying healthy monitoring.

## Wiring and compatibility

F-RULE-CONFIG now publishes [versioned rule snapshots](../../../apps/app/src/lib/rules.ts) through `GET /api/config/device`, including disabled rules. The future device loop must stop disabled versions, use `conditionText` for template/custom text, and report `sourceId`, rule `id`, and `version`. Receiving a snapshot alone is not assessment readiness. This consumer remains unimplemented.

Use the capture session and rule version in reports. Preserve the event interval on confirmation and report before waiting for upload. Repeated observations of an ongoing event update its incident.

F-AI-RELAY provides a [transport contract](../../../apps/app/src/lib/assessment.ts). Decisions returns match and uncertainty probabilities; the device owns thresholds. Review uses GPT-6.1 Terra with medium reasoning and returns `positive`, `rejected`, or `need_more_evidence`. Transport/refusal failures remain `unavailable`, never a negative observation. The endpoint authorizes the stored source and enabled rule version from F-RULE-CONFIG. No assessment loop is wired to this helper yet. Pass the shared rule/version and source references, apply configured duration locally, and preserve capture-epoch and request context to discard late results.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Exercise positive, harmless, ambiguous, and provider-failure cases. Verify no alert before review, no duplicate incident for repeated observations, and correct timestamps. Existing fall experiments are not integrated product proof.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#21](https://github.com/KenEzekiel/lookout-ai/issues/21). Issue status is not implementation evidence.

## Open questions

The user selected GPT-6.1 Terra with medium reasoning for review in the current relay PR. Live access, quality, thresholds, cadence, and uncertainty handling remain unverified. The relay's eight-frame/30-second envelope is an input bound, not a sampling policy. Agreement between models is not proof of accuracy.
