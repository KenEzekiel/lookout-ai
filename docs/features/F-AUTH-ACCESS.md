# F-AUTH-ACCESS: Operator identity and device pairing

Status: planned

Depends on: none

## Behavior

Operators sign in and pair operational devices. Devices receive only their assigned configuration and may submit health, events, and evidence. They cannot change recipients or act as operators.

## Entry points

Operator sign-in and device pairing are planned entry points. Revocation must remove access from an already paired device.

## Wiring and compatibility

Configuration, model transport, incidents, and replay must enforce the same operator/device identity boundary. Consumers must use the delivered identity and persistence contract rather than invent competing schemas.

## Implementation

Not implemented in the current application. Add actual source links when implementation lands.

## Verification

Verify sign-in, pairing, revocation, unauthorized access, and cross-user isolation through real endpoints and an isolated production-engine database.

## Decisions and sources

[Product direction](../../PRD.md), [experience design](../architecture/design.md), [visual design](../../DESIGN.md), and [service roadmap](../architecture/roadmap.md). Delivery issue from the roadmap: [#16](https://github.com/KenEzekiel/lookout-ai/issues/16). Issue status is not implementation evidence.

## Open questions

Authentication provider, persistence engine, and pairing details remain implementation choices. Broader role administration is outside the current roadmap.
