import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL("packages/pitchdeck/build.mjs", root))], {
  stdio: "inherit",
});
copyFileSync(
  new URL("packages/pitchdeck/dist/index.html", root),
  new URL("apps/app/public/pitch-deck.html", root),
);
