import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const font = await readFile(
  new URL(import.meta.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")),
);
const camera = await readFile(new URL("assets/parking-camera.jpg", root));
const slackRequest = await readFile(new URL("assets/oracle-slack-request.jpg", root));
const slackChecks = await readFile(new URL("assets/oracle-slack-checks.jpg", root));
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
  .replace("{{styles}}", () =>
    css
      .replace("__GEIST_FONT__", font.toString("base64"))
      .replaceAll("__CAMERA_IMAGE__", camera.toString("base64")),
  )
  .replace("{{slides}}", () =>
    slides
      .join("\n")
      .replace(
        "__SLACK_REQUEST_SCREENSHOT__",
        `data:image/jpeg;base64,${slackRequest.toString("base64")}`,
      )
      .replace(
        "__SLACK_CHECKS_SCREENSHOT__",
        `data:image/jpeg;base64,${slackChecks.toString("base64")}`,
      ),
  )
  .replace("__PITCHDECK_PLAYER__;", () => `${player}\nmountDeck(document);`);
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/index.html", root), html);
console.log(`Built ${files.length} slides at ${fileURLToPath(new URL("dist/index.html", root))}`);
