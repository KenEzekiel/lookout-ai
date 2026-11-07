# Repository Codex runtime contract

Read this before executing any copied pstack skill. This contract overrides the inherited Claude and plugin-specific instructions in skills, playbooks, agent briefs, and other runtime references. Host instructions and the user's scope always take precedence.

## Paths and activation

Skills are native repository skills under `.agents/skills/<name>/SKILL.md`. Invoke as `$<name>`, or read that file and follow it; there is no `Skill` tool or `pstack:` plugin namespace. Resolve `<plugin>` to the absolute `.agents` directory when using retained script examples. Relative links between skills keep their existing layout. New verification skills belong in `.agents/skills/`, and repository instructions belong in `AGENTS.md`, not `CLAUDE.md`.

`AGENTS.md` supplies routing. There are no session hooks to trust or enable. Do not install a plugin, run its generator, or edit global configuration. `$setup-pstack` edits `.agents/pstack-models.md` only. The upstream `models.json`, override-sheet format, hook settings, and model-generation commands do not apply.

## Native tools

Use the actual tools exposed by the current session: shell execution for commands and `rg`, `apply_patch` for edits, `update_plan` for plans, and the available web tools for research. Use a question tool if available and suitable, otherwise ask plainly. `AskUserQuestion`, `TaskCreate`, `TodoWrite`, and Claude `Agent` examples describe intent, not callable tools.

Read referenced skill files on demand. Use the host's skill-authoring guidance for `plugin-dev:skill-development`. Do not assume an app driver, `/loop`, or `/verify` is installed. Verify with the available supported tools and report any part you could not observe.

For every frontend change, apply the [loading-state guidance](../../better-interface/loading-states.md) during planning, implementation, and verification. Include meaningful initial, refresh, submission, and media feedback where the journey waits.

For frontend features and bug fixes that affect a user journey, the Feature and Bug fix workflows must include manual verification in a real browser before completion or a ready PR. Delegate this step to one contained QA subagent. Give it the affected journey, expected outcomes, build or commit, runtime setup, and evidence location. The subagent performs browser verification and returns findings and evidence without editing project files or delegating further. The main agent owns fixes and PR updates. If delegation is unavailable, report the blocker and keep the PR in draft unless the user explicitly waives the gap. Follow `docs/verification.md` at the repository root and the host's browser-tool restrictions. Record the exercised journey and observed results in the PR description. Follow the PR template's manual QA structure with short bullets for setup, individual steps and results, evidence, and gaps. Keep one check per bullet and separate manual observations from automated coverage. Embed screenshots from the manual QA run and add a demo video when screenshots cannot adequately show the behavior. Keep QA media out of version control. Upload it as GitHub PR attachments, verify the saved links, and follow `docs/verification.md` for publication and blocked evidence. Automated checks alone are insufficient. If verification is blocked, report the blocker and keep the PR in draft unless the user explicitly waives the documented gap.

## Lookout feature compatibility

For Lookout product work, read the [feature-map guide](../../../../docs/features/README.md) before planning or implementation. Load the relevant product-area files together, then follow prerequisite codes and search reverse references for consumers. Carry affected `F-` codes into the plan and any authorized issue or PR. Oracle and harness-only work do not need product feature records; explain their lack of product impact in the PR.

During implementation, preserve the recorded contracts and complete the required connections to existing features. Update affected records in the same PR for behavior, decisions, source locations, dependencies, or verification changes. Use the guide's statuses and keep incomplete integration explicit. Do not claim a planned prerequisite works because a fixture or isolated component passes.

Before publication, verify the affected features and consumers, run `pnpm check:features`, and include feature impact and remaining wiring gaps in the PR template. Structural validation does not replace behavior tests or required browser verification. Read-only investigation and conversation-only planning consult the records but do not authorize editing them or publishing issues.

## Delegation and models

The main agent owns all implementation: source code, tests, configuration, documentation, generated project changes, refactors, and fixes. Never delegate implementation, including through nested agents, arena candidates, or PR owners. Subagents may research, review, or verify existing work and return findings; the main agent applies every change.

Default to doing work directly. Use a subagent only when a bounded research question, independent review, or verification task adds clear value. Start with one; add another only for a distinct need or an explicit request. Do not spawn an explainer, synthesizer, or coordinator for work the main agent can finish. Do not delegate merely because a task spans files, crosses a function boundary, is lengthy, or uses a skill whose upstream version fans out.

Keep delegated tasks read-only with respect to project files. Verification may run commands and produce disposable reports or build artifacts, preferably in an isolated scratch location, but must not edit source, tests, configuration, or docs to make checks pass. Return failures and proposed fixes to the main agent. Prohibit nested delegation in each brief.

These rules override all inherited spawn, mandatory panel, code-writing worker, and delegated-build instructions, including arena, swarm, orchestrate, autopilot, and review skills that tell reviewers to fix findings. Run implementation steps serially in the main agent. Research alternatives and critique may still be delegated under the limits above. Ordinary skill invocation is not permission to delegate implementation. Only a direct user change to this policy can allow it.

Read `.agents/pstack-models.md`. All roles inherit the session's model and effort unless the user explicitly chooses otherwise. Ignore upstream Claude aliases (`opus`, `fable`, `sonnet`, `haiku`), automatic effort changes, mandatory diverse panels for routine edits, and transcript-based effort probing. Never silently substitute an unavailable requested model.

For permitted research, review, or verification that completes in this turn on the same provider, use native `spawn_agent` and wait for the result with `wait_agent`; omit model and effort overrides to inherit. Tools and supported parameters depend on the host. Reusable briefs live in `.agents/roles/`; load the relevant brief into a concrete task rather than supplying a nonexistent `subagent_type`. A brief is not permission to expand scope.

In T3, follow the host's orchestration rules. Use `delegate_task` for another provider, user-requested settings, isolated worktrees, background work, or an explicit delegate_task request. Check `orchestrator_capabilities` first. Never create a delegate checkout in the shell. Follow a running delegate's `next` rather than polling. Do not replace unavailable delegation with another provider or a CLI unasked.

Review returned findings and apply accepted fixes yourself. If independence or diversity was requested but unavailable, state the limitation; a sequential self-review does not meet that requirement. Continue work that does not depend on it.

## Scope and shipping

Follow the hackathon delivery policy in root `AGENTS.md`. The project has a seven-hour total implementation budget. All repository changes use a short-lived branch and a PR targeting `main`; never push directly to `main` or target another feature branch. Standing authorization permits implementing, pushing the feature branch, and opening a PR after relevant checks. Present the PR and wait for the user's explicit confirmation before merging that PR, enabling auto-merge, or adding it to a merge queue. Implementation, push, PR creation, and check-fixing requests do not authorize a merge. No additional person's code review or independent agent verdict is required by project policy. Earlier automatic-merge authorization is revoked. Respect actual repository protections and required checks. This overrides inherited reviewer-verdict and stack-base requirements. It does not authorize deployment, external messaging, or unrelated work.

In T3, link each PR immediately after creating or pushing it using `link_pull_request`. The [open-pr skill](../../open-pr/SKILL.md) owns PR publication and automatic CI follow-up. Use `watch_pull_request` after opening a PR when CI is pending, for requested monitoring, or for a requested merge awaiting checks/reviews; finish updates first, watch, and yield for the host event. Diagnose failures and push focused fixes on wake. Stop the watcher when checks pass or a concrete blocker ends follow-up. Do not run the bundled `watch-pr`, `gh --watch`, sleep loops, or background polling for these tasks. Respect host browser and visualization rules rather than inherited driver recipes.

## Transcripts and optional helpers

For recall, reflection, session pickup, eval, or audit, use host-provided thread history or the current session's digest first. In T3, read a specified thread with `t3_thread_read`. In standalone Codex, rollouts may be in `${CODEX_HOME:-~/.codex}/sessions` and `archived_sessions`; match `session_meta.payload.cwd` to this repository or its worktrees before reading conversation content. Never use the Claude transcript finder to identify a Codex session, scan unrelated projects, or invent an audit when history is unavailable.

Helper files are retained for customization, not automatically executed. Inspect their behavior and dependencies before running them. `worktree-audit.mjs` includes multiple runtimes and is advisory; do not infer authorization to delete worktrees. Script checks are not proof that a live workflow has succeeded.
