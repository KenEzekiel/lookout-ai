# Design loading as part of the journey

For every changed screen or async action, identify the initial load, background refresh, submission, media connection, success, and failure states that apply. A synchronous action needs no loader. Record intentional omissions instead of adding artificial waits.

- Reuse `LoadingState` and `LoadingStatus` in `apps/app/src/components/ui/loading.tsx` and the `loading` prop on `Button`. Keep request ownership in the screen or existing form.
- Reserve the expected content area with a layout-shaped skeleton for an initial load. Keep headings and navigation usable. Decorative placeholders must be hidden from assistive technology and must never look like real records or controls.
- Keep loaded content and entered values visible during refreshes and submissions. Put feedback beside the action or region that is waiting. Disable duplicate submission and conflicting actions, while retaining safe cancellation, navigation, and incident response.
- Give each wait a specific readable label and an accessible status. Do not announce every polling tick. Loading must not look like an empty result, a disconnected source, completed work, or authorization to reveal protected content.
- Use indeterminate feedback unless real progress is available. Never invent percentages, completion estimates, or minimum delays. Use stable media dimensions and keep playback controls reachable during buffering.
- End the loading state on success and failure. Keep actionable errors and retries. Reuse existing request deadlines and cancellation semantics; do not add a timer that implies a server operation has stopped when it has not.
- Honor reduced motion. Labels and static placeholders must communicate the same state without spinning, pulsing, or shimmer. Keep focus stable and verify narrow layouts and long pending labels.

Before publication, hold requests at the HTTP boundary to observe the pending state, then release them into success and failure. Cover duplicate submission, retained content, and retry with complete-screen integration tests where applicable. During required browser QA, inspect normal and reduced motion, first load, an action in flight, error recovery, and navigation away while waiting. Record the checked states and any gaps in the PR.
