# F-SOURCE-CAPTURE: Source capture and local buffer

Status: planned

Depends on: F-AUTH-ACCESS

## Behavior

An operational device selects live camera or permitted prerecorded footage, starts and stops capture, and retains a local rolling buffer. Replayed footage is visibly labeled. Selecting a file does not upload the entire file.

## Entry points

Use source setup in the operational-device client. The operator client can close while a separate active capture device continues.

## Wiring and compatibility

Expose source timestamps, capture session identity, lifecycle changes, and buffer access for assessment and clip preservation. Preserve event lead-in and aftermath where available. Never persist untriggered video on the Lookout server.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Exercise live capture, replay, stop/restart, denied camera permission, and disconnection. Verify event-interval extraction and that untriggered footage is not uploaded to persistent storage.

## Decisions and sources

[Product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md). Delivery issue from the roadmap: [#17](https://github.com/KenEzekiel/lookout-ai/issues/17). Issue status is not implementation evidence.

## Open questions

Supported CCTV protocols, buffer duration, and codecs are undecided. A suspended browser is not guaranteed to keep recording.
