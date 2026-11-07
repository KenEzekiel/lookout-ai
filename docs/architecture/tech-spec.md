# Lookout component spec

A high-level reference for dividing the work. The [experience design](design.md) contains user flow, swimlane and architecture diagrams. Components below are proposed; the existing repository currently supplies the web app scaffold.

## Main components

| Component               | Responsibility                                                                                           | Interaction                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Capture client          | Open a local video or live camera, keep recent footage locally, sample frames, show monitoring health.   | Sends observations to monitoring; receives requests to preserve event clips.              |
| Monitoring and AI       | Evaluate frames against configured rules, review candidate events, request more evidence when uncertain. | Sends confirmed events to incident management and clip requests to the capture client.    |
| Incident management     | Own incident identity, evidence status, owner, timeline and escalation.                                  | Provides the same state and response actions to every device and future MCP client.       |
| Clip saving and replay  | Accept alert-triggered uploads, store clips privately and make them available to authorized viewers.     | Receives the event interval from capture; marks replay ready only after storage succeeds. |
| Notification delivery   | Notify subscribed responder devices and track notification attempts.                                     | Uses in-app delivery when connected and web push where supported.                         |
| Responsive responder UI | Show incoming alerts, incident details, replay and acknowledgment/dismissal/resolution controls.         | Runs on desktop, Android and iOS; reads and updates server-owned incidents.               |
| Rule configuration      | Templates, custom descriptions, conditions, source and response settings.                                | Supplies rules to monitoring and escalation.                                              |
| MCP, P2                 | Let external agents inspect and acknowledge incidents.                                                   | Reuses the same authorized incident actions.                                              |

## What moves between components

- Observations carry sampled images, source/session identity and event timing. They are sent during monitoring; full video stays on the capture device.
- A confirmed incident includes the rule, source, event time and supporting context. Its identity links the notification and saved clip.
- A clip request identifies the event interval. The capture client preserves footage around that event, including the lead-in and aftermath where available.
- Clip uploads happen on alert and attach to the existing incident. The server returns evidence status and an authorized replay path.
- Notifications carry an incident reference and concise summary. Opening one leads to the current incident; acknowledgment is an explicit action.
- Response actions update one server-owned incident so all devices agree on its owner and status.

## Shared behavior

Video saving and notification proceed independently. An upload delay must not delay the alert. Acknowledgment stops further escalation but does not cancel preservation of incident evidence.

Repeated detections enrich the same ongoing incident. Retried clip uploads or notification deliveries must not create duplicate incidents. Dismissal means an incorrect alert; resolution means the event was handled. A clearing scene adds evidence without automatically resolving the incident.

Video buffers have a finite lifetime. Preserve the requested segment before it is overwritten. If evidence is unavailable, show why and keep the incident. For a replayed source, use its media timestamp; for a live source, use capture-session timing. A playback seek or restart must not mix footage from different runs.

The source device must remain active to capture and supply footage. The responder may receive web push in the background when its platform supports it. These are separate capabilities.

Protect clip access and notification subscriptions. Keep provider credentials on the server. Let the user see whether capture, alert permission and replay availability are ready before the demo starts.

## Recommended stack direction

Retain TanStack Start and React for the responsive app. Add PWA installation and web push support. Prefer Cloudflare Workers for server behavior, a Durable Object for shared incident state and escalation, and private R2 storage for saved clips. Use OpenAI for sampled-frame assessment and review.

Exact deployment layout, APIs, database tables, codecs, buffer duration, clip duration, sampling cadence and retention policy remain implementation choices. Real telephony is optional and is not needed to complete the revised demo.

## Work the team can divide

| Work area                | What it delivers                                                                        | Coordination point                                          |
| ------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Capture and local buffer | Local file/live camera input, sampled observations and alert-triggered clip extraction. | Agree source timing and clip-request shape with monitoring. |
| Monitoring and incidents | Rule evaluation, confirmation, incident lifecycle and escalation.                       | Own shared incident identity and transitions.               |
| Evidence and replay      | Private upload, visible save status and replay on other devices.                        | Agree a playable format with capture and responder UI.      |
| Responder experience     | Responsive dashboard, simulated incoming-alert screen, PWA/push setup and actions.      | Consume shared incident state and evidence status.          |
| Integration              | Both demo flows, cross-device acknowledgment and failure cases.                         | Join the components and verify on actual target devices.    |

## What to verify

- Prerecorded crash and live staged fall both create alerts and save the corresponding event footage.
- Non-alert video remains local; only sampled observations and alert-related evidence leave the device.
- Replay includes the intended event interval and plays on the target desktop, Android and iOS devices.
- Alert delivery does not wait for clip upload; unavailable clips show an honest state.
- Foreground incoming-alert UI, permission refusal and background push are checked separately on each target platform.
- Acknowledgment on one device stops subsequent escalation and updates the other devices.
- Slow uploads, repeated alerts, playback seeks and capture-device disconnects do not corrupt incident evidence or create duplicate incidents.

This design is documentation only. No runtime claims are verified yet. The Lookout team maintains the component boundaries as implementation evolves.
