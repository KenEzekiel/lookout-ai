# Lookout AI

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

## Validation and dependencies

Run `python3 scripts/check-harness.py`. Reading skills requires no package installation. Individual helpers may require Node.js, Bun, GitHub CLI, or formal-verification tools; inspect the relevant skill before using them. The bundled watcher dependencies have not been installed. T3 PR monitoring uses host watch tools instead.

The import is structurally checked, not an end-to-end certification of every workflow. Start a new Codex session and invoke `$poteto-mode` to check discovery in your host.

The copied pstack material is MIT-licensed; see `vendor/pstack/LICENSE`, the component licenses, and preserved notices. Those notices retain original upstream paths, which map from `plugins/pstack/skills/` to `.agents/skills/` and from `plugins/pstack/agents/` to `.agents/roles/` here.
