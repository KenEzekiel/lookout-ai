# F-EVIDENCE-REPLAY: Private event clips and replay

Status: planned

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE, F-INCIDENT-RESPONSE

## Behavior

Confirmed incidents upload an event clip to private storage for authorized later replay. Show preparing, uploading, ready, or unavailable states. Incident response remains available while evidence is missing.

## Entry points

Open incident evidence in the operator client. Offer seekable saved replay only after the server confirms readiness.

## Wiring and compatibility

Attach retrying uploads to the same incident. Notification does not wait for upload. Preserve local event footage independently of acknowledgment. Capture timestamps position the event marker, distinct from detection time.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify authorized replay from a separate operator device, cross-user denial, upload retries, disconnected capture, failed upload, and response before replay is ready.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#22](https://github.com/KenEzekiel/lookout-ai/issues/22). Issue status is not implementation evidence.

## Open questions

Retention duration, storage, codec, and upload contracts remain open. Local buffering does not establish server replay availability.
