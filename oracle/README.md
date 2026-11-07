# Oracle

Oracle receives mentions and direct messages from verified members of its connected
Slack workspace, then follows replies in threads it owns. Bots, external workspace
members, edits, and ambient channel messages do not start work. The former
`SLACK_ALLOWED_USER_IDS` setting is no longer used. Every session runs in its own
visible T3 Code thread. Up to 24 conversations run concurrently by default, with
one active turn per conversation and ordered follow-ups. Set
`ORACLE_MAX_CONCURRENT_SESSIONS` in `oracle/.env` to an integer from 1 to 128 to
change the limit. Requests beyond the active limit wait in the existing bounded
queue. CI-waiting conversations release their execution slots and retain their
place ahead of their own follow-ups. They do not stop unrelated ready work.
Exact `stop`, `cancel`, or `abort` requests abort active work and cancel queued
work only for that conversation. A fresh direct request resumes it.
Coding turns have no dispatcher time limit. Long-running work continues until it
finishes, is stopped, or the service shuts down.

Slack shows its native agent stop control while Oracle sets the thread's
`agents.sessions.setStatus` to `processing`. The app must subscribe to the
[`agent_session_stopped` event](https://docs.slack.dev/reference/events/agent_session_stopped/)
for that control to appear. Oracle does not post a custom stop-button message.

The Slack transport validates the event's channel, thread, user, and `event_ts`,
checks the callback envelope's workspace and verified human membership, then
routes it through the existing `Incoming` request with `text: "stop"`. The
dispatcher and session store still own cancellation, deduplication, and
persistence. The event timestamp identifies the click, so an old thread can be
stopped without treating its original message as a fresh request. Duplicate
event deliveries cannot cancel a later resumed turn. Oracle confirms the stop
in the originating thread and sets its status to `active`. Other conversations
keep running. `tests/slack.test.ts` covers this flow with the real dispatcher and
session store and offline Slack and runner fakes.

`dispatcher/` owns Slack routing, identity checks, and composition. `session/` owns
atomic snapshots, the T3 lifecycle, and `operating.md`. Credentials and connection
settings are read from the ignored `.env`.

Oracle is the `@lookout/oracle` pnpm workspace. It uses the repository's TypeScript,
Oxlint, and Oxfmt tooling and shared lockfile. From the repository root, run
`pnpm oracle` to start the dispatcher and `pnpm check` to verify the monorepo.
Tests use fake T3 and Slack adapters and a local HTTP fixture.

Oracle always requests high reasoning effort and fast mode for the configured T3
model. It pins `reasoningEffort=high` and `serviceTier=priority` on new threads and
reapplies both before every coding turn, including saved conversations. If T3
cannot acknowledge the settings, Oracle does not send the coding request.

Run the service from `.worktree/oracle` on branch `oracle`. Set `ORACLE_WORKSPACE`
in that checkout's `oracle/.env` to the absolute runtime worktree path. It must
match the checkout running the dispatcher. The runtime branch is reserved for
syncing `main`; project work never runs there. A changed runtime branch
blocks coding instead of silently accepting the new branch.

Each Slack conversation gets a linked worktree at
`<primary>/.worktree/oracle-task-<conversation-hash>` on its own
`oracle-task/<conversation-hash>` feature branch. New task worktrees start from
the main commit included in the runtime. Follow-ups reuse their worktree
and preserve uncommitted work. Separate conversations cannot dirty the runtime
or switch each other's branches. Existing main-checkout and runtime-bound T3
conversations continue in replacement task threads with persisted Slack history.
Changes to Oracle's own code use task worktrees and PRs too.

The initial task branch is a default. Oracle may switch feature branches to
continue an existing PR, or use its existing task worktree if the branch is
already checked out there. It preserves unrelated changes and active work.
Only the runtime `oracle` branch and the primary `main` checkout are reserved.

The workspace owner fetches `origin/main` before every coding turn and every 30
seconds in the background. It merges the fetched commit without waiting for the
`Verify` workflow. Pull request and main CI checks still run as configured, but
they do not gate runtime updates or coding requests. Requests already waiting for
CI in a saved session resume on startup. Logs identify the main commit and whether
the checkout is current or updated.

Runtime sync and task-worktree preparation share a short Git queue. Coding turns
run outside that queue in their separate worktrees. Each new worktree starts at
the exact main commit captured during preparation. Updating the runtime
never updates an active task's files. Local runtime commits survive merges. Dirty
runtime files defer an update, and conflicting merges are aborted. Slack reports
runtime dirty files, merge conflicts, and a
changed runtime branch with the maintainer action needed before a fresh request.
Task worktree edits do not block runtime updates. The primary checkout and `main`
are reserved for the maintainer. Feature changes use short-lived branches and PRs.

On macOS, install the persistent service from the clean runtime worktree on
branch `oracle` with
`pnpm oracle:service install`. You can pass an absolute worktree path after
`install` when running the command elsewhere. The installer registers
`~/Library/LaunchAgents/com.lookout.oracle.plist` with `launchd`. It starts at login
and restarts after exit.
Credentials remain in `oracle/.env` and are absent from the plist.

Each managed startup runs `pnpm install --frozen-lockfile` before starting the
dispatcher. Source or lockfile updates cancel active turns, then restart the whole
managed supervisor so its code and dependencies also refresh. Interrupted requests
resume on the new build after T3 confirms the old turns stopped. An installation
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

The Slack app needs `files:read`, `files:write`, `users:read`, `chat:write`, `assistant:write`, `app_mentions:read`, `reactions:write`,
and history scopes for the conversations it serves. Enable Socket Mode and subscribe
to `app_mention`, `message.channels`, `message.groups`, and `message.im` to receive
mentions and plain thread follow-ups. Also add `agent_session_stopped` under
**Event Subscriptions > Subscribe to bot events** and save the app settings.
Registering a Bolt listener does not configure Slack's server-side subscription.
Without the subscription, Slack shows a non-interactive loading indicator and
returns `missing_agent_session_stopped_event_subscription` from the status API.
Socket Mode delivers the native stop as an Events API callback without a public
Request URL. Invite Oracle to channels it should serve.
Enable the app's Agents feature for the native processing indicator. Oracle uses
`agents.sessions.setStatus` as described in the
[Slack agent guide](https://docs.slack.dev/ai/developing-agents/).

Oracle adds `white_check_mark` to the conversation's root message after a successful
turn's final reply is confirmed sent and no follow-up is queued. It removes its
own check mark when a new request is accepted, including after a restart.
The check marks a finished response, not a merged PR or a permanently closed
conversation. Silent, failed, cancelled, interrupted, and private-input turns do
not add it. Reaction failures report `slack_completion_unavailable` without
blocking replies or other conversations. Existing installations must add
[`reactions:write`](https://docs.slack.dev/reference/scopes/reactions.write/)
to the bot scopes and reinstall the app before reactions work. The dispatcher
owns reactions through its Slack transport; the coding agent never calls Slack
directly. Tests use real sessions and dispatcher code with offline Slack and T3
fakes in `tests/completion.test.ts`.

`pnpm oracle` supervises the dispatcher. Source and configuration changes trigger
an automatic restart once their contents settle. The dispatcher closes Slack intake,
cancels active turns, and saves their requests for continuation. It does not wait
for the tasks to finish naturally. The new process resumes those requests in the
same Slack and T3 threads and task worktrees before queued follow-ups. Each reload
attempt gets a persisted request ID so T3 accepts the continuation as a new turn.
Startup logs include the concurrency limit.
The supervisor starts a replacement only after the old process exits and releases its
lock. A failure or uncertain backend shutdown stops the service rather than
restarting over a potentially active coding turn. Runtime state and logs do not
trigger reloads. Install changed dependencies before expecting new code to start.

`session/operating.md` is read before every coding turn, so policy changes apply
without restarting or interrupting an active turn.
Verified Slack members can request changes to Oracle's source, operating
instructions, dispatcher configuration, and repository automation. Oracle makes
those changes in its task worktree and opens a pull request targeting `main`.
The user's explicit confirmation is still required to merge that pull request.
Startup logs identify the configured T3 instance and model. This bridge does not
automatically poll GitHub or Linear or handle agent-container onboarding.

An instance started with the previous one-shot launcher needs one restart to
enter the supervised lifecycle. Future dispatcher updates reload automatically.

Queued requests survive service updates and restarts. Update-triggered reloads also
resume interrupted active requests automatically. An ordinary shutdown or crash
still requires a fresh request for interrupted active work. An explicit `stop`
cancels active and queued work and remains stopped across reloads. Pending requests
remain protected from age-based pruning and session eviction until they finish or
are cancelled. Resume instructions require inspecting completed actions and current
state before continuing. External actions cannot be guaranteed exactly once.

Reloads still have a brief service restart and reconnect gap. Dependency installation
and backend stop confirmation remain part of the managed restart.

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

## Slack files

Mentions, DMs, and replies in owned threads accept attachments, including
file-only messages with Slack's `file_share` subtype. Event and thread history
retain file IDs. `dispatcher/files.ts` retrieves each file with `files.info`,
downloads its bytes with the bot token, and gives the session local paths under
the task worktree's ignored `oracle/.local/slack-files-*` directory. Images must
be inspected with the session's image-viewing tool. This uses the existing
shared local worktree rather than changing T3's text message API.

The current request's files take priority over preceding thread attachments.
Downloads are deduplicated and bounded to 10 files per turn and 20 MiB per file.
Failures remain visible to the agent with a reason, including access refusals,
external files, oversized files, and count limits. Slack credentials go only to
HTTPS `files.slack.com` URLs and redirects are refused, following
[Slack's file download guidance](https://docs.slack.dev/messaging/working-with-files/).
File contents are untrusted task data. Local artifacts stay outside Git; remove
these ignored directories when the conversation's files are no longer needed.

Each turn supplies a separate output directory. The agent returns generated
files with its final `reply` using `files: [{path, title?}]`. The runner resolves
paths and symlinks inside that output directory and checks type and size. The
transport preflights all files, obtains upload URLs, posts bytes, and completes
the upload with the original channel and thread plus the reply text. It uses
`files.getUploadURLExternal` and `files.completeUploadExternal`, never the retired
`files.upload`. Text-only replies retain their existing publication path.
Delivery records retain the output paths and mark failed or interrupted
publication uncertain; uploads are not automatically retried because completion
may already have shared the file. Staged uploads that fail before completion
remain unshared. Exactly-once delivery is not guaranteed.

Add `files:read` and `files:write` to the bot's OAuth scopes and reinstall the
Slack app before using this capability. No additional file-event subscription
is required. Files are read only from messages in conversations Oracle already
serves; this does not watch unrelated workspace uploads.

The file integration tests exercise real routing, session persistence, runner
prompts, local file bytes, output validation, and thread publication with fake
Slack and T3 boundaries. They cover PNG and text inputs, history attachments,
file-only requests, download failure and host checks, and generated outputs.
This change affects Oracle only and does not change Lookout product features.
