# Oracle

Oracle receives mentions and direct messages from verified members of its connected
Slack workspace, then follows replies in threads it owns. Bots, external workspace
members, edits, and ambient channel messages do not start work. The former
`SLACK_ALLOWED_USER_IDS` setting is no longer used. Every session runs in its own visible T3 Code thread. One global
FIFO keeps Oracle's project turns serial. Exact `stop`, `cancel`, or `abort` requests
abort active work and cancel queued work for that conversation. A fresh direct
request resumes a stopped conversation.

Each accepted request posts an acknowledgment with a **Stop Oracle** button in
its Slack thread before coding starts. Verified workspace teammates can click it
to use the same thread-scoped cancellation as a typed `stop` request. Duplicate
click deliveries do not cancel a later resumed turn. Other threads keep their
work. Existing threads receive a button on their next accepted request; older
messages are not rewritten.

The Slack transport parses button payloads into the existing `Incoming` request
with `text: "stop"`. The dispatcher and session store remain the owners of
cancellation, deduplication, and persistence. Keeping the button in a separate
acknowledgment preserves the formatting and length limits of model replies and
makes it available while a request is queued, before the model reports progress.
`tests/slack.test.ts` covers the posted control and the complete transport-to-session
cancellation path with offline Slack and runner fakes.

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

Run the service from `.worktree/oracle` on branch `oracle`. Set `ORACLE_WORKSPACE`
in that checkout's `oracle/.env` to the absolute runtime worktree path. It must
match the checkout running the dispatcher. The runtime branch is reserved for
syncing verified `main`; project work never runs there. A changed runtime branch
blocks coding instead of silently accepting the new branch.

Each Slack conversation gets a linked worktree at
`<primary>/.worktree/oracle-task-<conversation-hash>` on its own
`oracle-task/<conversation-hash>` feature branch. New task worktrees start from
the verified main commit included in the runtime. Follow-ups reuse their worktree
and preserve uncommitted work. Separate conversations cannot dirty the runtime
or switch each other's branches. Existing main-checkout and runtime-bound T3
conversations continue in replacement task threads with persisted Slack history.
Changes to Oracle's own code use task worktrees and PRs too.

The initial task branch is a default. Oracle may switch feature branches to
continue an existing PR, or use its existing task worktree if the branch is
already checked out there. It preserves unrelated changes and active work.
Only the runtime `oracle` branch and the primary `main` checkout are reserved.

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
merges are aborted. Slack reports runtime dirty files, merge conflicts, and a
changed runtime branch with the maintainer action needed before a fresh request.
Task worktree edits do not block runtime updates. The primary checkout and `main`
are reserved for the maintainer. Feature changes use short-lived branches and PRs.

On macOS, install the persistent service from the clean runtime worktree on
branch `oracle` with
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

## Resolve teammate identities

Slack names come from `users.info` using the existing `users:read` scope. Oracle
includes profiles for the requester, mentioned users, thread authors, and configured
teammates, up to 64 identities per turn. Only verified, active human members of the
connected workspace receive profiles. Profile fields include username, display name,
and real name, bounded to 200 characters each. Emails and custom profile fields
are not included. Slack profiles use the same process-local cache as membership
verification.

Copy `profiles.example.json` to `.local/profiles.json` in the Oracle service
checkout. Replace the example workspace ID, Slack user IDs, and GitHub logins
with confirmed identities. The file is ignored by Git. Its shape is:

```json
{
  "teamId": "TTEAM1",
  "users": [{ "slackUserId": "UTEAMMATE1", "githubLogin": "example-teammate" }]
}
```

Each Slack ID and GitHub login must appear at most once. The map accepts up to
64 people and must match the connected workspace. Oracle reads it before every
turn, so edits take effect without restarting. A missing file means no GitHub
accounts are mapped. Invalid, unreadable, duplicate, or foreign-workspace maps
produce an unavailable status without supplying any GitHub associations.

Oracle uses configured GitHub logins for assignments and asks in Slack when a
login is missing. It never guesses a login from a Slack name or the local GitHub
CLI account. An explicit Slack answer can resolve the current task. Maintainers
own durable map edits. A configured association does not grant project permissions.

Ordinary questions use the existing reply protocol and stay in the originating
Slack thread. The next Slack reply resumes the same conversation. Sensitive
questions and tool approvals use T3's private input flow. Only a generic notice
goes to Slack when private input is needed. This routing is an operating instruction
to the model, not an automatic content classifier. Unexpected backend input gates
retain the existing generic T3 fallback.

The dispatcher owns profile resolution and membership checks. The session runner
receives a typed `profiles` object alongside the request and thread context.
Keeping resolution at this boundary avoids giving the coding agent Slack tokens
or another message destination. A prompt-only directory would leave names
unresolved, while matching names or emails automatically would guess account
ownership. The explicit workspace-scoped map supplies associations for verified
members without changing transport permissions.

## Slack connection

The Slack app needs `users:read`, `chat:write`, `assistant:write`, `app_mentions:read`,
and history scopes for the conversations it serves. Enable Socket Mode and subscribe
to `app_mention`, `message.channels`, `message.groups`, and `message.im` to receive
mentions and plain thread follow-ups. Invite Oracle to channels it should serve.
The **Stop Oracle** button uses
[Socket Mode's basic interactivity](https://docs.slack.dev/tools/bolt-js/creating-an-app/#sending-and-responding-to-actions).
It delivers `block_actions` payloads without a public Request URL. The action
listener acknowledges clicks before membership lookup and cancellation.
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
