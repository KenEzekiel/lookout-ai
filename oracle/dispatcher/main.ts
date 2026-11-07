import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BoundaryError, defaultLimits } from "../session/domain.js";
import { atomicJson, createSessionStore } from "../session/index.js";
import { acquireInstanceLock } from "../session/lock.js";
import { createT3Runner } from "../session/run.js";
import { connectT3 } from "../session/t3.js";
import { loadDisclosure } from "../tools/disclosure.js";
import { loadConfig, loadIdentity, oracleRoot } from "./config.js";
import { createOracle, type Oracle } from "./index.js";
import { connectSlack } from "./slack.js";

const log = (code: string): void => {
  process.stderr.write(`${JSON.stringify({ event: code })}\n`);
};
let oracle: Oracle | undefined;
let slack: Awaited<ReturnType<typeof connectSlack>> | undefined;
let release: (() => Promise<void>) | undefined;
let unsafeToRelease = false;
let closing: Promise<void> | undefined;
const shutdown = (): Promise<void> => {
  closing ??= (async () => {
    try {
      await oracle?.close();
    } catch {
      log("session_shutdown_failed");
    }
    try {
      await slack?.close();
    } catch {
      log("transport_shutdown_failed");
    }
    if (!unsafeToRelease) await release?.();
  })();
  return closing;
};
const onFault = (code: string): void => {
  log(code);
  if (code === "backend_work_uncertain") unsafeToRelease = true;
  if (["backend_work_uncertain", "persistence_unavailable", "local_failure"].includes(code)) {
    process.exitCode = 1;
    queueMicrotask(() => {
      void shutdown().catch(() => {
        log("shutdown_failed");
      });
    });
  }
};

async function main(): Promise<void> {
  const config = await loadConfig();
  await mkdir(join(oracleRoot, ".local"), { recursive: true, mode: 0o700 });
  release = await acquireInstanceLock(join(oracleRoot, ".state"));
  const identity = await loadIdentity();
  slack = await connectSlack({
    botToken: config.slack.botToken,
    appToken: config.slack.appToken,
    allowedActors: new Set(config.slack.allowedActors),
    onFault,
    ...(identity ? { expectedIdentity: identity } : {}),
  });
  if (!identity) await atomicJson(join(oracleRoot, ".local", "identity.json"), slack.identity);
  const disclosure = await loadDisclosure(join(oracleRoot, ".local", "disclosure.json"), [
    config.slack.botToken,
    config.slack.appToken,
    config.t3.token,
  ]);
  const policy = disclosure.assert(
    await readFile(join(oracleRoot, "session", "operating.md"), "utf8"),
  );
  const client = await connectT3({ endpoint: config.t3.endpoint, token: config.t3.token });
  const sessions = createSessionStore({
    directory: join(oracleRoot, ".state", "sessions"),
    limits: defaultLimits,
  });
  const runner = createT3Runner({
    client,
    sessions,
    policy,
    disclosure,
    projectId: config.t3.projectId,
    instanceId: config.t3.instanceId,
    model: config.t3.model,
  });
  oracle = await createOracle({
    sessions,
    runner,
    publish: slack.publish,
    disclosure,
    limits: defaultLimits,
    onFault,
  });
  await slack.listen(oracle);
  log("oracle_listening");
}

process.once("SIGINT", () => {
  void shutdown().catch(() => {
    log("shutdown_failed");
    process.exitCode = 1;
  });
});
process.once("SIGTERM", () => {
  void shutdown().catch(() => {
    log("shutdown_failed");
    process.exitCode = 1;
  });
});
main().catch(async (error: unknown) => {
  const code = error instanceof BoundaryError ? error.code : "startup_failed";
  if (code === "backend_work_uncertain") unsafeToRelease = true;
  log(code);
  process.exitCode = 1;
  await shutdown().catch(() => {
    log("shutdown_failed");
  });
});
