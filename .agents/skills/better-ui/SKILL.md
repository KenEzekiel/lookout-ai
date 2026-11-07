---
name: better-ui
description: Polishes the surfaces, icons and motion in your project with task-driven recipes for surfaces, icons, states, and purposeful motion. Use when styling radius, shadows, borders, icons, hover and press states, or transitions.
---

Read the [repository runtime contract](../poteto-mode/references/codex-tools.md) first. For Lookout product work, read `DESIGN.md`, `docs/features/README.md`, the affected feature records and `docs/verification.md` at the repository root. Existing product tokens and agreed behavior take precedence over generic style recipes. Treat numeric style recommendations as defaults unless an applicable accessibility requirement or demonstrated failure makes them necessary. Apply only the requested scope. Reviews are read-only unless changes are authorized. Use host-supported tools and keep implementation in the main agent.

# UI polish

This skill holds the visual polish for surfaces, icons and motion, with recipes for details that serve the interaction. It applies once the underlying interaction is sound, and a polish finding never outranks a broken interaction.

## Choose the effect before its recipe

Start with the user's task and frequency of use. Add an effect when it communicates state, preserves orientation, or serves an agreed expressive direction. Instant feedback is valid. Remove an effect that delays a repeated action or competes with content; an infrequent action alone does not justify animation.

Keep the project's component library, tokens, density, and established motion language. Numeric polish values below are starting recipes when no convention exists, not universal correctness rules. A deliberate, consistent difference from a recipe is not a finding; report a mismatch only with evidence of inconsistency or user impact. Accessibility requirements remain requirements.

Text wrapping, font rendering, tabular numbers and text spacing belong to `better-typography`. Hit areas, keyboard support, ARIA and the reduced-motion requirement belong to `better-accessibility`. Grouping, section spacing, breakpoints and spatial RTL belong to `better-layout`, except directional icon mirroring. Color tokens and contrast measurement belong to `better-colors`.

## Outer radius equals inner radius plus padding

Where nested surfaces share a visible, even inset, the outer radius is the inner radius plus the padding plus any border width. Past `24px` of padding, or where the padding is deliberately asymmetric, treat the layers as separate surfaces and keep each one's radius token. Recipes are in [surfaces.md](surfaces.md).

## Align optically where geometry looks off

Where geometric centering looks off, nudge by eye. Give a button `2px` less padding on its icon side, shift a play triangle toward its point and fix asymmetric glyphs in the SVG itself. Recipes are in [surfaces.md](surfaces.md#optical-alignment).

## Shadows for elevation, borders for structure

Where depth clarifies elevation, reuse the project's shadow treatment. If spacing already separates the content clearly, an extra border or shadow may be unnecessary. Keep borders on dividers, separators, table cells and selected states. Keep them on form inputs too, whose boundary needs 3:1 non-text contrast under `better-accessibility`. Focus rings belong to `better-accessibility` as well.

Forced-colors mode removes every `box-shadow`. Keep `border: 1px solid transparent` under a shadow ring so that mode still draws an edge. Recipes are in [surfaces.md](surfaces.md#shadow-recipes).

## Outline images in pure black or white

Where content images need edge separation, a `1px` outline inset by `1px` is one subtle option. Use `oklch(0 0 0 / 0.1)` in light mode and `oklch(1 0 0 / 0.1)` in dark. Never use a palette near-black, a tinted neutral or the accent color, because the tint shows as a colored fringe on the image edge. Skip transparent artwork such as logos and illustrations. The recipe is in [surfaces.md](surfaces.md#image-outlines).

## Transitions, not keyframes, for interactive state

Drive interactive state changes with CSS transitions or a motion library's springs, which retarget when the user reverses mid-flight. Keyframes run a fixed timeline and cannot reverse, so reserve them for sequences that run once. See [animations.md](animations.md).

## Press feedback can stay still

Use the existing pressed treatment; color, opacity, or an immediate state change can be sufficient. If scale fits the agreed interaction, `0.96` over `150ms` with `ease-out` is one starting recipe. Disabled controls never animate on press. Reuse an existing variant instead of adding a `static` prop solely to undo motion introduced by this skill. See [recipes](animations.md#scale-on-press).

## High-frequency interactions get no animation

Keystrokes, row hovers, tab switches, and repeatedly opened menus get immediate feedback. A brief color or opacity transition may help only if it adds no wait for action or reading. Inspect entrance, exit, and hover separately: a useful exit does not imply a useful entrance. Reserve expressive motion for moments where its meaning or agreed brand role earns the interruption.

Every animated state change also leaves a static cue in the form of a color, icon or label. Motion is never the only feedback channel.

## Gate motion behind the reduced-motion preference

`better-accessibility` owns the requirement, and no recipe here ships without it. Run movement, scale and blur only under `prefers-reduced-motion: no-preference`. Under reduced motion, use an immediate state change or a restrained opacity cross-fade while preserving feedback. Recipes for CSS, Tailwind and Motion are in [animations.md](animations.md#reduced-motion-fallback).

## Stage an entrance only when sequence matters

Where an agreed staged entrance communicates hierarchy, group content semantically. The `100ms` stagger and `300ms` entrance in [enter-exit.md](enter-exit.md) are examples; start with fewer animated groups and omit blur or travel unless they help. Keep task content readable and controls usable without waiting for choreography. Routine navigation needs no replayed entrance.

## Exits are shorter and smaller than enters

Remove an element instantly when motion adds no information. If an exit preserves orientation, keep it brief and no more prominent than the entrance; use the project's existing treatment. Slide fully out where the destination carries meaning, such as a drawer closing. Blur and travel in [enter-exit.md](enter-exit.md#exit-animations) are optional recipes.

## Skip state animations on first render

Set `initial={false}` on an `AnimatePresence` that wraps a state swap, so the default state does not animate in on mount. Never set it around an intentional entrance such as a staggered hero. See [animations.md](animations.md#skip-animation-on-page-load).

## Keep icon swaps legible

An icon can change immediately. Use a cross-fade when it clarifies continuity; scale, blur, and spring settings in [icon-transitions.md](icon-transitions.md) are optional expressive variants. Keep the final state and accessible label clear. Use an installed library or CSS; a small icon swap does not justify a new dependency.

A tab's icon swap and the actions a row reveals on hover fall under **High-frequency interactions get no animation**. Both recipes are in [icon-transitions.md](icon-transitions.md).

## Suppress transitions on theme switch

Disable every transition for the theme swap, force a style flush and restore transitions after the next frame. Otherwise every color transition fires at once and the switch smears. See the [recipe](animations.md#suppress-transitions-on-theme-switch).

## Transition only what changes

Name the exact properties, as in `transition-property: scale, opacity`, and never `all`. See [performance.md](performance.md).

## Name the animated property in will-change

Add `will-change` only after you see first-frame stutter, and name the property you animate: `scale` for `scale`, `transform` for `transform`. Limit it to transform properties, `opacity` and `filter`, and never use `all`. See [performance.md](performance.md#use-will-change-sparingly).

## Hover effects only on hover-capable pointers

Put hover-only styling behind `@media (hover: hover)`. On touch, `:hover` latches after a tap and reads as a stuck selected state. Tailwind 4's `hover:` variant already compiles under that query, and Tailwind 3's does not. Where a control draws its own pressed state, set `-webkit-tap-highlight-color: transparent` so the default gray flash does not double it.

## Contain scroll inside overlays

Give scrollable dialogs, drawers, menus and side panels `overscroll-behavior: contain`, so scrolling past their end never scrolls the page behind.

## Match icon stroke to text weight

An icon's rendered stroke tracks the weight of the text beside it, from `1.5px` at 400 to `2.5px` at 700. Use one icon library per surface. The table, sizing and grid rules are in [icons.md](icons.md).

## One SVG, recolored per state

Icons use `currentColor` and take hover, selected and disabled states from CSS color and opacity, never from separate assets. Outline is the default variant, and fill marks the active state. Under `dir="rtl"`, mirror only icons whose meaning follows reading direction. See [icons.md](icons.md#icons-in-rtl).

## Before you finish

| Detection | Fix |
| --- | --- |
| Padded parent and child with the same `rounded-*` or `border-radius` | Add the padding to the outer radius |
| `box-shadow: 0 0 0 1px` ring with no `border` beside it | `border: 1px solid transparent` |
| Image edge treatment adds a visible tinted fringe or unnecessary enclosure | Remove it or use a subtle neutral edge consistent with the project |
| `transition-all` or `transition: all` | Name the changing properties |
| `animation:` set on `:hover`, `.open` or another toggled class | A transition on the same properties |
| Press effect distracts, jitters, or conflicts with the project's control treatment | Remove it or reuse the established pressed state |
| `:active` scale with no `:disabled` exclusion | `enabled:active:` or `:not(:disabled):active` |
| Repeated bounce, blur, or scale adds no state or orientation information | Remove the effect; retain immediate feedback |
| `opacity: 0` in a base rule that only an `animation` reveals | Hidden state in the `from` keyframe, `animation-fill-mode: both` |
| `translate`, `scale`, `filter` or `motion.*` animation with no `prefers-reduced-motion`, `motion-safe:` or `MotionConfig` guard | Gate it and preserve feedback with a static change or opacity under reduced motion |
| Color transitions plus a theme toggle with no `disableTransitionOnChange` or override | The theme-switch suppression recipe |
| `will-change: all`, or `will-change` on an element that never animates | Name the animated property or delete it |
| `fill="#..."` or `stroke="#..."` inside an icon SVG | `currentColor` |
| Plain-CSS `:hover` or Tailwind 3 `hover:` outside `@media (hover: hover)` | Wrap it in the query |
| `overflow: auto` or `overflow-y-auto` on a dialog, drawer or menu with no `overscroll-behavior` | `overscroll-behavior: contain` |

## Reporting

**Severity.** `HIGH` breaks an interaction, as a keyframe toggle that cannot reverse or a hover state stuck on touch does. Two of `better-interface`'s escalation triggers land here and are `HIGH` on sight. One is motion that ignores `prefers-reduced-motion`, and the other is a state change carried by motion alone. `MEDIUM` is a visible inconsistency in surfaces, icons or motion. `LOW` is isolated polish.

**Verification.** Without a browser, read every state the component defines from the code, such as hover, pressed, selected, loading and empty, with its durations and easings. With one, walk each state and replay motion at 10% speed in the browser's Animations panel. Report every check you could not run as `Not verified`.

**Format.** Group findings under the principle each violates, ordered by severity, one row per root cause listing every location it appears in:

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

`Location` is `path/to/file:line`. `Why` names the principle and the user impact.

End with `Block` when any `HIGH` remains, `Approve` otherwise, leaving the rest in the table as work to do. Never `Approve` coverage you did not inspect. With nothing to report, state "No actionable UI-polish findings" and report verification.
