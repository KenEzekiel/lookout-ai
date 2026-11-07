# Oracle

Oracle receives mentions and direct messages from verified members of its connected
Slack workspace, then follows replies in threads it owns. Bots, external workspace
members, edits, and ambient channel messages do not start work. The former
`SLACK_ALLOWED_USER_IDS` setting is no longer used. Every session runs in its own visible T3 Code thread. One global
FIFO keeps Oracle's project turns serial. Exact `stop`, `cancel`, or `abort` requests
abort active work and cancel queued work for that conversation. A fresh direct
request resumes a stopped conversation.

`dispatcher/` owns Slack routing, identity checks, and composition. `session/` owns
atomic snapshots, the T3 lifecycle, and `operating.md`. Credentials and connection
settings are read from the ignored `.env`.

Oracle is the `@lookout/oracle` pnpm workspace. It uses the repository's TypeScript,
Oxlint, and Oxfmt tooling and shared lockfile. From the repository root, run
`pnpm oracle` to start the dispatcher and `pnpm check` to verify the monorepo.
Tests use fake T3 and Slack adapters and a local HTTP fixture.

Oracle always requests high reasoning effort for the configured T3 model. It pins
high effort on new threads and reapplies it before every coding turn, including
saved conversations. If T3 cannot acknowledge the setting, Oracle does not send the
coding request.

Run the service from `.worktree/oracle` on its own branch. Set `ORACLE_WORKSPACE`
in that checkout's `oracle/.env` to the absolute worktree path. T3 binds new
threads to that existing worktree. Saved conversations from the main checkout
continue in replacement threads with their persisted Slack history.

The workspace owner fetches `origin/main` before every coding turn and every 30
seconds while idle. It applies an update only after the `Verify` workflow succeeds
for that exact commit on `main`. CI already runs on pull requests and pushes to
`main`, including merges. Pending, failed, missing, or unreadable checks leave the
current checkout in place. Coding requests wait when a newer commit is unverified.
Oracle saves the original request, acknowledges the wait once, and retries every
30 seconds. It continues in the same Slack thread after verification succeeds.
Users do not need to resend. Waiting does not consume the coding turn timeout.
Logs identify the main commit and whether the checkout is current or waiting for CI.

Sync and complete coding turns share one queue, so Git never updates files during
a turn. Local commits survive merges. Dirty files defer an update, and conflicting
merges are aborted. Resolve either case in Oracle's worktree before sending a fresh
request. The primary checkout and `main` are reserved for the maintainer. Oracle
refuses either as its coding workspace. Feature changes still use short-lived
branches and PRs.

On macOS, install the persistent service from the Oracle worktree with
`pnpm oracle:service install`. You can pass an absolute worktree path after
`install` when running the command elsewhere. The installer registers
`~/Library/LaunchAgents/com.lookout.oracle.plist` with `launchd`. It starts at login
and restarts after exit. It uses your existing GitHub CLI login to read CI results.
Credentials remain in `oracle/.env` and are absent from the plist.

Each managed startup runs `pnpm install --frozen-lockfile` before starting the
dispatcher. Source or lockfile updates drain accepted work, then restart the whole
managed supervisor so its code and dependencies also refresh. An installation
failure prevents dispatcher startup and is retried by `launchd`. A retained
instance lock still requires investigation; the service never steals a lock after
uncertain backend shutdown.

Use `pnpm oracle:service status` to inspect the managed process and
`pnpm oracle:service stop` to unload it until the next login. Logs are in
`oracle/.state/service.log`. The service requires this Mac to be awake with the
user logged in. GitHub Actions does not need access to this machine.

The dispatcher sets Slack's processing status while work is queued or running and
clears it when the conversation has no work left. Oracle writes request-specific
acknowledgments and progress as structured messages. Only those messages and the
final reply go into the originating Slack thread. A direct request cannot finish
silently.

Before a coding turn, the bridge reads Slack thread history, preserves author IDs,
and includes bounded context with the current request and saved conversation
history. A bare mention can refer to the preceding request. Missing history is
reported to the model so it can ask for context rather than invent it.

The Slack app needs `users:read`, `chat:write`, `assistant:write`, `app_mentions:read`,
and history scopes for the conversations it serves. Enable Socket Mode and subscribe
to `app_mention`, `message.channels`, `message.groups`, and `message.im` to receive
mentions and plain thread follow-ups. Invite Oracle to channels it should serve.
Enable the app's Agents feature for the native processing indicator. Oracle uses
`agents.sessions.setStatus` as described in the
[Slack agent guide](https://docs.slack.dev/ai/developing-agents/).

`pnpm oracle` supervises the dispatcher. Source and configuration changes trigger
an automatic restart once their contents settle and accepted work finishes. The
supervisor starts a replacement only after the old process exits and releases its
lock. A failure or uncertain backend shutdown stops the service rather than
restarting over a potentially active coding turn. Runtime state and logs do not
trigger reloads. Install changed dependencies before expecting new code to start.

`session/operating.md` is read before every coding turn, so policy changes apply
without restarting or interrupting an active turn.
Startup logs identify the configured T3 instance and model. This bridge does not
automatically poll GitHub or Linear or handle agent-container onboarding.

An instance started with the previous one-shot launcher needs one restart to
enter the supervised lifecycle. Future dispatcher updates reload automatically.

Queued and CI-waiting requests survive service updates and restarts. Requests
already running when the service stops retain context and require a fresh request.
Only work that has not started coding is retried automatically. A `stop` request
cancels both waiting and queued work. Pending requests remain protected from
age-based pruning and session eviction until they finish or are cancelled.

Ambiguous Slack sends
are recorded without automatic resending. Cancellation waits for T3 to confirm the
turn stopped; uncertain cancellation faults the factory and retains its instance
lock. A stale lock is never stolen automatically.

This bridge coordinates one cooperative local instance. T3's project controls govern
coding access and approvals. It is not a hostile-process filesystem sandbox and
does not promise rollback or exactly-once delivery. Requests, conversation history,
progress, replies, and shared source have no content filter. Names, paths, and
synthetic credential examples pass through unchanged. The coding agent is
instructed not to publish actual credentials or unrelated private information.
Live Slack and T3 behavior requires separate runtime verification.
