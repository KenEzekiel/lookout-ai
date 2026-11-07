# Oracle

Oracle receives authorized Slack mentions and direct messages, then follows replies
in threads it owns. Every session runs in its own visible T3 Code thread. One global
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

Interrupted turns retain context and require a fresh request. Ambiguous Slack sends
are recorded without automatic resending. Cancellation waits for T3 to confirm the
turn stopped; uncertain cancellation faults the factory and retains its instance
lock. A stale lock is never stolen automatically.

This bridge coordinates one cooperative local instance. T3's project controls govern
coding access and approvals. It is not a hostile-process filesystem sandbox and
does not promise rollback or exactly-once delivery. The disclosure gate checks
Slack output and shared Oracle source. Private disclosure rules remain in ignored
local state. Live Slack and T3 behavior requires separate runtime verification.
