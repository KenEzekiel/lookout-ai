# Lookout AI product direction

**Let us be on the lookout, so you don’t have to.**

Cameras record. People still have to keep watch.

This PRD helps the Lookout team make product decisions during the hackathon and afterward. It captures the brief and interview decisions agreed on 7 November 2026. It describes intended behavior, not implementation status; see the [README](README.md) for the current source and development setup.

Treat it as an evolving direction. Preserve the user outcomes while refining the implementation. Examples and technical preferences below are not fixed architecture or delivery commitments.

Latest agreed revision: save video on alert and replay it from the server; real phone calls are optional. See the [experience design](docs/architecture/design.md) for desktop/mobile alerts and the video flow.

The visual system and monitor-screen interactions live in [DESIGN.md](DESIGN.md). This PRD remains the source for agreed product behavior.

## Two client experiences

The operator client owns incident definitions, rule configuration, roles and alert recipients, receiving incidents, replay and response. The operational-device client is dedicated to connecting CCTV/video/playback and keeping monitoring active. Its controls focus on source setup, start/stop and health.

The incident path is operational device → server → operator. The server distributes operator-defined configuration to assigned devices and owns shared incident state and routing.

Decision option A is selected: the operational device initiates Decisions API assessment and candidate review, receives the results, then reports triggered incidents and uploads their video snippets. Non-triggered video is not stored on Lookout's server. This aims to reduce latency, but the improvement has not been measured. Option B, uploading snippets for server-owned decisions, is deferred.

Device-owned decisions do not mean local model inference. For a browser client, a stateless authenticated relay is the recommended way to protect OpenAI credentials while returning results to the device. It does not store non-triggered media or own the decision loop. See the [design](docs/architecture/design.md) for this transport boundary and always-on device limits.

## Why this product

Cameras provide visibility, but someone still has to notice an event, decide whether it matters, collect evidence, reach the right person, and follow up. Fatigue and divided attention can delay that response.

Lookout connects those steps. Users define visual events in their own terms and receive actionable incidents without continuously watching every feed. The product combines configurable monitoring with ownership, client notification, acknowledgment, and escalation: PagerDuty for visual events.

Potential users include camera owners, caregivers, shop and site operators, and teams monitoring multiple locations. Traffic is one application. We have not selected a commercial beachhead or validated demand across these audiences.

## The experience

| Step           | What happens                                                                             | Why it matters                                                    |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Configure      | Select a source, start from a template or write a trigger, and choose response settings. | The user defines what matters in their setting.                   |
| Observe        | Assess timestamped visual observations against the rule.                                 | Monitoring reduces the need for continuous attention.             |
| Verify         | Review a candidate with supporting evidence; gather more observations when uncertain.    | An ambiguous frame should not immediately produce an alert.       |
| Open or update | Create an incident or add evidence to the same ongoing incident.                         | Recipients get context without repeated alerts for one event.     |
| Notify         | Notify the owner after verification through an in-app alert or supported web push.       | The system actively reaches someone.                              |
| Respond        | Inspect evidence, acknowledge, dismiss, or resolve through the dashboard.                | A person owns the response and outcome.                           |
| Escalate       | Execute one configured follow-up step if nobody acknowledges.                            | Sending a notification is not treated as completing the response. |

## Two agreed demos

**Prerecorded car crash.** Play permitted footage through the monitoring pipeline. Show the candidate event, verification, an incident with evidence, and an alert to the configured demo recipient. Label the input as replayed footage; run the assessment and response on it during the demonstration.

**Person falling in real time.** Use a live camera and a safely staged fall by a consenting participant. Demonstrate the same verification, incident, and notification flow. Avoid an actual injury; the product provides evidence for a human response, not medical assessment.

Both scenarios use the same configurable product. Demonstrate acknowledgment stopping escalation and an unacknowledged incident triggering the configured follow-up. The exact choreography and which scenario shows each branch remain open.

## Agreed behavior

### Users configure observable rules

Offer starter templates and a blank custom trigger. Combine a plain-language description with explicit conditions and response settings: source, severity, recipient, and escalation delay. Duration can be a condition when persistence matters.

For example, “alert when this exit stays blocked for 10 seconds” illustrates an explicit condition. It does not set a delay for detecting crashes or falls. Broad configurability is the direction; universal camera compatibility and reliable detection of every conceivable event are not promises.

### Verification precedes automatic alerting

An initial visual assessment flags a candidate. A second model reviews supporting evidence before requesting an alert. The product agent can gather more observations and use incident history to create or update the appropriate incident.

Two models can make the same mistake. Assess the usefulness of verification through observed false alerts and missed events, rather than treating model agreement as proof. Successive frames and counterevidence can help. Models, thresholds, observation windows, and the precise handling of uncertainty remain open.

### Incidents carry ownership across observations

| Action or situation                       | Agreed meaning                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Repeated observations of an ongoing event | Update the existing open incident and add evidence; do not repeatedly create incidents and initial alerts. |
| Acknowledge                               | “I'm handling it.” Record ownership and stop further paging for this incident.                             |
| Dismiss                                   | “This alert was incorrect.” Preserve the feedback.                                                         |
| Resolve                                   | “The incident has been handled.” A person closes the response.                                             |
| Scene clears                              | Record the new evidence. The owner still resolves the incident.                                            |
| Nobody acknowledges                       | Run one configured escalation step.                                                                        |

Acknowledgment does not mean resolution. Control labels and implementation states can evolve while preserving these meanings. The initial recipient is the owner; broader responder rosters and on-call schedules can come later.

### Evidence supports the response

An incident explains what was observed, which source it came from, when it happened, and why it matched the rule. Keep video locally during monitoring. On a confirmed alert, upload the event clip to private server storage for later replay, including footage around the event where available. The operational device sends sampled frames for remote AI assessment through secure transport and owns the assessment loop. Notify immediately while the clip is being prepared or uploaded; show its availability explicitly. The dashboard presents evidence, owner, status, and an incident timeline.

Retention duration is undecided. Use permitted footage and agreed recipients. Emergency-service dispatch and identifying people are outside the current scope.

## Priorities and AI-native direction

**Core experience:** the two visual inputs, configurable rules, candidate verification, incidents with evidence, client alerts, dashboard response controls, and one configurable escalation step. The lifecycle above defines how these pieces work together.

**Supporting direction:** record operator feedback and add notification integrations such as Slack or Telegram. Recording feedback does not yet mean automatic learning or retraining.

**P2: MCP.** An external agent should be able to inspect an incident and its evidence, then acknowledge it using the same incident state as the dashboard. This is secondary to the core demos. Agent-driven rule configuration can evolve later.

The product agent interprets observations against rules and incident history, gathers evidence, and requests actions through tools. Configured policies govern routing and escalation; humans retain control of response decisions. Integrations should complete useful tasks for people and agents.

The team's development harness is a separate part of the story. Agents in the repository, Slack, and coding tools help build and verify Lookout. Document what Codex actually contributed for the hackathon rather than presenting the development harness as a user-facing product feature. Repository tooling and provenance live in the [README](README.md#working-together).

## Technical preferences and open choices

- Prefer Cloudflare where it serves the product. The current scaffold is described in the README.
- Prefer OpenAI Decisions for initial structured visual assessment if it fits, with a vision-capable model fallback. The second-stage model is undecided.
- Periodically sample visual observations. One frame per second was an initial idea, not a fixed sampling rate or inference frequency.
- Capture, sampling and the decision loop belong to the operational-device client. Secure request transport and supported CCTV protocols remain implementation choices.
- Choose evidence retention, notification behavior, escalation destination, model access, storage, and deployment details as implementation becomes concrete.

Real telephone calls are optional. The agreed direction is a responsive desktop/mobile client with an in-app simulated incoming-alert experience and supported web push. The required outcome is a notification followed by an accountable response. This document does not prescribe schemas, endpoint contracts, module boundaries, or a fixed task split.

## Evidence of success

Lookout aims to reduce continuous monitoring and shorten the path from a visible event to an accountable response. Verify these outcomes rather than claiming them from the design alone.

| Check         | Observable result                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Both demos    | The prerecorded crash and staged live fall each produce an incident through the monitoring pipeline.            |
| Configuration | Each scenario has its own visible source and rule within the same product flow.                                 |
| Notification  | The intended recipient receives an alert and can inspect the corresponding evidence.                            |
| Ownership     | Acknowledgment updates the incident and stops subsequent paging.                                                |
| Escalation    | An unacknowledged incident triggers its configured follow-up step.                                              |
| Continuity    | Repeated observations enrich one ongoing incident without repeated initial alerts.                              |
| Disposition   | Dismissal and resolution remain distinct; scene clearing adds evidence without silently resolving the incident. |
| Alert quality | Exercise harmless and ambiguous footage as well as positive cases, recording false alerts and misses.           |

Measure event-to-alert and event-to-acknowledgment time where possible. Report observed results with the sample size. No accuracy, latency, or cost targets have been agreed, and the demo alone cannot establish production reliability.

## Hackathon context and boundaries

The supplied briefing specifies a seven-hour build window, 09:30–16:30 Jakarta time, and a six-minute presentation plus two-minute Q&A. Judging covers problem/solution fit, build quality, insight/originality, real-world value, build-direction alignment, and use of Codex.

The team sees alignment with Track 1, Autonomous & Adaptive AI, and Track 2, AI-Native Products & Operations. Track 2 as the primary framing is a recommendation, not a settled decision. Claim adaptation only when demonstrated.

Submission requires a new public repository, project writeup, and declarations of existing OSS and work built during the event; a demo link is optional. The briefing requires building on the day. Distinguish reused development tooling from product work in the declarations; this document does not establish the organizer's interpretation of reusable tooling.

The current direction does not require emergency dispatch, identity recognition, custom model training, billing, a polished mobile app, comprehensive camera compatibility, or full multi-tenant operations. These boundaries describe the present effort, not permanent product limits.

## Stewardship and sources

The Lookout team maintains this direction. Update it when an agreed behavior, priority, demo, or user outcome changes. Technical choices can evolve without rewriting the product intent. Keep current implementation status in the README and detailed architecture with its implementation documentation when needed.

This document draws on Ken's brief and interview, the supplied `visual-incident-alerts-lean-canvas.md`, and `[Participants Briefing Materials] ID Sea x OpenAI Hackathon.pdf`. The interview takes precedence over earlier canvas choices. The attachments are session inputs, not files distributed with this repository.

[OpenAI Decisions documentation](https://developers.openai.com/api/docs/guides/decisions) is the reference for the proposed initial assessment stage. Its documentation was checked during the interview; account access and runtime behavior were not verified.
