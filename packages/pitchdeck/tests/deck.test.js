import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

execFileSync(process.execPath, ["build.mjs"]);
const html = readFileSync("dist/index.html", "utf8");
const bundledScript = new DOMParser()
  .parseFromString(html, "text/html")
  .querySelector("#player").textContent;
const mountDeck = new Function(
  "document",
  bundledScript
    .replace("export function", "function")
    .replace("mountDeck(document);", "return mountDeck(document);"),
);
let unmount;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelector("script").remove();
  render(createElement("div", { dangerouslySetInnerHTML: { __html: body.innerHTML } }));
});

afterEach(() => {
  unmount?.();
  cleanup();
});

test("presents the built HTML deck with bounded navigation and a slide picker", async () => {
  unmount = mountDeck(document);
  const user = userEvent.setup();
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("responded");
  expect(screen.getByRole("button", { name: "Previous slide" }).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Tell Lookout");
  await user.selectOptions(screen.getByRole("combobox"), "5");
  expect(screen.getByRole("button", { name: "Next slide" }).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("6 / 6");
  await user.click(screen.getByRole("button", { name: "Previous slide" }));
  expect(window.location.hash).toBe("#5");
});

test("keyboard navigation supports first, last, and deep links without hijacking controls", async () => {
  window.history.replaceState(null, "", "#3");
  unmount = mountDeck(document);
  const user = userEvent.setup();
  expect(screen.getByRole("status").textContent).toBe("3 / 6");
  await user.keyboard("{ArrowRight}");
  expect(window.location.hash).toBe("#4");
  await user.keyboard("{End}{ArrowRight}");
  expect(window.location.hash).toBe("#6");
  await user.keyboard("{Home}{ArrowLeft}");
  expect(window.location.hash).toBe("#1");
  screen.getByRole("combobox").focus();
  await user.keyboard("{End}");
  expect(window.location.hash).toBe("#1");
});

test("notes are opt-in and follow the current slide", async () => {
  unmount = mountDeck(document);
  const user = userEvent.setup();
  expect(screen.queryByRole("complementary", { name: "Speaker notes" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Notes" }));
  expect(screen.getByRole("complementary").textContent).toContain("Introduce the team");
  await user.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByRole("complementary").textContent).toContain("one concrete example");
  await user.click(screen.getByRole("button", { name: "Notes" }));
  expect(screen.queryByRole("complementary")).toBeNull();
});

test("an unavailable fullscreen API leaves navigation usable and explains recovery", async () => {
  unmount = mountDeck(document);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Present" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Fullscreen is unavailable");
  await user.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByRole("status").textContent).toBe("2 / 6");
});

test("invalid and out-of-range links resolve to a real slide", async () => {
  window.history.replaceState(null, "", "#wrong");
  unmount = mountDeck(document);
  expect(window.location.hash).toBe("#1");
  window.history.replaceState(null, "", "#999");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(window.location.hash).toBe("#6");
  expect(screen.getAllByRole("group")).toHaveLength(1);
});

test("audience mode exposes only slides and cannot reveal speaker notes", async () => {
  window.history.replaceState(null, "", "/?view=audience#2");
  unmount = mountDeck(document);
  const user = userEvent.setup();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.getByRole("heading").textContent).toContain("Tell Lookout");
  expect(document.querySelectorAll("aside[data-notes]")).toHaveLength(0);
  await user.keyboard("n");
  expect(screen.queryByRole("complementary")).toBeNull();
  await user.keyboard("{ArrowRight}");
  expect(window.location.hash).toBe("#3");
  window.dispatchEvent(new MessageEvent("message", { data: { type: "lookout-slide", index: 4 } }));
  expect(window.location.hash).toBe("#3");
});

test("blocked audience windows leave the original deck usable", async () => {
  unmount = mountDeck(document);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Presenter view" }));
  expect(screen.getByRole("alert").textContent).toContain("Allow pop-ups");
  expect(screen.queryByRole("complementary")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Next slide" }));
  expect(window.location.hash).toBe("#2");
});
