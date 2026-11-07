# F-DETECT-REVIEW: Device assessment and candidate review

Status: planned

Depends on: F-SOURCE-CAPTURE, F-RULE-CONFIG, F-AI-RELAY, F-INCIDENT-RESPONSE

## Behavior

The operational device samples observations, flags a candidate, and obtains second-stage review before reporting a confirmed incident. Uncertain observations may require more evidence.

## Entry points

Start monitoring an assigned source and rule. Show assessment failures rather than implying healthy monitoring.

## Wiring and compatibility

Use the capture session and rule version in reports. Preserve the event interval on confirmation and report before waiting for upload. Repeated observations of an ongoing event update its incident.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Exercise positive, harmless, ambiguous, and provider-failure cases. Verify no alert before review, no duplicate incident for repeated observations, and correct timestamps. Existing fall experiments are not integrated product proof.

## Decisions and sources

[Product direction](../../PRD.md), [experience design](../architecture/design.md), [visual design](../../DESIGN.md), and [service roadmap](../architecture/roadmap.md). Delivery issue from the roadmap: [#21](https://github.com/KenEzekiel/lookout-ai/issues/21). Issue status is not implementation evidence.

## Open questions

Models, thresholds, cadence, observation windows, and uncertainty handling remain open. Agreement between models is not proof of accuracy.
