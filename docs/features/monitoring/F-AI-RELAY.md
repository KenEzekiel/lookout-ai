# F-AI-RELAY: Secure assessment transport

Status: partial

Depends on: F-AUTH-ACCESS, F-RULE-CONFIG

## Behavior

Paired devices request typed assessment or review results through a bounded server relay. The relay authenticates the device, validates its workspace and current enabled rule version, and reads the condition from stored configuration. Model credentials stay on the server. The device owns sampling, interpretation, duration tracking, and incident decisions.

## Entry points

`POST /api/assessment` accepts `{ rule: { id, version }, sourceId, observation: { stage, frames } }`. Each frame carries `mediaTimeMs` and a JPEG `imageDataUrl`. `requestAssessment` is the client boundary. The capture screen and monitoring loop do not call it yet. This capability has no standalone operator screen.

## Wiring and compatibility

The request derives rule/version and source identities from the F-RULE-CONFIG [shared schemas](../../../apps/app/src/lib/rules.ts). `monitoringDevice` rechecks F-AUTH-ACCESS revocation. The server verifies workspace, source match, enabled state, and current version before inference. Client condition text, model selection, workspace IDs, recipients, and unknown fields are rejected. `conditionText` resolves the authoritative template/custom condition. All paired devices in a workspace share source access; there is no per-device source ACL.

Admission uses the existing D1 attempt counter. All requests count against 60 requests per device and 240 per workspace per minute. Reviews also count against six per device and 24 per workspace per minute. These are fixed demo usage ceilings, not a measured sampling policy. Requests are limited to 2 MiB, eight JPEG data URLs of at most 256 KiB characters each, and a strictly increasing source-time window of at most 30 seconds. The body reader buffers at most the request limit and drains excess bytes without retaining them, within a five-second deadline, so the Worker can deliver an explicit error response.

The adapter sends two Decisions predicates through `gpt-6-luna`, returning match and uncertainty probabilities without choosing a trigger threshold. Review uses `gpt-6.1-terra`, medium reasoning, Responses Structured Outputs, `store: false`, and at most 4096 output tokens. Review outcomes are `positive`, `rejected`, and `need_more_evidence`, with an explanation of at most 600 characters. Transport failures are a separate `unavailable` result. Refusal, malformed/incomplete output, timeout, cancellation, and provider errors never become negative observations. Calls have a 15-second deadline, a 64 KiB response limit, and no retries or redirects.

No image or result is written to application storage or logs. D1 stores admission identifiers/counts only. Provider error bodies are discarded, and responses use `Cache-Control: no-store`. `OPENAI_API_KEY` is a Worker secret. `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`; only server configuration can override it, including local external-service mocks. Provider inference remains remote; `store: false` is not a provider zero-retention guarantee.

F-DETECT-REVIEW must retain capture-epoch/request context, discard late results, apply configured duration and trigger thresholds, and decide whether to report an incident. An instantaneous positive is not proof that an optional duration has elapsed. Missing credentials produce `provider_not_configured`. No server monitoring loop, incident creation, footage storage, or automatic fallback is introduced.

## Implementation

[Shared contract and client](../../../apps/app/src/lib/assessment.ts), [route adapter](../../../apps/app/src/routes/api/assessment.ts), [relay handler](../../../apps/app/src/server/assessment.ts), [bounded body reader](../../../apps/app/src/server/assessment-body.ts), [OpenAI adapter](../../../apps/app/src/server/assessment-provider.ts), and [authoritative rule lookup](../../../apps/app/src/server/rules.ts).

The endpoint and provider adapter are connected to real access and rule storage. Capture-loop integration, deployed credentials, and live provider verification remain incomplete, so the feature remains partial.

## Verification

[Worker HTTP integration tests](../../../apps/app/tests/api/assessment.test.ts) use the built Worker, real authentication, isolated D1 migrations, and a local HTTP mock of OpenAI only. They cover authorized assessment/review, cross-workspace/source denial, stale/disabled rules, updated custom conditions, revocation, Origin checks, malformed and oversized inputs/results, provider refusal/errors, a stalled-body deadline, usage limits, and absence of payloads/keys in D1 and Worker logs. [Client HTTP integration tests](../../../apps/app/tests/integration/assessment.test.ts) exercise typed outcomes, denial, failures, and cancellation.

`pnpm verify` passed, including all 34 API integration tests. Production-build Chromium inspection used isolated D1 and an external HTTP mock. It observed successful assessment/review, human-session denial, stale-rule rejection, and client-field rejection. The test credential was absent from browser responses and all ten JavaScript bundles inspected, with no page errors. The PR records browser/network observations; no UI journey was changed. Per-run evidence stays outside version control. Mocked inference proves relay behavior, not model quality. Real provider account access, fall/crash review accuracy, latency, and deployed Worker behavior remain unverified. F-DETECT-REVIEW must verify the eventual capture-to-incident journey.

## Decisions and sources

[Issue #20](https://github.com/KenEzekiel/lookout-ai/issues/20), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

The user selected GPT-6.1 Terra with medium reasoning for review. They initially authorized independent transport work in a draft PR, then reported #18 merged; this PR integrates its authoritative rule contract. The [Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [Terra specification](https://developers.openai.com/api/docs/models/gpt-6.1-terra), and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) informed the adapter. The fall experiment supplies evidence, not a production dependency or a calibrated generic threshold.

Synthesis decision: retain one shared Zod request/result contract, one server provider adapter, and the existing access/rule/D1 boundaries. No provider SDK or generic transport framework is needed. Stored rule definitions authorize condition text; the client submits only identity/version and bounded observations. Keep inference outcomes separate from transport failure so #21 cannot interpret an outage as a harmless scene.

## Open questions

Connect F-DETECT-REVIEW and validate provider access and review quality with authorized live usage. Revisit the fixed demo limits only with measured workload evidence. Deployment still requires the real D1 binding, app origin, and Worker secrets. This feature does not authorize server-owned monitoring as a fallback.
