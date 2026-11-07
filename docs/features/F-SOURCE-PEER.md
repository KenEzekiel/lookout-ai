# F-SOURCE-PEER: Authorized live peer viewing

Status: planned

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE

## Behavior

An authorized operator can view live media from an active operational device. This is P2, outside the core demo path.

## Entry points

Open the assigned source in the operator client when peer viewing becomes available.

## Wiring and compatibility

Use authorized server signaling and the existing capture lifecycle. Peer media does not replace private saved incident replay.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify authorized connection, cross-user denial, disconnect and reconnect, and continued incident capture while viewing.

## Decisions and sources

[Product direction](../../PRD.md), [experience design](../architecture/design.md), [visual design](../../DESIGN.md), and [service roadmap](../architecture/roadmap.md). Delivery issue from the roadmap: [#28](https://github.com/KenEzekiel/lookout-ai/issues/28). Issue status is not implementation evidence.

## Open questions

Protocol and deployment details remain open. No universal CCTV or background capture guarantee is implied.
