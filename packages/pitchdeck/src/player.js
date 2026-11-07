export function mountDeck(doc) {
  const win = doc.defaultView;
  const slides = [...doc.querySelectorAll("#slides > section")];
  const picker = doc.querySelector("#slide-picker");
  const previous = doc.querySelector("#previous");
  const next = doc.querySelector("#next");
  const present = doc.querySelector("#present");
  const notesToggle = doc.querySelector("#notes-toggle");
  const notesPanel = doc.querySelector("#notes-panel");
  const notice = doc.querySelector("#notice");
  let index = 0;

  slides.forEach((slide, position) => {
    const title = slide.querySelector("h1, h2").textContent;
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", `${position + 1} of ${slides.length}: ${title}`);
    const option = doc.createElement("option");
    option.value = String(position);
    option.textContent = `${String(position + 1).padStart(2, "0")} / ${title}`;
    picker.append(option);
  });

  function show(position) {
    index = Math.max(0, Math.min(position, slides.length - 1));
    slides.forEach((slide, number) => {
      slide.hidden = number !== index;
    });
    picker.value = String(index);
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    doc.querySelector("#counter").textContent = `${index + 1} / ${slides.length}`;
    doc.querySelector("#notes-content").textContent =
      slides[index].querySelector("aside[data-notes]")?.textContent ?? "No notes for this slide.";
    win.history.replaceState(null, "", `#${index + 1}`);
  }

  function fromHash() {
    const value = win.location.hash.slice(1);
    show(/^[1-9]\d*$/.test(value) ? Math.min(Number(value), slides.length) - 1 : 0);
  }

  function toggleNotes() {
    notesPanel.hidden = !notesPanel.hidden;
    notesToggle.setAttribute("aria-expanded", String(!notesPanel.hidden));
  }

  async function toggleFullscreen() {
    notice.hidden = true;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else {
        notesPanel.hidden = true;
        notesToggle.setAttribute("aria-expanded", "false");
        await doc.documentElement.requestFullscreen();
      }
    } catch {
      notice.textContent =
        "Fullscreen is unavailable. You can still present with the slide controls or your browser's fullscreen command.";
      notice.hidden = false;
    }
  }

  function onKey(event) {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.target.closest("input, textarea, select, button, a, [contenteditable]")
    )
      return;
    const moves = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      PageDown: index + 1,
      " ": index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      PageUp: index - 1,
      Home: 0,
      End: slides.length - 1,
    };
    if (Object.hasOwn(moves, event.key)) {
      event.preventDefault();
      show(moves[event.key]);
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      void toggleFullscreen();
    } else if (event.key.toLowerCase() === "n") toggleNotes();
    else if (event.key === "Escape" && !notesPanel.hidden) toggleNotes();
  }

  const controller = new win.AbortController();
  const options = { signal: controller.signal };
  previous.addEventListener("click", () => show(index - 1), options);
  next.addEventListener("click", () => show(index + 1), options);
  picker.addEventListener("change", () => show(Number(picker.value)), options);
  notesToggle.addEventListener("click", toggleNotes, options);
  present.addEventListener("click", toggleFullscreen, options);
  doc.addEventListener("keydown", onKey, options);
  doc.addEventListener(
    "fullscreenchange",
    () => {
      present.textContent = doc.fullscreenElement ? "Exit fullscreen" : "Present";
    },
    options,
  );
  win.addEventListener("hashchange", fromHash, options);
  fromHash();
  return () => controller.abort();
}
