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
  const presenter = doc.querySelector("#presenter");
  const nextPanel = doc.querySelector("#next-panel");
  const nextSlide = doc.querySelector("#next-slide");
  const audience = new URLSearchParams(win.location.search).get("view") === "audience";
  doc.documentElement.dataset.view = audience ? "audience" : "deck";
  let audienceWindow = null;
  let index = 0;

  function sendSlide() {
    if (audienceWindow && !audienceWindow.closed) {
      audienceWindow.postMessage({ type: "lookout-slide", index }, "*");
    }
  }

  function openPresenter() {
    notice.hidden = true;
    if (audienceWindow && !audienceWindow.closed) {
      audienceWindow.focus();
      sendSlide();
      return;
    }
    const url = new URL(win.location.href);
    url.searchParams.set("view", "audience");
    audienceWindow = win.open(url.href, "_blank", "popup,width=1280,height=720");
    if (!audienceWindow) {
      notice.textContent =
        "The audience window was blocked. Allow pop-ups for this page, then click Presenter view again.";
      notice.hidden = false;
      return;
    }
    doc.documentElement.dataset.view = "presenter";
    presenter.textContent = "Open audience window";
    doc.querySelector("#presenter-help").hidden = false;
    nextPanel.hidden = false;
    notesPanel.hidden = false;
    notesToggle.hidden = true;
    show(index);
  }

  function onMessage(event) {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (audience && event.source === win.opener && event.source !== null) {
      if (
        message.type === "lookout-slide" &&
        Number.isInteger(message.index) &&
        message.index >= 0 &&
        message.index < slides.length
      )
        show(message.index);
    } else if (!audience && audienceWindow && event.source === audienceWindow) {
      if (message.type === "lookout-ready") sendSlide();
      else if (
        message.type === "lookout-navigate" &&
        Number.isInteger(message.index) &&
        message.index >= 0 &&
        message.index < slides.length
      )
        show(message.index);
    }
  }

  function navigate(position) {
    show(position);
    if (audience && win.opener && !win.opener.closed) {
      win.opener.postMessage({ type: "lookout-navigate", index }, "*");
    }
  }

  function slideTitle(slide) {
    const heading = slide.querySelector("h1, h2").cloneNode(true);
    heading.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith(" "));
    return heading.textContent.trim();
  }

  slides.forEach((slide, position) => {
    const title = slideTitle(slide);
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
      slides[index].querySelector("aside[data-notes]")?.textContent.trim() ??
      "No notes for this slide.";
    win.history.replaceState(null, "", `#${index + 1}`);
    if (!audience) {
      const upcoming = slides[index + 1];
      nextSlide.replaceChildren();
      if (upcoming) {
        const preview = upcoming.cloneNode(true);
        preview.hidden = false;
        preview.removeAttribute("id");
        preview.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
        nextSlide.append(preview);
      }
      doc.querySelector("#next-caption").textContent = upcoming
        ? slideTitle(upcoming)
        : "End of presentation";
      sendSlide();
    }
  }

  function fromHash() {
    const value = win.location.hash.slice(1);
    show(/^[1-9]\d*$/.test(value) ? Math.min(Number(value), slides.length) - 1 : 0);
  }

  function toggleNotes() {
    if (audience || doc.documentElement.dataset.view === "presenter") return;
    notesPanel.hidden = !notesPanel.hidden;
    notesToggle.setAttribute("aria-expanded", String(!notesPanel.hidden));
  }

  async function toggleFullscreen() {
    notice.hidden = true;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else {
        if (doc.documentElement.dataset.view !== "presenter") {
          notesPanel.hidden = true;
          notesToggle.setAttribute("aria-expanded", "false");
        }
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
      navigate(moves[event.key]);
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      void toggleFullscreen();
    } else if (event.key.toLowerCase() === "n") toggleNotes();
    else if (event.key === "Escape" && !notesPanel.hidden) toggleNotes();
  }

  const controller = new win.AbortController();
  const options = { signal: controller.signal };
  previous.addEventListener("click", () => navigate(index - 1), options);
  next.addEventListener("click", () => navigate(index + 1), options);
  picker.addEventListener("change", () => navigate(Number(picker.value)), options);
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
  win.addEventListener("message", onMessage, options);
  win.addEventListener("pagehide", () => audienceWindow?.close(), options);
  presenter.addEventListener("click", openPresenter, options);
  if (audience) {
    doc.title = "Lookout AI · Audience";
    doc
      .querySelectorAll(".toolbar, .controls, #notes-panel, #next-panel, #presenter-help")
      .forEach((element) => {
        element.hidden = true;
      });
    slides.forEach((slide) =>
      slide.querySelectorAll("aside[data-notes]").forEach((note) => note.remove()),
    );
    doc.querySelector("#slides").addEventListener("dblclick", toggleFullscreen, options);
  }
  fromHash();
  if (audience && win.opener) win.opener.postMessage({ type: "lookout-ready" }, "*");
  return () => controller.abort();
}
