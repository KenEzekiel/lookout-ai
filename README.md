# Lookout AI

**Define what matters in a visual feed. Turn it into an incident someone owns.**

Lookout is an AI-assisted visual monitoring and incident-response project. Users describe events they care about, connect a camera or video source, and configure how to reach the responsible person. The intended flow combines visual assessment, evidence, phone alerts, acknowledgment, and escalation.

Think PagerDuty for visual events. Traffic is one use case; the product is designed around configurable rules rather than a single incident category.

## Product direction and current status

The hackathon demos target a **prerecorded car crash** and a **person falling in real time**, safely staged with a consenting participant. Both should use the same response flow:

Configure a rule → observe footage → verify a candidate → open an incident → call the owner → acknowledge and stop escalation.

**Current source status:** the repository contains the application scaffold and agent harness. The home page is a placeholder. Incident monitoring, AI assessment, evidence storage, notifications, authentication, and MCP are planned, not implemented in this snapshot.

Read the [PRD](PRD.md) for agreed behavior, demo outcomes, priorities, and open decisions. It is the source of truth for product direction. This README owns development setup and repository orientation.

## Develop

The pnpm workspace contains one full-stack application, `@lookout/app`, in `apps/app`. It uses TanStack Start, React, TypeScript, and Cloudflare Workers, with Tailwind CSS and shadcn/ui using Base UI.

Use Node.js **24.18.0**, pinned in [.node-version](.node-version), and pnpm **10.33.4**, pinned in [package.json](package.json).

```sh
pnpm install
pnpm dev
```

The development command selects port 3000. Open `http://localhost:3000` once the server reports it is ready. The Vite configuration includes Cloudflare's local Workers integration.

| Command                                    | Purpose                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm check`                               | Check formatting, lint, comments, TypeScript, and dependency boundaries. |
| `pnpm test`                                | Run Vitest UI integration tests with jsdom and MSW.                      |
| `pnpm verify`                              | Run all PR checks, integration tests, and the production build.          |
| `pnpm qa:browser`                          | Run optional Playwright smoke tests for manual QA of the built app.      |
| `pnpm build`                               | Build the application.                                                   |
| `pnpm preview`                             | Preview the build on port 3000.                                          |
| `pnpm format`                              | Apply formatting.                                                        |
| `pnpm lint:fix`                            | Apply available lint fixes.                                              |
| `pnpm --filter @lookout/app ui add button` | Add a UI component using the app's Base UI preset.                       |

CI runs `pnpm verify`. Playwright stays outside CI. For manual browser QA, install Chromium once with `pnpm exec playwright install chromium`. See [verification conventions](docs/verification.md) for mocking rules, temporary database requirements, and the comment ban. Generated route files and vendored agent tooling are excluded from the application formatting/lint scope. See [package scripts](package.json), [app scripts](apps/app/package.json), and [formatter configuration](.oxfmtrc.json) for exact behavior.

## Cloudflare deployment

The Worker configuration is in [apps/app/wrangler.jsonc](apps/app/wrangler.jsonc). Confirm the account and intended Worker before deploying.

```sh
# Build and validate the deployment bundle without uploading it.
pnpm --filter @lookout/app deploy:check

# Authenticate, then build and deploy when deployment is authorized.
pnpm --filter @lookout/app exec wrangler login
pnpm --filter @lookout/app deploy
```

Add service bindings to the Worker configuration as services are selected. Run `pnpm --filter @lookout/app cf-typegen` after changing bindings. Local secrets belong in `apps/app/.dev.vars`, which Git ignores; use Wrangler secrets for production values. Do not commit credentials.

These commands are defined in the repository. Their runtime behavior and deployment have not been re-tested as part of this documentation revision.

## Working together

The hackathon has a seven-hour total build window. Favor the complete demo flow and focused verification. Follow [AGENTS.md](AGENTS.md) for the current branch, PR, review, and merge policy; it is authoritative for delivery rules. Open PRs against `main` and wait for explicit user confirmation before merging.

The team uses a repository-owned agent harness to support development. The planned product agent and MCP integration serve Lookout users; they are distinct from the tools used to build Lookout.

- [.agents/skills](.agents/skills) contains local workflows and helper tools.
- [Runtime contract](.agents/skills/poteto-mode/references/codex-tools.md) adapts the harness to Codex and T3.
- [Model settings](.agents/pstack-models.md) define local delegation preferences.
- [scripts/check-harness.py](scripts/check-harness.py) validates harness structure. Run `python3 scripts/check-harness.py` when changing the harness.

The harness was copied from [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude/tree/df9bc05b818e2457ac23d3343e96e4ff284dd9e9). It is maintained directly in this repository, without a plugin installation or global configuration changes. Preserve the MIT [license](vendor/pstack/LICENSE), component licenses, and attribution in [vendor/pstack](vendor/pstack). Declare reused tooling separately from product work built during the hackathon.

## Keeping these docs current

The Lookout team maintains this README and the [PRD](PRD.md). Update setup instructions and current status when scripts or implemented behavior change. Update the PRD when the team changes a product decision. Keep planned features labeled until the corresponding behavior has been verified.
