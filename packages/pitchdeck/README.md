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

## Present

- Click **Present** or press **F** to toggle fullscreen. Browser permissions can prevent fullscreen; the player explains how to continue.
- Use arrow keys, Page Up, Page Down, or Space to navigate. Home and End jump to the first and last slide.
- Use the slide picker to jump directly to a slide. The URL hash remembers the current slide across reloads.
- Click **Notes** or press **N** to show speaker notes. Escape hides notes. Notes appear on the same screen, so keep them closed when sharing with the audience. Entering fullscreen hides notes automatically.
- Keyboard shortcuts leave focused buttons, links, and form controls to their normal browser behavior. Click the slide background to resume presentation shortcuts.
- Print from the browser to export all slides. Check the print preview and select landscape orientation for PDF output.

## Package design and verification

The builder sorts HTML files and embeds their markup, the shared stylesheet, and the player into one document. The player owns a bounded active slide index. It derives the picker, counter, and notes from the slide markup, so authors do not maintain a separate slide manifest.

Bundling the HTML avoids runtime fetches and permits direct file opening. Separate iframe pages would isolate styling but complicate keyboard navigation and offline packaging. The shared document keeps the hackathon workflow small.

Run `pnpm --filter @lookout/pitchdeck test` for complete-deck integration tests with Vitest, React Testing Library, and jsdom. They build the actual HTML and exercise its controls with the real player. Root `pnpm verify` also builds and checks this package. Fullscreen and visual layout require a real browser check.
