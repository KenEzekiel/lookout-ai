### Shipping

Follow root `AGENTS.md` and the [runtime contract](../references/codex-tools.md#scope-and-shipping). Require the user's explicit confirmation to merge the specific PR before performing this playbook. If confirmation is absent, present the PR and validation results and stop before merging, enabling auto-merge, or enqueuing it. No additional person's code review or separate agent verdict is required by project policy.

1. Inspect the PR's repository, base, head SHA, diff, mergeability, and check results. Its base must be `main`. Review your own work and verify the changed behavior with relevant checks. Do not merge known failures, unresolved conflicts, or unrelated changes.
2. Resolve blockers in the main agent and push updates to the PR branch. Rerun checks affected by the update. Do not bypass required checks or reviews with admin privileges or alter protections. If checks or repository-enforced reviews are pending, use the host's PR watcher and hand back rather than polling.
3. Confirm the user's merge authorization covers this PR and its current scope. If substantive changes followed confirmation, present them and obtain confirmation again. Reconfirm the destination and merge the verified head. On GitHub, use `gh pr merge <number> --repo <owner/repo> --squash --match-head-commit <verified-head>`. If it is queued rather than merged, report that accurately and watch through the host. Do not treat queue admission as completion.
4. Read back the PR state, base, and merge commit. Confirm it is merged into `main`, fetch the destination, and verify the merge commit is in its history. Update the local checkout only when safe for existing work. Do not discard changes or rewrite `main`.

**Reply:** PR link, verification performed, confirmed merge result, and any blocker.
