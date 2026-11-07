# Oracle

Oracle receives mentions and direct messages from verified members of its connected
Slack workspace, then follows replies in threads it owns. Bots, external workspace
members, edits, and ambient channel messages do not start work. The former
`SLACK_ALLOWED_USER_IDS` setting is no longer used. Every session runs in its own visible T3 Code thread. One global
FIFO keeps Oracle's project turns serial. Exact `stop`, `cancel`, or `abort` requests
abort active work and cancel queued work for that conversation. A fresh direct
request resumes a stopped conversation.

`dispatcher/` owns Slack routing, identity checks, and composition. `session/` owns
atomic snapshots, the T3 lifecycle, and `operating.md`. `tools/` owns disclosure
checks. Credentials and connection settings are read from the ignored `.env`.

Oracle is the `@lookout/oracle` pnpm workspace. It uses the repository's TypeScript,
Oxlint, and Oxfmt tooling and shared lockfile. From the repository root, run
`pnpm oracle` to start the dispatcher and `pnpm check` to verify the monorepo.
Tests use fake T3 and Slack adapters and a local HTTP fixture.

The dispatcher sets Slack's processing status while work is queued or running and
clears it when the conversation has no work left. Oracle writes request-specific
acknowledgments and progress as structured messages. Only those messages and the
final reply pass through the disclosure check and into the originating Slack
thread. A direct request cannot finish silently.

Before a coding turn, the bridge reads Slack thread history, preserves author IDs,
and includes bounded context with the current request and saved conversation
history. Supplemental messages blocked by disclosure rules are omitted. A bare
mention can refer to the preceding request. Missing history is
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

`session/operating.md` is read and checked before every coding turn, so policy
changes apply without restarting or interrupting an active turn. A disclosure
refusal explains the policy boundary without repeating the protected content.
Startup logs identify the configured T3 instance and model. This bridge does not
automatically poll GitHub or Linear or handle agent-container onboarding.

An instance started with the previous one-shot launcher needs one restart to
enter the supervised lifecycle. Future dispatcher updates reload automatically.

Interrupted turns retain context and require a fresh request. Ambiguous Slack sends
are recorded without automatic resending. Cancellation waits for T3 to confirm the
turn stopped; uncertain cancellation faults the factory and retains its instance
lock. A stale lock is never stolen automatically.

This bridge coordinates one cooperative local instance. T3's project controls govern
coding access and approvals. It is not a hostile-process filesystem sandbox and
does not promise rollback or exactly-once delivery. The disclosure gate checks
Slack output and shared Oracle source. Private disclosure rules remain in ignored
local state. Live Slack and T3 behavior requires separate runtime verification.
