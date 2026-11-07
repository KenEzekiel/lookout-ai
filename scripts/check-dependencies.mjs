import { spawnSync } from "node:child_process";

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "--config",
    ".dependency-cruiser.cjs",
    "--output-type",
    "json",
    "apps/app/src",
  ],
  { encoding: "utf8" },
);
if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);
if (!result.stdout) throw new Error("Dependency analysis produced no report.");
const { summary } = JSON.parse(result.stdout);
for (const violation of summary.violations) {
  console.error(`${violation.rule.name}: ${violation.from} -> ${violation.to}`);
}
if (summary.totalCruised === 0)
  throw new Error("Dependency analysis scanned zero modules. Check parser compatibility.");
console.log(
  `Checked ${summary.totalCruised} modules and ${summary.totalDependenciesCruised} dependencies.`,
);
process.exitCode = result.status === 0 && summary.error === 0 ? 0 : 1;
