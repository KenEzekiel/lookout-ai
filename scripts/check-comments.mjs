import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import postcss from "postcss";

const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "utf8",
    }).split("\0"),
  ),
];
let violations = 0;
for (const file of files) {
  if (/^(vendor|\.agents|tests)\//.test(file)) continue;
  if (/(^|\/)(__tests__|tests)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
  if (/(^|\/)(routeTree\.gen\.ts|worker-configuration\.d\.ts)$/.test(file)) continue;
  if (!/\.(?:[cm]?[jt]sx?|css|jsonc|py)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  let lines = [];
  if (file.endsWith(".css")) {
    postcss
      .parse(source, { from: file })
      .walkComments((comment) => lines.push(comment.source.start.line));
  } else if (file.endsWith(".py")) {
    lines = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          'import io,json,sys,tokenize; print(json.dumps([t.start[0] for t in tokenize.generate_tokens(io.StringIO(sys.stdin.read()).readline) if t.type == tokenize.COMMENT and not (t.start == (1,0) and t.string.startswith("#!"))]))',
        ],
        { input: source, encoding: "utf8" },
      ),
    );
  } else {
    const input = file.endsWith(".jsonc") ? `(${source})` : source;
    const result = parseSync(file.endsWith(".jsonc") ? `${file}.js` : file, input);
    if (result.errors.length)
      throw new Error(`${file}: ${result.errors.map((error) => error.message).join(", ")}`);
    lines = result.comments.map((comment) => input.slice(0, comment.start).split("\n").length);
  }
  for (const line of lines) {
    console.error(`${file}:${line}: comments are allowed only in tests; move explanations to docs`);
    violations++;
  }
}
if (violations) process.exitCode = 1;
else console.log("No comments in maintained JavaScript, TypeScript, CSS, JSONC, or Python code.");
