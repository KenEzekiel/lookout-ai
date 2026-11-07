### Opening a PR

Follow the hackathon delivery policy in root `AGENTS.md` and the [runtime contract](../references/codex-tools.md#scope-and-shipping).

1. Work on a short-lived branch from current `main`. Preserve unrelated working changes. Use a worktree only when isolation is useful; implementation stays in the main agent.
2. Review the diff with `deslop`, run relevant checks, and commit a focused change. Use a concise Conventional Commit title and explain the behavior and validation in the PR description.
3. Push the feature branch and create a ready PR with `main` as its base. Use the available PR creation tool. Every PR targets `main`; for dependent changes, merge the prerequisite first and branch from updated `main`.
4. Link the PR to the T3 thread immediately after creation or a push to an existing PR, as the host requires.
5. Proceed to **Shipping** when the change is ready. Standing authorization allows merging without another person's review or another permission prompt. Do not request reviewers just to satisfy an inherited pstack ceremony.

**Reply:** PR link, checks performed, merge result, and any remaining blocker.
