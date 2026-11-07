import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BoundaryError, defaultLimits, type ShutdownMode } from "../session/domain.js";
import { atomicJson, createSessionStore } from "../session/index.js";
import { acquireInstanceLock } from "../session/lock.js";
import { createT3Runner } from "../session/run.js";
import { connectT3 } from "../session/t3.js";
import { createWorkspace } from "../session/workspace.js";
import { loadConfig, loadIdentity, oracleRoot, readOptionalJson } from "./config.js";
import { createOracle, type Oracle } from "./index.js";
import { watchSource } from "./reload.js";
import { connectSlack } from "./slack.js";

const log = (code: string): void => {
  process.stderr.write(`${JSON.stringify({ event: code })}\n`);
};
let oracle: Oracle | undefined;
let slack: Awaited<ReturnType<typeof connectSlack>> | undefined;
let release: (() => Promise<void>) | undefined;
let unsafeToRelease = false;
let closing: Promise<void> | undefined;
let stopWatching: (() => void) | undefined;
let syncTimer: ReturnType<typeof setInterval> | undefined;
let syncing: Promise<void> | undefined;
let reloading = false;
const shutdown = (mode: ShutdownMode = "shutdown"): Promise<void> => {
  closing ??= (async () => {
    stopWatching?.();
    clearInterval(syncTimer);
    try {
      await oracle?.close(mode);
    } catch {
      log("session_shutdown_failed");
    }
    await syncing;
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
  const workspace = createWorkspace({ root: config.workspace, branch: "oracle" });
  let updateState = "";
  const syncWorkspace = async (): Promise<void> => {
    const update = await workspace.sync();
    const state = JSON.stringify(update);
    if (state !== updateState) {
      process.stderr.write(`${JSON.stringify({ event: "oracle_workspace", ...update })}\n`);
      updateState = state;
    }
  };
  await mkdir(join(oracleRoot, ".local"), { recursive: true, mode: 0o700 });
  release = await acquireInstanceLock(join(oracleRoot, ".state"));
  const identity = await loadIdentity();
  slack = await connectSlack({
    botToken: config.slack.botToken,
    appToken: config.slack.appToken,
    onFault,
    mappings: () => readOptionalJson(join(oracleRoot, ".local", "profiles.json")),
    ...(identity ? { expectedIdentity: identity } : {}),
  });
  if (!identity) await atomicJson(join(oracleRoot, ".local", "identity.json"), slack.identity);
  const client = await connectT3({ endpoint: config.t3.endpoint, token: config.t3.token });
  const sessions = createSessionStore({
    directory: join(oracleRoot, ".state", "sessions"),
    limits: defaultLimits,
  });
  const runner = createT3Runner({
    client,
    sessions,
    policy: () => readFile(join(oracleRoot, "session", "operating.md"), "utf8"),
    context: slack.context,
    profiles: slack.profiles,
    files: slack.files,
    projectId: config.t3.projectId,
    instanceId: config.t3.instanceId,
    model: config.t3.model,
    workspace: workspace.task,
  });
  oracle = await createOracle({
    sessions,
    runner,
    publish: slack.publish,
    setStatus: slack.setStatus,
    setCompleted: slack.setCompleted,
    limits: { ...defaultLimits, maxConcurrentSessions: config.maxConcurrentSessions },
    onFault,
  });
  await syncWorkspace();
  await slack.listen(oracle);
  oracle.retryPending();
  syncTimer = setInterval(() => {
    if (syncing || closing) return;
    syncing = syncWorkspace()
      .catch((error: unknown) =>
        log(error instanceof BoundaryError ? error.code : "workspace_sync_deferred"),
      )
      .finally(() => {
        syncing = undefined;
      });
  }, 30_000);
  stopWatching = await watchSource({
    root: oracleRoot,
    onFault: () => log("reload_watch_failed"),
    onChange: () => {
      if (closing || reloading) return;
      reloading = true;
      log("oracle_reload_requested");
      void (async () => {
        if (closing) return;
        await slack?.close();
        await shutdown("reload");
        if (!unsafeToRelease && !process.exitCode) process.exitCode = 75;
      })().catch(() => {
        log("reload_failed");
        process.exitCode = 1;
        void shutdown().catch(() => log("shutdown_failed"));
      });
    },
  });
  log("oracle_listening");
  process.stderr.write(
    `${JSON.stringify({ event: "oracle_concurrency", maxConcurrentSessions: config.maxConcurrentSessions })}\n`,
  );
  process.stderr.write(
    `${JSON.stringify({ event: "oracle_backend", instanceId: config.t3.instanceId, model: config.t3.model })}\n`,
  );
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
