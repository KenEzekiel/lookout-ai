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
  type OutputFile,
  outcomeSchema,
  type ShutdownMode,
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
  close(mode?: ShutdownMode): Promise<void>;
}

type QueuedTurn = { input: Incoming; generation: number; ready: Promise<void> };
type ActiveTurn = {
  id: string;
  address: Address;
  controller: AbortController;
  done: Promise<void>;
};
const failureReply = "The turn could not finish. Send a fresh request to continue.";
const failureReplies = new Map([
  [
    "file_path_invalid",
    "The output file must be inside this turn's output directory. Send a fresh request to regenerate it.",
  ],
  [
    "file_too_large",
    "The output file exceeds Slack bridge's 20 MiB limit. Ask for a smaller file or an authorized download link.",
  ],
  [
    "files_unavailable",
    "File handling is unavailable in this Oracle session. A maintainer must check the Slack file transport.",
  ],
  [
    "turn_needs_input",
    "The coding thread needs input in T3 Code. Send a fresh request after resolving it.",
  ],
  ["turn_interrupted", "The coding turn was interrupted. Send a fresh request to continue."],
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
export async function createOracle(deps: {
  sessions: SessionStore;
  runner: TurnRunner;
  publish: (
    address: Address,
    text: string,
    files?: OutputFile[],
    signal?: AbortSignal,
  ) => Promise<void>;
  setStatus?: (address: Address, status: "processing" | "active") => Promise<void>;
  setCompleted?: (address: Address, completed: boolean) => Promise<void>;
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
  const active = new Map<string, ActiveTurn>();
  let closed = false;
  let closingMode: ShutdownMode | undefined;
  const setCompleted = async (address: Address, completed: boolean): Promise<void> => {
    try {
      await deps.setCompleted?.(address, completed);
    } catch {
      deps.onFault?.("slack_completion_unavailable");
    }
  };
  const setStatus = async (address: Address, status: "processing" | "active"): Promise<void> => {
    if (status === "processing") await setCompleted(address, false);
    try {
      await deps.setStatus?.(address, status);
    } catch {
      deps.onFault?.("slack_status_unavailable");
    }
  };
  const fault = (error: unknown): void => {
    closed = true;
    for (const turn of active.values()) {
      turn.controller.abort();
      void setStatus(turn.address, "active");
    }
    for (const turn of queue) void setStatus(turn.input.address, "active");
    queue.length = 0;
    deps.onFault?.(error instanceof BoundaryError ? error.code : "local_failure");
  };
  const deliver = async (
    address: Address,
    kind: Parameters<SessionStore["delivery"]>[1],
    text: string,
    files?: OutputFile[],
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const id = await sessions.delivery(address, kind, text, files);
    try {
      await deps.publish(address, text, files, signal);
    } catch {
      await sessions.settle(address, id, "uncertain");
      deps.onFault?.("delivery_uncertain");
      return false;
    }
    await sessions.settle(address, id, "sent");
    return true;
  };
  const processTurn = async (turn: QueuedTurn, controller: AbortController): Promise<boolean> => {
    const { input, generation } = turn;
    const key = keyOf(input.address);
    try {
      await turn.ready;
      if (generation !== (generations.get(key) ?? 0)) return false;
      assertActive(controller.signal);
      const history = await sessions.claim(input);
      assertActive(controller.signal);
      let outcome: Outcome;
      let succeeded = true;
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
          if (closingMode !== "reload")
            await sessions.complete(input, { kind: "silent" }, "cancelled");
          return false;
        }
        const code = error instanceof BoundaryError ? error.code : "turn_failed";
        succeeded = false;
        outcome = { kind: "reply", text: failureReplies.get(code) ?? failureReply };
        deps.onFault?.(code);
      }
      await sessions.complete(input, outcome);
      assertActive(controller.signal);
      if (outcome.kind === "silent") return false;
      const sent = await deliver(
        input.address,
        "result",
        outcome.text,
        outcome.files,
        controller.signal,
      );
      assertActive(controller.signal);
      return succeeded && sent;
    } catch (error) {
      if (
        error instanceof BoundaryError &&
        ["persistence_unavailable", "backend_work_uncertain"].includes(error.code)
      )
        throw error;
      if (!controller.signal.aborted) throw error;
      return false;
    }
  };
  const schedule = (): void => {
    if (closed) return;
    while (active.size < limits.maxConcurrentSessions) {
      const index = queue.findIndex(({ input }) => {
        const key = keyOf(input.address);
        return !active.has(key);
      });
      if (index < 0) return;
      const [turn] = queue.splice(index, 1);
      if (!turn) return;
      const key = keyOf(turn.input.address);
      const controller = new AbortController();
      const unfinished = (): boolean =>
        closed ||
        controller.signal.aborted ||
        queue.some(({ input }) => keyOf(input.address) === key);
      const done = Promise.resolve()
        .then(() => processTurn(turn, controller))
        .then(async (completed) => {
          if (!completed || unfinished()) return;
          await setCompleted(turn.input.address, true);
          if (unfinished()) await setCompleted(turn.input.address, false);
        })
        .catch(fault)
        .finally(async () => {
          if (!queue.some(({ input }) => keyOf(input.address) === key))
            await setStatus(turn.input.address, "active");
          active.delete(key);
          schedule();
        });
      active.set(key, { id: eventId(turn.input), address: turn.input.address, controller, done });
    }
  };
  const retryPending = (): void => {
    if (closed) return;
    const queued = new Set(queue.map((turn) => eventId(turn.input)));
    for (const input of sessions.pending()) {
      const id = eventId(input);
      if (queued.has(id) || admitting.has(id) || active.get(keyOf(input.address))?.id === id)
        continue;
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
          active.get(key)?.controller.abort();
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
      while (active.size) await Promise.all([...active.values()].map(({ done }) => done));
    },
    async close(mode = "shutdown") {
      closingMode ??= mode;
      closed = true;
      for (const turn of active.values()) turn.controller.abort();
      const pending = queue.splice(0);
      await sessions.interrupt(closingMode);
      while (active.size) await Promise.all([...active.values()].map(({ done }) => done));
      for (const turn of pending) {
        await turn.ready;
        await setStatus(turn.input.address, "active");
      }
    },
  };
}
