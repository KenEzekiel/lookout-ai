# Present an HTML pitch deck

Run `pnpm pitchdeck` from the repository root, then open the local URL printed by Vite. This command builds the deck before serving it. After editing slides, run `pnpm --filter @lookout/pitchdeck build` and reload the page.

To present offline, run `pnpm --filter @lookout/pitchdeck build` and open `packages/pitchdeck/dist/index.html` in a browser. Copy that single file to another computer for the presentation. The starter uses system fonts and has no external assets or requests.

## Edit the slides

Each file in `slides/` contains one `<section class="slide">` with an `h1` or `h2`. Numeric filename prefixes determine the order. Add, remove, or reorder files and rebuild. Keep one section per file and at least one slide in the deck.

```html
<section class="slide">
  <p class="eyebrow">The problem</p>
  <h2>Your main point</h2>
  <p class="lead">One short explanation for the audience.</p>
  <aside data-notes hidden>Your speaking notes.</aside>
</section>
```

Use `src/style.css` for shared slide styles. Edit the document title and toolbar in `src/index.html` for a different project. Slide HTML is trusted author content, not an upload format for untrusted files. To keep a copied deck self-contained, embed any added images as data URLs. Remote URLs need a network connection, and relative assets must be copied separately.

The Lookout starter is based on the repository README and product direction. It is an editable pitch outline, not proof of implemented features. Before the hackathon, update the demo checklist to match the working app and add your team, verified results, and demo URL.

## Present with two screens on one laptop

1. Connect the second display or projector and choose extended displays in your operating system. Mirroring shows the same content on both screens.
2. Open the deck and click **Presenter view**. Allow the audience pop-up if the browser blocks it.
3. Move the new audience window to the second screen. Double-click the slide, or press **F**, to enter fullscreen. Escape exits fullscreen.
4. Keep the original window on your laptop. It shows the current slide, the next-slide preview, speaker notes, and navigation controls. Changes in either window keep the slides synchronized.

The audience window contains no visible controls or speaker notes. The **N** shortcut cannot reveal notes there. Click **Open audience window** to focus an existing audience window or reopen it after closing it. Reloading the audience window reconnects it to the current slide. Reloading or closing the presenter closes its audience window; start Presenter view again after a presenter reload.

Both windows run in the same browser on one laptop. Synchronization works offline through direct window messages. There is no shared session for separate devices. If fullscreen is unavailable, use the browser's fullscreen command on the audience window.

## Present on one screen

- Click **Present** or press **F** to toggle fullscreen. Browser permissions can prevent fullscreen; the player explains how to continue.
- Use arrow keys, Page Up, Page Down, or Space to navigate. Home and End jump to the first and last slide.
- Use the slide picker to jump directly to a slide. The URL hash remembers the current slide across reloads.
- Click **Notes** or press **N** to show speaker notes. Escape hides notes. Notes appear on the same screen, so keep them closed when sharing with the audience. Entering fullscreen hides notes automatically.
- Keyboard shortcuts leave focused buttons, links, and form controls to their normal browser behavior. Click the slide background to resume presentation shortcuts.
- Print from the browser to export all slides. Check the print preview and select landscape orientation for PDF output.

## Package design and verification

The builder sorts HTML files and embeds their markup, the shared stylesheet, and the player into one document. The presenter owns a bounded active slide index and sends it only to its audience window. The audience accepts updates only from its opener. It derives the picker, counter, and notes from the slide markup, so authors do not maintain a separate slide manifest.

Bundling the HTML avoids runtime fetches and permits direct file opening. Separate iframe pages would isolate styling but complicate keyboard navigation and offline packaging. The shared document keeps the hackathon workflow small.

Run `pnpm --filter @lookout/pitchdeck test` for complete-deck integration tests with Vitest, React Testing Library, and jsdom. They build the actual HTML and exercise its controls with the real player. Root `pnpm verify` also builds and checks this package. Fullscreen and visual layout require a real browser check.
