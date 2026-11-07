# Lookout AI

Hackathon project with a **seven-hour total implementation budget**. Prioritize a working end-to-end demo and focused verification. The timebox applies to the whole project, not each agent session.

All changes go through PRs targeting `main`. Agents open completed PRs after relevant checks and wait for the user's explicit merge confirmation. No additional person's code review is required; merge confirmation still is. Direct pushes to `main` are no longer the workflow. See [AGENTS.md](AGENTS.md) for the standing delivery policy.

pnpm workspace with one full-stack application in `apps/app`, named `@lookout/app`.
The app uses TanStack Start, React, TypeScript, and Cloudflare Workers. UI components
use shadcn/ui with Base UI and Tailwind CSS. Oxfmt formats the project and Oxlint
checks application code.

This is project setup only. The home page is a placeholder. Database, authentication,
video processing, AI providers, and notifications are not configured.

## Develop

Use Node.js 24, pinned in `.node-version`, and pnpm 10.33.4.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The Cloudflare Vite plugin runs the server in the local
Workers runtime. No Cloudflare account is needed for local development.

```sh
pnpm check
pnpm build
pnpm preview
```

`pnpm check` runs formatting, linting, and TypeScript checks. Use `pnpm format` and
`pnpm lint:fix` to apply fixes. The generated route tree is excluded from formatting
and linting. Vendored agent tooling is outside the application checks.

Add UI components inside the app package:

```sh
pnpm --filter @lookout/app ui add button
```

The app's `components.json` selects the Base UI preset. Components stay in the app
until another package needs to share them. Add future workspace packages under
`packages/` and reference them with `workspace:*`.

## Cloudflare Workers

Check the deployment bundle without uploading:

```sh
pnpm --filter @lookout/app deploy:check
```

When ready to deploy, authenticate and deploy from the app package:

```sh
pnpm --filter @lookout/app exec wrangler login
pnpm --filter @lookout/app deploy
```

Set the Worker name in `apps/app/wrangler.jsonc`. Add bindings there when services
are selected, then run `pnpm --filter @lookout/app cf-typegen` to refresh their types.
Store local secrets in `apps/app/.dev.vars`, which Git ignores. Use Wrangler secrets
for production values.

## Agent tooling

A repository-owned, Codex-first pstack harness copied from [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude) at `df9bc05b818e2457ac23d3343e96e4ff284dd9e9`.

Open this repository in a fresh Codex session to load `AGENTS.md` and discover its 67 skills. Use `$poteto-mode` for workflow routing, `$architect` for design, `$tdd` for test-driven implementation, or `$setup-pstack` for local model preferences. You can also ask Codex to read the corresponding `.agents/skills/<name>/SKILL.md` directly if the host has not refreshed skill discovery.

## Customize

- `AGENTS.md` controls automatic routing and repository policy.
- `.agents/skills/` contains the editable workflows, principles, playbooks, references, and helper scripts.
- `.agents/skills/poteto-mode/references/codex-tools.md` adapts inherited instructions to native Codex and T3.
- `.agents/pstack-models.md` controls local model preferences; defaults inherit the session.
- `.agents/roles/` contains reusable agent briefs, not registered plugin agents.
- `vendor/pstack/` preserves licenses, notices, the source revision, and original file hashes.

This is an ordinary copy, with no submodule, plugin registration, session hooks, global configuration changes, or automatic updates. Upstream multi-runtime references remain for provenance and customization. The local runtime contract takes precedence over them. Update by comparing against the recorded revision and merging selected changes; blindly recopying upstream would overwrite local edits.

## Execution policy

The main agent implements all project changes, including tests, configuration, documentation, and fixes. Subagents are optional for bounded research, review, or verification when useful. Prefer direct work and one focused helper over automatic panels. Helpers return findings; the main agent applies changes. This policy overrides the inherited delegated-build instructions in every skill and playbook, including arena and autopilot.

## Validation and dependencies

Run `python3 scripts/check-harness.py`. Reading skills requires no package installation. Individual helpers may require Node.js, Bun, GitHub CLI, or formal-verification tools; inspect the relevant skill before using them. The bundled watcher dependencies have not been installed. T3 PR monitoring uses host watch tools instead.

The import is structurally checked, not an end-to-end certification of every workflow. Start a new Codex session and invoke `$poteto-mode` to check discovery in your host.

The copied pstack material is MIT-licensed; see `vendor/pstack/LICENSE`, the component licenses, and preserved notices. Those notices retain original upstream paths, which map from `plugins/pstack/skills/` to `.agents/skills/` and from `plugins/pstack/agents/` to `.agents/roles/` here.
