import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const configuration = (value) => {
  const env = {
    ...process.env,
    ORACLE_WORKSPACE: fileURLToPath(new URL("../../", import.meta.url)),
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_APP_TOKEN: "xapp-test",
    T3_MCP_ENDPOINT: "http://127.0.0.1:9999/mcp",
    T3_MCP_TOKEN: "private-test-token",
    T3_PROJECT_ID: "project",
    T3_INSTANCE_ID: "instance",
    T3_MODEL: "model",
  };
  delete env.ORACLE_MAX_CONCURRENT_SESSIONS;
  if (value !== undefined) env.ORACLE_MAX_CONCURRENT_SESSIONS = value;
  return execute(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'import { loadConfig } from "./dispatcher/config.ts"; process.stdout.write(String((await loadConfig()).maxConcurrentSessions));',
    ],
    { cwd: root, env },
  );
};

test("runtime configuration defaults to 24 concurrent sessions and accepts an explicit limit", async () => {
  assert.equal((await configuration()).stdout, "24");
  assert.equal((await configuration("3")).stdout, "3");
});

for (const value of ["0", "-1", "1.5", "129", "invalid"]) {
  test(`runtime configuration refuses invalid concurrency ${value}`, async () => {
    await assert.rejects(configuration(value), (error) => {
      assert.match(error.stderr, /configuration_missing_or_invalid/);
      return true;
    });
  });
}
