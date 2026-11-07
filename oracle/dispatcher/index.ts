import {
  type Address,
  type Admission,
  assertActive,
  BoundaryError,
  eventId,
  type HistoryItem,
  type Incoming,
  isCurrentInput,
  keyOf,
  type Limits,
  type Outcome,
  outcomeSchema,
} from "../session/domain.js";
import type { SessionStore } from "../session/index.js";

export interface TurnRunner {
  recover?(): Promise<void>;
  run(args: {
    input: Incoming;
    history: readonly HistoryItem[];
    signal: AbortSignal;
    report: (text: string) => Promise<void>;
  }): Promise<Outcome>;
}

export interface Oracle {
  receive(input: Incoming): Promise<Admission>;
  owns(address: Address): boolean;
  idle(): Promise<void>;
  retryPending(): void;
  close(): Promise<void>;
}

type QueuedTurn = { input: Incoming; generation: number; ready: Promise<void> };
const failureReply = "The turn could not finish. Send a fresh request to continue.";
const workspaceReplies = new Map([
  [
    "workspace_sync_dirty",
    "Oracle's runtime checkout has uncommitted changes and cannot sync main. A maintainer must preserve that work and clean the runtime checkout, then send a fresh request.",
  ],
  [
    "workspace_sync_conflict",
    "Oracle's runtime checkout has a merge conflict with main. A maintainer must resolve it in the runtime checkout, then send a fresh request.",
  ],
  [
    "workspace_branch_changed",
    "Oracle's runtime checkout is on the wrong branch. A maintainer must restore its dedicated oracle branch without discarding work, then send a fresh request.",
  ],
]);
const updateReply =
  "I'm keeping this request queued while main finishes CI. I'll continue here automatically when it's ready.";

export async function createOracle(deps: {
  sessions: SessionStore;
  runner: TurnRunner;
  publish: (address: Address, text: string) => Promise<void>;
  setStatus?: (address: Address, status: "processing" | "active") => Promise<void>;
  limits: Limits;
  onFault?: (code: string) => void;
  now?: () => number;
  retryIntervalMs?: number;
}): Promise<Oracle> {
  const { sessions, limits } = deps;
  await sessions.recover();
  await deps.runner.recover?.();
  const queue: QueuedTurn[] = [];
  const admitting = new Set<string>();
  const generations = new Map<string, number>();
  let active:
    | { id: string; key: string; address: Address; controller: AbortController }
    | undefined;
  let pump: Promise<void> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const setStatus = async (address: Address, status: "processing" | "active"): Promise<void> => {
    try {
      await deps.setStatus?.(address, status);
    } catch {
      deps.onFault?.("slack_status_unavailable");
    }
  };
  const fault = (error: unknown): void => {
    closed = true;
    clearTimeout(retryTimer);
    active?.controller.abort();
    if (active) void setStatus(active.address, "active");
    for (const turn of queue) void setStatus(turn.input.address, "active");
    queue.length = 0;
    deps.onFault?.(error instanceof BoundaryError ? error.code : "local_failure");
  };
  const deliver = async (
    address: Address,
    kind: Parameters<SessionStore["delivery"]>[1],
    text: string,
  ): Promise<void> => {
    const id = await sessions.delivery(address, kind, text);
    try {
      await deps.publish(address, text);
    } catch {
      await sessions.settle(address, id, "uncertain");
      deps.onFault?.("delivery_uncertain");
      return;
    }
    await sessions.settle(address, id, "sent");
  };
  const processTurn = async (turn: QueuedTurn): Promise<"waiting" | void> => {
    const { input, generation } = turn;
    const key = keyOf(input.address);
    const controller = new AbortController();
    active = { id: eventId(input), key, address: input.address, controller };
    const timeout = setTimeout(() => controller.abort(), limits.maxTurnMs);
    try {
      await turn.ready;
      if (generation !== (generations.get(key) ?? 0)) return;
      assertActive(controller.signal);
      const history = await sessions.claim(input);
      assertActive(controller.signal);
      let outcome: Outcome;
      try {
        outcome = outcomeSchema.parse(
          await deps.runner.run({
            input,
            history,
            signal: controller.signal,
            report: async (text) => {
              assertActive(controller.signal);
              await deliver(input.address, "progress", text);
            },
          }),
        );
        assertActive(controller.signal);
      } catch (error) {
        if (
          error instanceof BoundaryError &&
          ["persistence_unavailable", "backend_work_uncertain"].includes(error.code)
        )
          throw error;
        if (controller.signal.aborted) {
          await sessions.complete(input, { kind: "silent" }, "cancelled");
          return;
        }
        if (error instanceof BoundaryError && error.code === "workspace_main_unverified") {
          const state = await sessions.defer(input);
          if (state === "cancelled") return;
          if (state === "notify") await deliver(input.address, "ack", updateReply);
          assertActive(controller.signal);
          queue.unshift(turn);
          return "waiting";
        }
        const code = error instanceof BoundaryError ? error.code : "turn_failed";
        outcome = { kind: "reply", text: workspaceReplies.get(code) ?? failureReply };
        deps.onFault?.(code);
      }
      await sessions.complete(input, outcome);
      assertActive(controller.signal);
      if (outcome.kind === "reply") await deliver(input.address, "result", outcome.text);
    } catch (error) {
      if (
        error instanceof BoundaryError &&
        ["persistence_unavailable", "backend_work_uncertain"].includes(error.code)
      )
        throw error;
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(timeout);
      active = undefined;
      if (!queue.some((queued) => keyOf(queued.input.address) === key))
        await setStatus(input.address, "active");
    }
  };
  const schedule = (): void => {
    if (pump || closed || retryTimer) return;
    pump = (async () => {
      while (!closed) {
        const turn = queue.shift();
        if (!turn) return;
        if ((await processTurn(turn)) === "waiting") {
          if (queue.length && !closed)
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              retryPending();
            }, deps.retryIntervalMs ?? 30_000);
          return;
        }
      }
    })()
      .catch(fault)
      .finally(() => {
        pump = undefined;
        if (queue.length && !closed && !retryTimer) schedule();
      });
  };
  const retryPending = (): void => {
    if (closed) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    const queued = new Set(queue.map((turn) => eventId(turn.input)));
    for (const input of sessions.pending()) {
      const id = eventId(input);
      if (queued.has(id) || admitting.has(id) || active?.id === id) continue;
      queued.add(id);
      queue.push({
        input,
        generation: generations.get(keyOf(input.address)) ?? 0,
        ready: setStatus(input.address, "processing"),
      });
    }
    schedule();
  };
  return {
    owns: (address) => sessions.owns(address),
    retryPending,
    async receive(input) {
      if (closed) return "ignored";
      if (!isCurrentInput(input, limits, (deps.now ?? Date.now)())) return "ignored";
      const key = keyOf(input.address);
      const id = eventId(input);
      if (input.route === "thread" && !sessions.owns(input.address)) return "ignored";
      if (
        admitting.has(id) ||
        sessions.snapshot(input.address)?.events.some((item) => item.id === id)
      )
        return "duplicate";
      const stopping = /^(?:stop|cancel|abort)[.!]?$/i.test(input.text.trim());
      if (!stopping && queue.length + admitting.size >= limits.maxQueuedGlobal) return "busy";
      admitting.add(id);
      try {
        if (stopping) {
          generations.set(key, (generations.get(key) ?? 0) + 1);
          if (active?.key === key) active.controller.abort();
          for (let index = queue.length - 1; index >= 0; index--) {
            if (keyOf(queue[index]?.input.address ?? input.address) === key) queue.splice(index, 1);
          }
          const result = await sessions.stop(input);
          if (result === "stopped") {
            await deliver(
              input.address,
              "stop",
              "Stopped. Send a fresh direct request to continue.",
            );
            await setStatus(input.address, "active");
          }
          clearTimeout(retryTimer);
          retryTimer = undefined;
          schedule();
          return result;
        }
        const generation = generations.get(key) ?? 0;
        const result = await sessions.admit(input);
        if (result !== "accepted") return result;
        if (closed || generation !== (generations.get(key) ?? 0)) return "accepted";
        const ready = setStatus(input.address, "processing");
        queue.push({ input, generation, ready });
        schedule();
        await ready;
        return "accepted";
      } catch (error) {
        fault(error);
        return "ignored";
      } finally {
        admitting.delete(id);
      }
    },
    async idle() {
      while (pump) await pump;
    },
    async close() {
      closed = true;
      clearTimeout(retryTimer);
      active?.controller.abort();
      const pending = queue.splice(0);
      await sessions.interrupt();
      if (pump) await pump;
      for (const turn of pending) {
        await turn.ready;
        await setStatus(turn.input.address, "active");
      }
    },
  };
}
