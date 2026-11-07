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
  close(): Promise<void>;
}

type QueuedTurn = { input: Incoming; generation: number; ready: Promise<void> };
const failureReply = "The turn could not finish. Send a fresh request to continue.";
const updateReply =
  "A newer main commit is waiting for successful CI. Oracle will update automatically when Verify passes. Send a fresh request after that.";

export async function createOracle(deps: {
  sessions: SessionStore;
  runner: TurnRunner;
  publish: (address: Address, text: string) => Promise<void>;
  setStatus?: (address: Address, status: "processing" | "active") => Promise<void>;
  limits: Limits;
  onFault?: (code: string) => void;
  now?: () => number;
}): Promise<Oracle> {
  const { sessions, limits } = deps;
  await sessions.recover();
  await deps.runner.recover?.();
  const queue: QueuedTurn[] = [];
  const admitting = new Set<string>();
  const generations = new Map<string, number>();
  let active: { key: string; address: Address; controller: AbortController } | undefined;
  let pump: Promise<void> | undefined;
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
    active?.controller.abort();
    if (active) void setStatus(active.address, "active");
    for (const turn of queue) void setStatus(turn.input.address, "active");
    queue.length = 0;
    deps.onFault?.(error instanceof BoundaryError ? error.code : "local_failure");
  };
  const deliver = async (
    address: Address,
    kind: "progress" | "result" | "stop",
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
  const processTurn = async (turn: QueuedTurn): Promise<void> => {
    const { input, generation } = turn;
    const key = keyOf(input.address);
    const controller = new AbortController();
    active = { key, address: input.address, controller };
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
        const waiting =
          error instanceof BoundaryError && error.code === "workspace_main_unverified";
        outcome = { kind: "reply", text: waiting ? updateReply : failureReply };
        deps.onFault?.("turn_failed");
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
    if (pump || closed) return;
    pump = (async () => {
      while (!closed) {
        const turn = queue.shift();
        if (!turn) return;
        await processTurn(turn);
      }
    })()
      .catch(fault)
      .finally(() => {
        pump = undefined;
        if (queue.length && !closed) schedule();
      });
  };
  return {
    owns: (address) => sessions.owns(address),
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
