import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const font = await readFile(
  new URL(import.meta.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")),
);
const files = (await readdir(new URL("slides/", root)))
  .filter((file) => file.endsWith(".html"))
  .sort();
if (files.length === 0) throw new Error("Add at least one HTML slide to slides/.");
const slides = await Promise.all(
  files.map((file) => readFile(new URL(`slides/${file}`, root), "utf8")),
);
const [template, css, player] = await Promise.all(
  ["src/index.html", "src/style.css", "src/player.js"].map((file) =>
    readFile(new URL(file, root), "utf8"),
  ),
);
const html = template
  .replace("{{styles}}", () => css.replace("__GEIST_FONT__", font.toString("base64")))
  .replace("{{slides}}", () => slides.join("\n"))
  .replace("__PITCHDECK_PLAYER__;", () => `${player}\nmountDeck(document);`);
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/index.html", root), html);
console.log(`Built ${files.length} slides at ${fileURLToPath(new URL("dist/index.html", root))}`);
