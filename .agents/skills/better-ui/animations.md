# Animations

Recipes for interruptible transitions, press feedback, first-render behavior, theme switches and the reduced-motion fallback. Staged entrances and exits live in [enter-exit.md](enter-exit.md), and icon swaps in [icon-transitions.md](icon-transitions.md).

## Interruptible animations

| | CSS transitions | CSS keyframe animations |
| --- | --- | --- |
| **Behavior** | Interpolate toward the latest state | Run on a fixed timeline |
| **Interrupted** | Retarget mid-flight and reverse | Snap or restart from the beginning |
| **Use for** | Hover, toggle, open and close | Sequences that run once, such as enters and loading |

```css
/* Good: clicking again mid-animation reverses smoothly */
.drawer {
  transform: translateX(-100%);
  transition: transform 200ms ease-out;
}
.drawer.open {
  transform: translateX(0);
}

/* Bad: closing mid-animation snaps */
.drawer.open {
  animation: slideIn 200ms ease-out forwards;
}
```

## Scale on press

Use only when scale serves the agreed interaction. Existing static color or opacity feedback is sufficient for many controls; these values are optional recipes. Respect reduced motion in every implementation.

```css
.button {
  transition-property: scale;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}

.button:not(:disabled):active {
  scale: 0.96;
}
```

```tsx
// Tailwind
<button className="transition-transform duration-150 ease-out enabled:active:scale-[0.96]">
  Click me
</button>

// Motion
<motion.button whileTap={disabled ? undefined : { scale: 0.96 }} disabled={disabled}>
  Click me
</motion.button>
```

## Skip animation on page load

The icon recipe in [icon-transitions.md](icon-transitions.md#motion) shows `initial={false}` used correctly. It suits icon swaps, toggles, tabs and segmented controls, anything with a default state on page load.

Setting it around a first-time entrance skips that entrance entirely. Check the component on a full page refresh before adding it.

```tsx
// Bad: initial={false} skips the staggered page enter
<AnimatePresence initial={false}>
  <motion.div initial="hidden" animate="visible" variants={...}>
    ...
  </motion.div>
</AnimatePresence>
```

## Suppress transitions on theme switch

Inject a stylesheet that turns off every transition, force a style flush so the new colors commit while it applies, then remove it after the next frame:

```tsx
"use client";

import { useEffect } from "react";

export function DisableThemeTransitions() {
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      const style = document.createElement("style");
      style.append(
        document.createTextNode(
          "*,*::before,*::after{transition:none !important}"
        )
      );
      document.head.append(style);

      void document.body.offsetHeight; // forces a synchronous style flush

      requestAnimationFrame(() => {
        requestAnimationFrame(() => style.remove());
      });
    };

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return null;
}
```

The new theme resolves while the override is still in the document, so no transition starts. The nested `requestAnimationFrame` removes the override only after that paint.

That covers the OS-level change. An in-app toggle needs the same steps around its own flip: apply the override, change the theme, flush and remove. `next-themes` ships this as `disableTransitionOnChange`.

## High-frequency motion

Immediate feedback is the default for repeated actions. A brief color transition below is an option, not a required minimum duration.

```css
/* Good: high-frequency hover gets a minimal transition */
.row:hover {
  background-color: var(--surface-hover);
  transition: background-color 100ms ease-out;
}

/* Bad: every hover replays a full entrance */
.row:hover .row-icon {
  animation: bounceIn 500ms;
}
```

## Reduced-motion fallback

Use an instant state change or an opacity fade under reduced motion. The optional fade example below adds movement, scale and blur only without the preference:

```css
.panel {
  transition: opacity 150ms ease-out;
}

@media (prefers-reduced-motion: no-preference) {
  .panel {
    transition-property: opacity, translate, scale, filter;
    transition-duration: 300ms;
  }
}
```

In Tailwind, prefix movement, scale and blur utilities with `motion-safe:`. In Motion, wrap the app in `<MotionConfig reducedMotion="user">`. It turns off transform and layout animations under the preference and keeps opacity. Blur still runs there, so branch on `useReducedMotion()` where a recipe animates `filter`.
