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
import type { Disclosure } from "../tools/disclosure.js";

export interface TurnRunner {
  recover?(): Promise<void>;
  run(args: {
    input: Incoming;
    history: readonly HistoryItem[];
    signal: AbortSignal;
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

export async function createOracle(deps: {
  sessions: SessionStore;
  runner: TurnRunner;
  publish: (address: Address, text: string) => Promise<void>;
  disclosure: Disclosure;
  limits: Limits;
  onFault?: (code: string) => void;
  now?: () => number;
}): Promise<Oracle> {
  const { sessions, disclosure, limits } = deps;
  await sessions.recover();
  await deps.runner.recover?.();
  const queue: QueuedTurn[] = [];
  const admitting = new Set<string>();
  const generations = new Map<string, number>();
  let active: { key: string; controller: AbortController } | undefined;
  let pump: Promise<void> | undefined;
  let closed = false;
  const fault = (error: unknown): void => {
    closed = true;
    active?.controller.abort();
    queue.length = 0;
    deps.onFault?.(error instanceof BoundaryError ? error.code : "local_failure");
  };
  const deliver = async (
    address: Address,
    kind: "ack" | "result" | "stop",
    text: string,
  ): Promise<void> => {
    disclosure.assert(text);
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
    active = { key, controller };
    const timeout = setTimeout(() => controller.abort(), limits.maxTurnMs);
    try {
      await turn.ready;
      if (generation !== (generations.get(key) ?? 0)) return;
      assertActive(controller.signal);
      const history = await sessions.claim(input);
      assertActive(controller.signal);
      let outcome: Outcome;
      try {
        disclosure.assert(input.text);
        outcome = outcomeSchema.parse(
          await deps.runner.run({ input, history, signal: controller.signal }),
        );
        assertActive(controller.signal);
        if (outcome.kind === "reply") disclosure.assert(outcome.text);
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
        outcome = { kind: "reply", text: failureReply };
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
          if (result === "stopped")
            await deliver(
              input.address,
              "stop",
              "Stopped. Send a fresh direct request to continue.",
            );
          return result;
        }
        const generation = generations.get(key) ?? 0;
        const result = await sessions.admit(input);
        if (result !== "accepted") return result;
        if (closed || generation !== (generations.get(key) ?? 0)) return "accepted";
        const ready =
          input.route === "direct" ? deliver(input.address, "ack", "On it.") : Promise.resolve();
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
      queue.length = 0;
      await sessions.interrupt();
      if (pump) await pump;
    },
  };
}
