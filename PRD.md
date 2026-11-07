# Lookout AI — Product direction

Status: evolving direction, based on the team brief and Ken's interview on 7 November 2026.

This document gives builders enough context to make good decisions together. It captures the product intent and agreed behavior, not a fixed implementation contract. Examples, technical preferences, and open choices are labeled accordingly. Evolve it as the team learns; preserve the reasons behind changes rather than treating the first design as permanent.

## The idea

**Define what matters in a visual feed. Lookout turns it into an incident someone owns.**

Think PagerDuty for visual events: configurable detection connected to evidence, notification, acknowledgment, and escalation. Traffic monitoring is one application of the product, not its boundary.

People already have cameras, but turning footage into a timely response still requires attention. Someone must notice an event, decide whether it matters, gather context, reach the right person, and follow up. Lookout connects those steps so users can respond without continuously watching every feed.

The intended users include camera owners, caregivers, shop and site operators, and teams monitoring multiple locations. We have not selected a single commercial beachhead. The hackathon demonstrates a shared product across two settings; it does not claim validated demand across every setting.

## What we want users to experience

A user connects a visual source, selects a template or describes an event in plain language, and chooses who should be notified. Lookout monitors for that event, gathers supporting evidence, and creates an actionable incident when its verification stage confirms the candidate. The owner receives a phone call and can inspect the evidence, acknowledge responsibility, dismiss an incorrect alert, or resolve the incident.

The value is the complete response loop. A detector that draws attention to footage is only part of that experience.

| Step | User-visible behavior | Why it matters |
| --- | --- | --- |
| Configure | Choose a source, describe a trigger, and set notification behavior. | Users define what matters in their setting. |
| Observe | Assess timestamped visual observations against the configured rule. | Monitoring does not depend on continuous human attention. |
| Verify | Review candidate events with supporting observations; gather more evidence when uncertain. | A single ambiguous image should not automatically become a phone call. |
| Open or update | Record an incident with source, time, explanation, and visual evidence. | The recipient can understand what happened and where. |
| Notify | Call the configured owner after verification. | The system actively reaches someone. |
| Respond | Acknowledge, dismiss, or resolve through the dashboard. | A person owns the response and its outcome. |
| Escalate | Run a configured follow-up step if the incident remains unacknowledged. | An unanswered notification is not treated as a completed response. |

## The two agreed demos

### 1. Prerecorded car crash

Use permitted prerecorded footage as a monitored source. Show the event entering the observations, the verification stage, an incident with evidence, and a real phone notification to the configured demo recipient. Acknowledge it in the dashboard and show that further paging stops.

Present the source honestly as replayed footage. The detection and response pipeline should operate on the footage during the demonstration.

### 2. Person falling in real time

Use a live camera source and a safely staged fall by a consenting participant. The same configurable product detects the candidate event, verifies it, creates an incident, and calls the owner. The owner can inspect and handle it through the same workflow.

The staging should avoid an actual injury. This demonstrates an event alert and response workflow, not medical assessment or a guarantee of emergency protection.

Together, the demos show that changing the source and rule changes what Lookout monitors without creating a separate product for each scenario. The exact demo choreography and which scenario showcases escalation remain open.

## Agreed product behavior

### Rules describe observable events

Offer starter templates and a blank custom trigger. A rule combines a plain-language description with explicit conditions and response settings: source, severity, recipient, and escalation delay. A duration condition can make persistence explicit where relevant.

For example, “alert when this exit stays blocked for 10 seconds” illustrates the configuration model. It is not a default duration for crashes or falls, and the blocked-exit scenario is not one of the selected demos.

The aim is configurable visual incident monitoring. “Any visual input” describes the product direction, not a promise to support every camera protocol or reliably detect every possible event in this version.

### Verification precedes automatic calling

The intended approach has two stages: an initial visual assessment flags a candidate, then a second model reviews the supporting evidence before a call is requested. The agent can gather additional observations, create an incident, or update an existing one.

Two models agreeing is not proof of correctness. Success means useful evidence and better observed alert quality, not merely invoking two models. Successive frames and counterevidence should inform verification where useful. Exact models, thresholds, observation windows, and uncertainty handling remain implementation choices to evaluate.

### An incident persists across observations

| Situation or action | Agreed meaning and behavior |
| --- | --- |
| More observations of the same ongoing event | Update the existing open incident and add evidence rather than repeatedly opening incidents and calling. |
| Acknowledge | “I'm handling it.” Record ownership and stop further paging for that incident. |
| Dismiss | “This alert was incorrect.” Preserve the operator's feedback. |
| Resolve | “The incident has been handled.” A person closes the response. |
| Scene clears | Record the new evidence; the owner still resolves the incident. |
| Nobody acknowledges | Execute one configured escalation step. |

Acknowledgment does not mean the event is resolved. Exact controls, state names, and escalation destinations can evolve while retaining these meanings. The initial recipient is the owner; broader responder rosters and on-call scheduling are future possibilities.

### Evidence makes alerts actionable

An incident should explain what was observed, which source it came from, when it happened, and why it matched the rule. Keep short visual evidence snippets so recipients can assess the alert after receiving it. The dashboard provides the evidence, status, owner, and incident timeline.

Evidence retention duration remains open. Use permitted footage and agreed demo recipients; emergency-service calling and identifying people are outside the current direction.

## Priorities

These priorities communicate emphasis, not a frozen backlog or a prescribed implementation order.

**Core:** configurable rules; prerecorded and live visual inputs for the selected demos; candidate verification; incidents with evidence; real phone alerts; dashboard acknowledgment, dismissal, and resolution; one configurable escalation step; suppression of repeated alerts for an ongoing incident.

**Supporting direction:** useful monitoring and incident feedback, clear configuration, and additional notification integrations such as Slack or Telegram. Provider choices and the order of these enhancements remain open. Recording feedback does not imply automatic learning or retraining.

**P2 — MCP:** expose useful product actions to external agents. The agreed initial use case is inspecting an incident and its evidence, then acknowledging it against the same state used by the dashboard. Broader agent-driven rule configuration can evolve later. MCP is part of the AI-native direction, but it is secondary to the core demo.

## AI-native product and development approach

There are two related stories:

- **The product agent** interprets observations in the context of rules and incident history, gathers evidence, and requests incident or notification actions through tools. Configured policies govern routing and escalation; humans retain control of response decisions.
- **The development harness** helps the team build and verify Lookout using agents inside the repository, Slack, and the team's coding tools. This is part of how the product is built and how the team demonstrates its use of Codex.

The long-term product should be usable by people and agents, with integrations reaching users where they already work. A useful integration completes a real user task and shares the product's incident state; it is more than a list of endpoints.

## Technical preferences, not fixed architecture

- Prefer the Cloudflare stack where it serves the product.
- Use OpenAI Decisions for the initial structured visual assessment if it fits; retain a vision-capable model fallback. The second-stage review model remains open.
- Periodically sample visual observations. One frame per second was an initial idea, not a locked rate or a requirement to make one inference request per frame.
- Client-side capture and image uploading need a deliberate design. Where sampling happens, how frames are uploaded, and how a source remains available are open technical questions.
- Phone provider, model access, deployment pipeline, storage, and transport choices belong in implementation decisions as they become concrete.

This PRD does not set schemas, endpoint contracts, a fixed task split, or approval for repository publication and deployment. The team can divide work dynamically while preserving the shared response behavior.

## What convincing success looks like

The product is intended to reduce continuous monitoring and shorten the path from a visible event to an accountable response. These are outcomes to demonstrate and measure, not benefits already proven.

| Evidence to seek | Observable outcome |
| --- | --- |
| Both selected scenarios | The prerecorded crash and staged live fall each produce an incident through the monitoring pipeline. |
| Configurability | Each scenario uses its own visible rule and source within the same product flow. |
| Actionable notification | The configured recipient receives a real call and can find the corresponding evidence. |
| Ownership | Acknowledgment is reflected in the incident and stops subsequent paging. |
| Escalation | Leaving an incident unacknowledged causes the configured follow-up step. |
| Continuity | Repeated observations enrich the ongoing incident rather than generating repeated initial calls. |
| Human disposition | Dismissal and resolution remain distinct; a clearing scene adds evidence without silently resolving the incident. |
| Alert quality | Observe harmless or ambiguous footage as well as positive examples; record false alerts and misses. |

Measure event-to-call latency and event-to-acknowledgment time where possible. Report observed results and sample size. No accuracy, latency, or cost target has been agreed; do not invent guarantees or imply a few demo clips establish production reliability.

## Hackathon context

The supplied briefing sets a seven-hour build window, 09:30–16:30 Jakarta time, with a six-minute presentation and two-minute Q&A. Judging covers problem/solution fit, build quality, insight/originality, real-world value, alignment with a build direction, and use of Codex.

The team sees alignment with Track 1, Autonomous & Adaptive AI, and Track 2, AI-Native Products & Operations. Positioning Track 2 as primary is a recommendation, not a settled team decision. Reliable evidence gathering and response behavior can support the Track 1 story; adaptation should be demonstrated before being claimed.

The briefing requires building on the day, a new public repository, a project writeup, and declarations of existing OSS and work built during the event. A demo link is optional. The repository includes an imported development harness; distinguish that existing tooling from product work built during the hackathon in the required declarations. Organizer interpretation of reusable tooling is not established by this PRD.

## Boundaries and room to evolve

The present direction does not require emergency-service dispatch, identity recognition, custom model training, billing, a polished mobile app, comprehensive camera compatibility, or full multi-tenant operations. These exclusions keep the current story clear rather than permanently limiting the product.

Keep learning about the best initial audience, which rules users can express reliably, how much evidence recipients need, and what makes escalation useful. Model selection, retention, call interaction details, integrations, and commercial positioning can change as evidence improves. A spoken alert is sufficient for the current response-loop direction; a two-way conversational call has not been agreed as a requirement.

## Basis

- Ken's initial brief and interview decisions: configurable visual monitoring beyond traffic; complete response loop; prerecorded crash and live fall demos; explicit rule conditions; agreed incident semantics; MCP at P2; a flexible, contextual PRD.
- Supplied `visual-incident-alerts-lean-canvas.md`: templates plus custom triggers, two-stage assessment, owner calling, retained evidence, broad audience, and unresolved commercial positioning. Later interview decisions take precedence where the canvas differs.
- Supplied `[Participants Briefing Materials] ID Sea x OpenAI Hackathon.pdf`: schedule, build directions, judging, presentation, and submission rules.
- [OpenAI Decisions documentation](https://developers.openai.com/api/docs/guides/decisions): reference for the proposed first assessment stage, checked during the interview. Account access and runtime behavior have not been verified here.
