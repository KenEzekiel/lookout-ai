import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
const runsSchema = z.array(
  z.object({ headSha: z.string(), status: z.string(), conclusion: z.string() }),
);

export async function mainIsVerified(input: { root: string; commit: string }): Promise<boolean> {
  const { stdout } = await execute(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "verify.yml",
      "--branch",
      "main",
      "--event",
      "push",
      "--commit",
      input.commit,
      "--limit",
      "1",
      "--json",
      "status,conclusion,headSha",
    ],
    { cwd: input.root, timeout: 30_000 },
  );
  const run = runsSchema.parse(JSON.parse(stdout))[0];
  return (
    run?.headSha === input.commit && run.status === "completed" && run.conclusion === "success"
  );
}
