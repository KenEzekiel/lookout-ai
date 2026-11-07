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

The production app uses [lookout-app.lookout-ai.workers.dev](https://lookout-app.lookout-ai.workers.dev). The `production` environment in [apps/app/wrangler.jsonc](apps/app/wrangler.jsonc) pins the Cloudflare account, the `lookout-access` D1 database, and the HTTPS origin. The default environment keeps localhost and a placeholder database ID for local development.

```sh
pnpm --filter @lookout/app exec wrangler login
pnpm --filter @lookout/app deploy:check
pnpm --filter @lookout/app exec wrangler d1 migrations apply DB --remote --env production --config wrangler.jsonc
pnpm --filter @lookout/app run deploy
```

For manual GitHub Actions deployment, open **Actions → Deploy to Cloudflare → Run workflow** and select `main`, or run:

```sh
gh workflow run deploy.yml --ref main
```

The [deployment workflow](.github/workflows/deploy.yml) runs only through `workflow_dispatch`. Pushes and pull requests do not deploy. Runs targeting other branches skip deployment. The workflow verifies the app, builds and validates the production bundle, applies D1 migrations, deploys that bundle, and checks the live homepage and principal endpoint. Production runs are serialized without cancelling an active deployment.

Set the repository Actions secret `CLOUDFLARE_API_TOKEN` to an account-scoped token with **Workers Scripts: Edit** and **D1: Edit** permissions. The account ID is already pinned in Wrangler. `BETTER_AUTH_SECRET` stays in Cloudflare and is not copied into GitHub. GitHub exposes the manual workflow after its file is merged into `main`. This uses the existing Workers Free resources and enables no paid services.

Use `run deploy` explicitly because `pnpm deploy` invokes pnpm's own workspace deployment command. Both deployment scripts build with `CLOUDFLARE_ENV=production`; ordinary development and builds keep the local configuration. Review migrations before applying them to production. Use a separate database for staging.

`BETTER_AUTH_SECRET` is configured as a Cloudflare Worker secret and is required by the production environment. Preserve it across deployments. For a new environment, generate a random value of at least 32 characters and upload it with `wrangler secret put BETTER_AUTH_SECRET --env production --config wrangler.jsonc` from `apps/app`. Never commit credentials. Local secrets belong in the ignored `apps/app/.dev.vars` file.

This deployment uses Workers and D1 features available on the Free plan. Do not upgrade the account or enable paid services for this demo. The account owner confirmed Workers Free on November 7, 2026. Wrangler's OAuth token cannot independently read billing subscriptions.

Deployment verification on November 7, 2026 passed the full `pnpm verify` suite, HTTPS homepage and Chromium rendering checks, and live signup, workspace creation, sign-in, secure-cookie, and sign-out checks. The temporary verification account and workspace were removed afterward.

Add other service bindings as services are selected. Run `pnpm --filter @lookout/app cf-typegen` after changing bindings.

## Background push setup

Apply migration `0004_background_push.sql` along with the other D1 migrations. Set `PUSH_PUBLIC_KEY`, `PUSH_PRIVATE_KEY`, and `PUSH_SUBJECT` in the Worker's environment. The public key is the uncompressed P-256 public key in base64url form. The private key is its matching 32-byte scalar in base64url form. Keep the private key stable and secret. The subject is an HTTPS contact URL or a `mailto:` address. Missing configuration leaves foreground alerts available and explains that background setup is unavailable.

For local development, put the values in ignored `apps/app/.dev.vars`. For an authorized deployment, use Wrangler secrets and the exact HTTPS `APP_URL`. Generate a fresh VAPID pair with a trusted Web Push tool and preserve it for subscription continuity. Do not use CI's ephemeral test keys in production. No cloud configuration or deployment is performed by the subscription feature itself.

Sign in as an operator, expand **Background alerts**, and choose **Enable alerts**. On supported iPhone and iPad versions, first add Lookout to the Home Screen using Safari and open it there. Permission must follow a user action. Use browser or OS settings to recover from a denial. Signing out stops future delivery to that session; sign in and enable again to resume.

Push is best effort and currently supports FCM, Mozilla's production push service, and Apple web push endpoints. Provider acceptance does not confirm device display. Failed initial attempts are not retried automatically. The [feature contract](docs/features/notifications/F-ALERT-PUSH.md) records ownership, failure handling, and remaining target-device checks.

## Working together

The hackathon has a seven-hour total build window. Favor the complete demo flow and focused verification. Follow [AGENTS.md](AGENTS.md) for the current branch, PR, review, and merge policy; it is authoritative for delivery rules. Open PRs against `main` and wait for explicit user confirmation before merging.

The team uses a repository-owned agent harness to support development. The planned product agent and MCP integration serve Lookout users; they are distinct from the tools used to build Lookout.

- [.agents/skills](.agents/skills) contains local workflows and helper tools.
- [Runtime contract](.agents/skills/poteto-mode/references/codex-tools.md) adapts the harness to Codex and T3.
- [Model settings](.agents/pstack-models.md) define local delegation preferences.
- [scripts/check-harness.py](scripts/check-harness.py) validates harness structure. Run `python3 scripts/check-harness.py` when changing the harness.

## Keeping these docs current

The Lookout team maintains this README and the [PRD](PRD.md). Update setup instructions and current status when scripts or implemented behavior change. Update the PRD when the team changes a product decision. Keep planned features labeled until the corresponding behavior has been verified.
