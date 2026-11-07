# Lookout AI design system and preferences

This is the design reference for Lookout AI. It covers the operator workspace and the operational-device screen. [PRD.md](PRD.md) owns the agreed product behavior when a visual example differs from it. The approved mockup is a visual study, and its image stays outside this repository.

## Approved identity and access screens

The approved identity is **Horizon**: a rising semicircle above a separate horizontal line, paired with the lowercase `lookout` wordmark. Use the shared [Brand component](apps/app/src/components/access/brand.tsx) in both access and capture headers and the [SVG favicon](apps/app/public/favicon.svg). The generated concept sheet was a direction study; these scalable assets are the implementation. The user approved this direction and the access mockup in the implementation conversation for this PR.

Use cobalt `#3459E6` for primary actions, graphite `#1A1A1D` for the canvas, warm white `#F7F6F2` for foregrounds, and periwinkle `#829AFF` for the mark and links on dark backgrounds. Amber remains an incident color. Access screens use restrained 8 px controls, 12 px list containers, and 24–30 px headings. Keep Geist Variable. Forms sit directly on the canvas; dialogs are raised surfaces.

The access shell has a small wordmark, the workspace name without a dropdown, Devices, Team, and Triggers navigation links, and account sign-out. Devices is the default destination; the `view` search parameter preserves Team navigation through reload and browser history. On narrow screens navigation wraps below the header, workspace names can wrap, and row actions remain readable.

Sign-in offers a secondary **Set up this device** link for password-free pairing. Signup explains the current password-reset limitation beside the password field. New accounts get one workspace-creation form and a secondary invitation-code action. Invitation links lead to joining directly; invalid links or codes have recovery actions without losing the account.

Devices lists authorization, not remote capture health. **Add device** opens a code-entry dialog and explains which device displays the code. **Use this device instead** opens a confirmation with a device name and explicitly states that all human sessions in that browser are signed out. Team lists people and roles; only owners see invitation and removal actions. Removing a member or device requires confirmation. Invitation results provide a copyable link and code with expiry, including a manual-copy fallback.

Paired devices show **Device connected** and **Open capture station**. Capture is available locally after the main-branch capture integration; AI detection and alerts remain unconnected. Do not imply that authorization means capture is running. All actions use specific pending labels and retain entered fields after a failed request.

## Product character

Lookout helps a camera owner notice an event, inspect evidence, and own the response. The operational device needs a calm, legible status screen for long-running capture. The operator needs a clear workspace when an alert interrupts someone. The two clients have separate controls and permissions, even when they share visual components and deployment infrastructure.

The visual direction is modern, warm, and video led. Dark graphite gives footage priority. Blue identifies navigation, selection, playback, and primary actions. Amber identifies the event that needs attention. Red is reserved for critical severity or failed actions. Text says what the camera showed, what the system inferred, and what happened next. A two-stage AI review is a check, not proof that an event occurred.

The parking lot and blocked-exit mockup establishes the layout. It is an example, not a selected hackathon demo. The agreed demos are a replayed car crash and a safely staged live fall. Use the same layout and components for both. Label replayed footage as replay, never as live.

## Operational-device layout

Give the source preview most of the desktop width. Align the adjacent panel with the top of the video frame, below its source label. Use that panel for source health, the assigned rule and its sync state, start and stop controls, and the latest reported event. On a phone, show a compact preview first, then capture controls and recent footage details. Keep source health with the controls rather than repeating it in another card. Make a paused, disconnected, permission-denied, or stale device unmistakable. Do not label a browser tab as actively monitoring when capture is suspended.

The device can choose or connect an assigned source and show local playback. It cannot create rules, change recipients or roles, acknowledge incidents, or resolve them. An operator defines rules and assigns them through the server. Show those rules as read-only on the device. When a confirmed event is reported, show its event time, report state, and clip-upload state. Keep the alert and response workflow in the operator client.

The device owns the assessment loop but does not run the model locally. A browser client sends selected frames through secure transport for remote assessment. Non-triggered video remains on the device and is not saved to Lookout's server. Do not imply that an illustrated placeholder is live footage or that a demo preview performs capture or AI assessment.

## Operator workspace layout

Use a slim top bar for the lowercase wordmark, source or place selector, primary destinations, and **New trigger**. The current source name belongs in that bar. Do not add a breadcrumb that repeats it. Keep profile or settings access at the far edge. **New trigger** belongs only in the operator client.

On a wide desktop, available video or replay occupies about two thirds of the main width. The incident panel occupies the rest. Use roughly 24 to 32 px outer padding and a 20 to 24 px gutter. The evidence is the largest object, while the incident title and response buttons remain visible without scrolling. Avoid a wall of small cards around the footage. The operator client does not need to remain open for monitoring to continue.

Place three evidence moments beneath the video when an incident is selected. Show a frame before the event, the earliest visible event frame supported by the evidence, and a later frame. Detection may happen after the event begins. Each moment needs an absolute time and a short description. These frames can support the first alert while the event clip is still being saved. Put a longer observation history in incident detail, rather than making the strip dense. When there is no incident, show a quiet monitoring state instead of filler analytics.

The incident panel starts with a plain-language title, such as **Possible fall** or **Possible crash**. Place the camera or location, event time, and sentence-case status nearby. Then show the available evidence, replay availability, a short timeline, the current owner and alert state, and the response actions. If no one has acknowledged the incident, show the configured escalation step and when it is due. The sequence answers what might have happened, where and when, what supports the alert, who owns the response, and what the recipient can do.

At narrower desktop widths, give the incident panel enough space to keep its actions readable, or place it below the video. On a phone, lead with the incoming alert or selected incident, then the response actions and available evidence. Keep the owner, event time, and evidence status visible without requiring a wide monitor view. The operator and operational-device clients may share code, but remain separate experiences. A polished native mobile app is outside the current demo scope.

## Video and incident point

Keep video controls in a compact dark strip along the bottom of the image. Show play or pause, replay duration, volume when audio exists, and full screen when those controls work. Controls must not cover the event itself. A live source on the operational device gets a clear live label. Label prerecorded input as replayed footage. When the device reports an event, place a small amber cue along the preview's lower edge and link it to the local event report. That cue is not a seek control. Show seekable incident replay in the operator client only after the server confirms that the saved clip is ready.

The operator's replay timeline has two distinct positions. A blue playhead marks the frame on screen. An amber incident point marks the earliest visible moment of the event supported by the evidence. The event time may precede the model's flag, review, and alert times. If onset is uncertain, label the point as approximate rather than implying frame-level precision. The amber point remains in place while the user seeks elsewhere. Hovering or focusing it reveals the event time and a short label. Activating it jumps to that frame. If several incidents share a clip, each point needs a distinct accessible name. Do not turn the bar into unlabeled dots.

An outline over the video is optional evidence annotation. Draw one only when the analysis has a meaningful region to show. Keep it thin and amber, and do not hide the scene. The temporal incident point remains useful even without a spatial outline, such as when a crash or fall spans much of the frame.

## Alert and evidence states

When the operational device reports a confirmed event, the server alerts the operator without waiting for the clip upload. On an open operator client, use a prominent incoming-alert view with the incident summary, **Open incident**, and **Acknowledge**. Sound is optional and only plays when the user has enabled it and the browser permits it. Keep the alert readable and actionable without sound or animation.

Offer an explicit **Enable alerts** step and a test sound in setup. Where supported and permitted, a background web push opens the incident. On iPhone and iPad, background web push depends on a supported Home Screen web app and permission granted after a user action. Show a clear setup limitation when push is unavailable or denied. Do not imply guaranteed lock-screen delivery, a system call screen, or a continuous ringtone. A background notification does not keep a capture tab recording.

Show replay availability in the operator client as **Preparing replay**, **Uploading replay**, **Replay ready**, or **Replay unavailable**. Keep incident details visible while the clip is being saved. If replay fails, explain the reason when known and keep the incident actionable. Show a playback control and amber incident point only when the server confirms the clip is ready. The clip should include footage around the event where the operational device has it; never label an unsaved clip as saved.

## Color and contrast

These are proposed tokens for implementation. Check their real combinations in the browser before treating them as final.

| Role           | Candidate | Use                                              |
| -------------- | --------- | ------------------------------------------------ |
| Canvas         | `#1A1A1D` | Outer app background.                            |
| Surface        | `#242428` | Incident panel and evidence cards.               |
| Raised surface | `#303035` | Hovered and selected controls.                   |
| Primary text   | `#F7F6F2` | Titles, actions, and key values.                 |
| Secondary text | `#C5C4CA` | Descriptions.                                    |
| Muted text     | `#AEB2BC` | Timestamps and supporting metadata.              |
| Action blue    | `#3459E6` | Filled primary buttons with white text.          |
| Signal blue    | `#829AFF` | Active navigation and the playhead.              |
| Incident amber | `#F3AA43` | Incident point, annotation, and attention state. |
| Critical red   | `#F17870` | Critical severity and failed actions.            |
| Resolved green | `#5FD0A1` | Confirmed completion and healthy monitoring.     |

Use several shades of graphite for depth. Opacity can quiet a decorative overlay, but should not make text faint. Target at least 4.5:1 contrast for normal text and 3:1 for meaningful controls and markers. Test against the actual rendered background, including overlays on video. Pair color with text or a shape so live, selected, critical, and completed states remain clear without color perception. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

A subtle warm charcoal gradient may soften the outer canvas. Keep video controls and incident text on stable surfaces. Dithering or grain is optional and belongs only in a restrained background treatment. It must not look like noise in the camera feed.

## Type and icons

Use Geist Variable, which the app already imports, as the primary font. Do not use Instrument Serif. Keep the wordmark lowercase. Use the following scale as a starting point, then adjust it against real content.

| Use               | Size and line height      | Treatment                          |
| ----------------- | ------------------------- | ---------------------------------- |
| Main screen title | 30 to 36 px, 1.1 to 1.2   | Semibold, slightly tight tracking. |
| Incident title    | 28 to 34 px, 1.15 to 1.25 | Semibold and plain language.       |
| Panel heading     | 20 to 24 px, 1.2 to 1.3   | Semibold.                          |
| Body and actions  | 15 to 16 px, 1.4 to 1.5   | Regular or medium.                 |
| Metadata          | 13 to 14 px, 1.35 to 1.45 | Muted, never faint.                |

Use negative letter spacing only on large headings, around `-0.01em` to `-0.025em` after visual review. Keep body text open. Use tabular numerals for clocks and durations so updating values do not shift. Use monospace only for technical identifiers when it helps. Avoid italics, all-caps subtitles, and eyebrow labels above titles. A period in a title is a deliberate tone choice, not a default.

Use Lucide icons at a consistent stroke and size. Pair status icons with words. Add an icon when it clarifies an action or state, not to decorate every line.

## Shape, spacing, and depth

Use a 4 px spacing base, with common gaps of 8, 12, 16, 24, and 32 px. Give the incident panel enough padding for the title, evidence, timeline, and actions to read as one sequence. Keep response buttons and video controls comfortable to activate.

Softly squircle-like corners suit the product, but ordinary CSS radius is enough unless a true squircle becomes a meaningful brand detail. Start near 18 px for the video and incident panel, 12 to 14 px for evidence cards, and 10 to 12 px for buttons. Use pills for short state labels such as **Needs attention**. Do not put ordinary metadata into pills.

Use space and surface shade before adding dividers or borders. A border belongs where a control needs an edge or adjacent surfaces would otherwise merge. Keep shadows broad and faint. Avoid nested boxes and a grid of hard outlines.

## Components and incident semantics

Use shadcn/ui components when they provide useful interaction and accessibility behavior, then style them with Lookout tokens. The app already configures the `base-nova` style, Base UI, CSS-variable theming, and Lucide icons. Generated components are local code that can be adjusted. See [shadcn/ui configuration](https://ui.shadcn.com/docs/components-json) and [theming](https://ui.shadcn.com/docs/theming).

| Need                                       | Component approach                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Acknowledge, dismiss, resolve, new trigger | Button variants with a clear primary action.                                    |
| Incident status                            | A small Badge or custom chip with sentence-case text.                           |
| Camera or place selection                  | Select or Popover, based on list length and search needs.                       |
| Evidence inspection                        | Dialog with the larger snippet and observation details.                         |
| Incoming alert                             | Responsive Dialog or focused alert view with direct response actions.           |
| Trigger setup                              | Form controls in a Dialog for a short rule, or a full page for more conditions. |
| Incident point details                     | Tooltip on hover and focus, with a separate accessible activation target.       |
| Long incident history                      | ScrollArea only when the content overflows.                                     |
| Video seeking                              | An accessible range control with explicit event markers.                        |

Operator trigger setup must make the rule's source, observable event, severity, recipient, and escalation delay visible. Offer starter templates and a blank custom trigger. Show a duration condition when persistence matters, without imposing one on crashes or falls. Let users review who will receive an alert before they turn a rule on.

The top destinations are pages, so use navigation links rather than Tabs for their visual appearance alone. The seek bar must support keyboard input, visible focus, and a screen-reader name with the current time. The amber incident point needs its own accessible name and jump action.

Keep severity, incident workflow, notification state, and replay availability separate. A critical incident can be acknowledged while its clip is still uploading. Opening a push or closing the incoming-alert view does not acknowledge the incident; closing the view only silences that device. **Acknowledge** means "I'm handling it" and stops further paging for that incident. After acknowledgment, keep **Resolve** available as the separate action that closes the response. **Dismiss** means the alert was incorrect and records feedback. If nobody acknowledges, the panel shows the configured follow-up step. A cleared scene adds evidence; it does not resolve the incident for the person. More observations of the same event update its incident and evidence instead of opening duplicates or sending repeated initial alerts.

Prefer "Possible fall in living room" to "Anomaly detected." Say "Alert sent," "Push unavailable," or "Alert delivery failed" only when that state is known. Keep alert delivery separate from replay availability. Separate what the camera shows from the model's assessment. Do not show a confidence percentage without a calibrated product meaning. Keep alert text short enough to scan during an interruption.

## Motion

Use motion to explain a change, not to make the dashboard busy. The app now installs Motion for React, the current package for what many developers still call Framer Motion. Its root provider respects the user's reduced-motion setting. The official [installation guide](https://motion.dev/docs/react-installation) uses the `motion` package and imports from `motion/react`.

- Button and control feedback can settle in about 120 to 160 ms.
- A panel change or new incident card can fade and move a few pixels over about 180 to 240 ms.
- The incident point can appear once when the event is created, then remain still.
- The playhead should follow playback position directly, without easing that makes it appear late.
- A new incident can briefly draw attention through color and a short entrance. Avoid looping pulses and bouncing alerts.
- Acknowledgment, dismissal, alert delivery, and replay availability need immediate text feedback. Animation is not the only confirmation.

Respect reduced-motion preferences. Motion for React provides `MotionConfig reducedMotion="user"` and `useReducedMotion`. Replace large transforms with opacity or an immediate state change when appropriate. Keep keyboard focus stable as panels change. See the [Motion accessibility guide](https://motion.dev/docs/react-accessibility).

## Tailwind and implementation map

The app uses Tailwind CSS 4. Its semantic shadcn variables live in `apps/app/src/styles.css`. The dark theme now maps the proposed palette, radius, and incident-state colors through CSS variables and Tailwind's `@theme inline`. [Tailwind theme variables](https://tailwindcss.com/docs/theme) describe that mechanism. Keep future color decisions there instead of scattering one-off hex values through JSX.

The app's `apps/app/components.json` selects `base-nova`, CSS variables, and Lucide. Button, Badge, Select, Dialog, and Tooltip are installed as local shadcn/ui components. Add further components only when a working screen needs them. Build the video player, temporal incident markers, and evidence strip as product components. Use Motion for actual state transitions rather than animating every container.

The `/device` route supports local video and permitted camera capture for a paired device. It shows source state and a bounded local buffer. Assessment, event reporting, clip upload, and assigned configuration are not yet wired. The paired-device home screen links to it. The operator workspace described here remains a design target.

## Preferences to preserve

"Considerate" means use the treatment when it helps the task. It does not mean every screen must include it.

- Use tags and pills only when they clarify state, category, or action.
- Keep italics rare. Do not use Instrument Serif.
- Tighten letter spacing selectively on large headings.
- Add detailed UI only when the detail helps someone decide or act.
- Use spacing and surface shades before dividers or bordered containers.
- Use multiple color shades and opacity deliberately while preserving contrast.
- Keep diagrams simple and explanations concise. Remove redundant text.
- Keep code breadcrumbs out of the product UI.
- Do not number sections or add eyebrow labels above headings.
- Use dithering, softly squircle-like corners, and gradients only when they improve the result.
- Do not use ASCII imagery.
- Use monospace sparingly.
- Do not set subtitles in all caps.
- Use periods in titles only when the tone calls for them.
