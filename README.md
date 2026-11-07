# Lookout AI

**Let us be on the lookout, so you don’t have to.**

Cameras record. People still have to keep watch.

Lookout is an AI-assisted visual monitoring and incident-response project. Users describe events they care about, connect a camera or video source, and configure how to reach the responsible person. The intended flow combines visual assessment, evidence, client alerts, acknowledgment, and escalation.

Think PagerDuty for visual events. Traffic is one use case; the product is designed around configurable rules rather than a single incident category.

## Two clients

- **Operator:** define incidents, configure roles and alert recipients, receive incidents, replay evidence and respond.
- **Operational device:** connect CCTV/video/playback and keep monitoring active. Run the decision loop and upload video snippets only when an incident triggers.

The incident path is **operational device → server → operator**. Option A, device-owned Decisions API orchestration, is the default; server-owned assessment of uploaded snippets is deferred. Non-triggered footage is not retained by Lookout. A stateless authenticated relay is recommended for browser API-key protection, with results returned to the device.

## Product direction and current status

The hackathon demos target a **prerecorded car crash** and a **person falling in real time**, safely staged with a consenting participant. Both should use the same response flow:

Configure a rule → observe footage → verify a candidate → open an incident → alert the owner → acknowledge and stop escalation.

**Current source status:** email/password accounts, workspace creation and invitations, owner/operator access, device pairing, and revocation are implemented. A paired device can open `/device` to play a local video or preview a permitted camera. It samples timestamped frames and keeps a bounded recent-video buffer in the browser while capture runs. AI assessment, incident reporting, evidence upload, notifications, and MCP remain planned.

Read the [PRD](PRD.md) for agreed behavior, demo outcomes, priorities, and open decisions. It is the source of truth for product direction. This README owns development setup and repository orientation.

The current design keeps video on the capture device and uploads an event clip when an incident is confirmed. Responders can replay it later. See the [experience design](docs/architecture/design.md) and [component spec](docs/architecture/tech-spec.md) for the proposed flow and responsibilities.

The [feature map](docs/features/README.md) records stable capability codes, implementation status, compatibility contracts, and verification requirements. Run `pnpm features:list` to discover features before changing Lookout behavior.

## Experiments

The [Decisions fall-detection experiment](experiments/decisions-falls/README.md)
contains a reproducible video-frame runner and recorded results from eight clips.
It is separate from the product application; it does not implement incident
verification or phone notifications.

## Develop

The pnpm workspace contains the full-stack application, `@lookout/app`, in `apps/app`, and the Oracle engineering factory, `@lookout/oracle`, in `oracle`. The application uses TanStack Start, React, TypeScript, and Cloudflare Workers, with Tailwind CSS and shadcn/ui using Base UI. Motion for React is installed for interaction transitions. [DESIGN.md](DESIGN.md) records the dark theme and component guidance.

Use Node.js **24.18.0**, pinned in [.node-version](.node-version), and pnpm **10.33.4**, pinned in [package.json](package.json).

```sh
pnpm install --frozen-lockfile
cp apps/app/.dev.vars.example apps/app/.dev.vars
pnpm --filter @lookout/app exec wrangler d1 migrations apply DB --local
pnpm dev
```

Before starting, replace the example secret in `apps/app/.dev.vars` with a random value of at least 32 characters. Keep it stable across restarts. The development command selects port 3000. Open `http://localhost:3000` once the server reports it is ready. The Vite configuration includes Cloudflare's local Workers integration.

| Command                                    | Purpose                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `pnpm check`                               | Check styles, comments, workspace types, boundaries, and tests.        |
| `pnpm oracle`                              | Start the Oracle engineering dispatcher.                               |
| `pnpm test`                                | Run UI integration tests and Oracle tests.                             |
| `pnpm verify`                              | Run all PR checks, integration tests, and the production build.        |
| `pnpm qa:browser`                          | Run Playwright smoke and access journeys against an isolated database. |
| `pnpm build`                               | Build the application.                                                 |
| `pnpm preview`                             | Preview the build on port 3000.                                        |
| `pnpm format`                              | Apply formatting.                                                      |
| `pnpm lint:fix`                            | Apply available lint fixes.                                            |
| `pnpm --filter @lookout/app ui add button` | Add a UI component using the app's Base UI preset.                     |

CI runs `pnpm verify`. Playwright stays outside CI. For manual browser QA, install Chromium once with `pnpm exec playwright install chromium`. See [verification conventions](docs/verification.md) for mocking rules, temporary database requirements, and the comment ban. Generated route files and vendored agent tooling are excluded from the application formatting/lint scope. See [package scripts](package.json), [app scripts](apps/app/package.json), and [formatter configuration](.oxfmtrc.json) for exact behavior.

## Hackathon pitch deck

Run `pnpm pitchdeck` to open the HTML slide player. Edit individual slides in
`packages/pitchdeck/slides/`, then rebuild. The package produces a single offline
HTML file with keyboard navigation, fullscreen, and speaker notes. See the
[pitch deck guide](packages/pitchdeck/README.md).

## Oracle

The engineering factory lives in `oracle/`. Its dispatcher receives authorized
Slack requests, and its session layer keeps one visible T3 coding thread per
conversation. Structured progress and replies go to the originating Slack thread.

Oracle uses the workspace's shared pnpm lockfile, Oxlint, Oxfmt, and TypeScript
checks. Start it with `pnpm oracle`. See [Oracle](oracle/README.md) for its behavior
and verification boundaries.

## Cloudflare deployment

The Worker configuration is in [apps/app/wrangler.jsonc](apps/app/wrangler.jsonc). Confirm the account and intended Worker before deploying.

```sh
# Build and validate the deployment bundle without uploading it.
pnpm --filter @lookout/app deploy:check

# Authenticate, then build and deploy when deployment is authorized.
pnpm --filter @lookout/app exec wrangler login
pnpm --filter @lookout/app deploy
```

The committed D1 database ID is a local-development placeholder. Before an authorized deployment, create the `lookout-access` D1 database, replace its ID in `apps/app/wrangler.jsonc`, set `APP_URL` to the exact deployed HTTPS origin, and set `BETTER_AUTH_SECRET` with `wrangler secret put`. Apply the committed migrations with `wrangler d1 migrations apply DB --remote` before deploying. Use a separate database for staging. Password hashing has been exercised locally in Workers; check the target account’s CPU allowance during deployment verification.

Add other service bindings as services are selected. Run `pnpm --filter @lookout/app cf-typegen` after changing bindings. Local secrets belong in `apps/app/.dev.vars`, which Git ignores; use Wrangler secrets for production values. Do not commit credentials.

The assessment relay uses the Worker secret `OPENAI_API_KEY`. Leave it empty when not using remote inference; authorized assessment requests return `provider_not_configured`. Set it with Wrangler secrets for an authorized deployment. `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`; the API tests override it with a local HTTP mock and an artificial key. Never point tests at a live provider. The [relay feature record](docs/features/monitoring/F-AI-RELAY.md) documents the typed contract, limits, and remaining device-loop integration.

Local Worker integration and browser journeys exercise the built application. Cloud provisioning and deployment have not been performed for this access slice.

## Working together

The hackathon has a seven-hour total build window. Favor the complete demo flow and focused verification. Follow [AGENTS.md](AGENTS.md) for the current branch, PR, review, and merge policy; it is authoritative for delivery rules. Open PRs against `main` and wait for explicit user confirmation before merging.

The team uses a repository-owned agent harness to support development. The planned product agent and MCP integration serve Lookout users; they are distinct from the tools used to build Lookout.

- [.agents/skills](.agents/skills) contains local workflows and helper tools.
- [Runtime contract](.agents/skills/poteto-mode/references/codex-tools.md) adapts the harness to Codex and T3.
- [Model settings](.agents/pstack-models.md) define local delegation preferences.
- [scripts/check-harness.py](scripts/check-harness.py) validates harness structure. Run `python3 scripts/check-harness.py` when changing the harness.

## Keeping these docs current

The Lookout team maintains this README and the [PRD](PRD.md). Update setup instructions and current status when scripts or implemented behavior change. Update the PRD when the team changes a product decision. Keep planned features labeled until the corresponding behavior has been verified.
