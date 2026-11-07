import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  type Address,
  type Admission,
  addressSchema,
  BoundaryError,
  eventId,
  type HistoryItem,
  historySchema,
  type Incoming,
  incomingSchema,
  isCurrentInput,
  keyOf,
  type Limits,
  type Outcome,
} from "./domain.js";

const eventSchema = z.object({
  id: z.string(),
  at: z.number(),
  input: incomingSchema,
  status: z.enum(["queued", "running", "completed", "interrupted", "cancelled"]),
});
const mutationSchema = z.object({
  id: z.string(),
  event: z.string(),
  path: z.string(),
  state: z.enum(["intent", "done", "uncertain"]),
});
const deliverySchema = z.object({
  id: z.string(),
  kind: z.enum(["ack", "progress", "result", "stop"]),
  text: z.string(),
  state: z.enum(["attempting", "sent", "uncertain"]),
});
const documentSchema = z.object({
  version: z.literal(1),
  address: addressSchema,
  updatedAt: z.number(),
  stopped: z.boolean(),
  history: z.array(historySchema),
  events: z.array(eventSchema),
  mutations: z.array(mutationSchema),
  deliveries: z.array(deliverySchema),
  threadId: z.string().min(1).max(256).nullable().default(null),
});
type Document = z.infer<typeof documentSchema>;
type EventState = z.infer<typeof eventSchema>["status"];

export interface SessionStore {
  recover(): Promise<void>;
  owns(address: Address): boolean;
  admit(input: Incoming): Promise<Admission>;
  claim(input: Incoming): Promise<readonly HistoryItem[]>;
  stop(input: Incoming): Promise<Admission>;
  interrupt(): Promise<void>;
  complete(input: Incoming, outcome: Outcome, status?: EventState): Promise<void>;
  mutation(input: Incoming, path: string, operation: () => Promise<void>): Promise<void>;
  delivery(address: Address, kind: "progress" | "result" | "stop", text: string): Promise<string>;
  settle(address: Address, id: string, state: "sent" | "uncertain"): Promise<void>;
  snapshot(address: Address): Readonly<Document> | undefined;
  linkThread(address: Address, threadId: string, previousThreadId?: string | null): Promise<void>;
  threads(): readonly { address: Address; threadId: string }[];
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    const directory = await open(join(path, ".."), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export function createSessionStore(options: {
  directory: string;
  limits: Limits;
  now?: () => number;
  persist?: typeof atomicJson;
}): SessionStore {
  const { directory, limits } = options;
  const now = options.now ?? Date.now;
  const persist = options.persist ?? atomicJson;
  const documents = new Map<string, Document>();
  let writes = Promise.resolve();
  let failed = false;
  const filename = (key: string): string =>
    join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
  const transact = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writes.then(async () => {
      if (failed) throw new BoundaryError("persistence_unavailable");
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof BoundaryError)) failed = true;
        throw error;
      }
    });
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const save = async (document: Document): Promise<void> => {
    document.updatedAt = now();
    try {
      await persist(filename(keyOf(document.address)), document);
    } catch {
      failed = true;
      throw new BoundaryError("persistence_unavailable");
    }
    documents.set(keyOf(document.address), document);
  };
  const copy = (address: Address): Document => {
    const document = documents.get(keyOf(address));
    if (!document) throw new BoundaryError("session_missing");
    return structuredClone(document);
  };
  const trimHistory = (history: HistoryItem[]): HistoryItem[] => {
    const trimmed = history.slice(-limits.maxHistoryTurns);
    while (Buffer.byteLength(JSON.stringify(trimmed)) > limits.maxHistoryBytes) trimmed.shift();
    return trimmed;
  };
  const pruneEvents = (document: Document): void => {
    document.events = document.events.filter(
      (event) => event.at >= now() - limits.maxEventAgeMs - limits.maxClockSkewMs,
    );
  };
  const admission = async (input: Incoming, stopping: boolean): Promise<Admission> => {
    const key = keyOf(input.address);
    const at = Number(input.ts) * 1000;
    if (!isCurrentInput(input, limits, now())) return "ignored";
    let document = documents.has(key) ? copy(input.address) : undefined;
    if (!document && input.route !== "direct") return "ignored";
    if (document?.events.some((event) => event.id === eventId(input))) return "duplicate";
    if (!document) {
      if (documents.size >= limits.maxSessions) {
        const expired = [...documents.entries()].find(
          ([, item]) =>
            item.updatedAt < now() - limits.maxEventAgeMs - limits.maxClockSkewMs &&
            !item.events.some((event) => ["running", "queued"].includes(event.status)),
        );
        if (!expired) return "busy";
        await unlink(filename(expired[0]));
        documents.delete(expired[0]);
      }
      document = {
        version: 1,
        address: input.address,
        updatedAt: now(),
        stopped: false,
        history: [],
        events: [],
        mutations: [],
        deliveries: [],
        threadId: null,
      };
    }
    pruneEvents(document);
    if (document.events.length >= limits.maxDedupEntries) return "busy";
    if (!stopping) {
      if (document.stopped && input.route !== "direct") return "ignored";
      if (
        document.events.filter((event) => event.status === "queued").length >=
        limits.maxQueuedPerSession
      )
        return "busy";
      document.stopped = false;
    }
    document.events.push({
      id: eventId(input),
      at,
      input,
      status: stopping ? "completed" : "queued",
    });
    if (stopping) {
      document.stopped = true;
      for (const event of document.events) {
        if (event.status === "queued" || event.status === "running") event.status = "cancelled";
      }
    }
    await save(document);
    return stopping ? "stopped" : "accepted";
  };
  return {
    async recover() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(directory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        if (documents.size >= limits.maxSessions) throw new BoundaryError("session_capacity");
        const raw = await readFile(join(directory, name));
        if (raw.length > 5_000_000) throw new BoundaryError("session_too_large");
        const document = documentSchema.parse(JSON.parse(raw.toString("utf8")));
        if (name !== filename(keyOf(document.address)).split(/[\\/]/).pop())
          throw new BoundaryError("session_invalid");
        for (const event of document.events) {
          if (event.status === "running" || event.status === "queued") event.status = "interrupted";
        }
        for (const mutation of document.mutations) {
          if (mutation.state === "intent") mutation.state = "uncertain";
        }
        for (const delivery of document.deliveries) {
          if (delivery.state === "attempting") delivery.state = "uncertain";
        }
        await save(document);
      }
    },
    owns: (address) => documents.has(keyOf(address)),
    admit: (input) => transact(() => admission(input, false)),
    stop: (input) => transact(() => admission(input, true)),
    interrupt: () =>
      transact(async () => {
        for (const address of [...documents.values()].map((document) => document.address)) {
          const document = copy(address);
          for (const event of document.events) {
            if (event.status === "queued" || event.status === "running")
              event.status = "interrupted";
          }
          await save(document);
        }
      }),
    claim: (input) =>
      transact(async () => {
        const document = copy(input.address);
        const event = document.events.find((item) => item.id === eventId(input));
        if (!event || event.status !== "queued" || document.stopped)
          throw new BoundaryError("turn_cancelled");
        event.status = "running";
        await save(document);
        return document.history;
      }),
    complete: (input, outcome, status = "completed") =>
      transact(async () => {
        const document = copy(input.address);
        const event = document.events.find((item) => item.id === eventId(input));
        if (!event) throw new BoundaryError("event_missing");
        if (event.status !== "running") return;
        event.status = status;
        document.history = trimHistory([
          ...document.history,
          { role: "user", text: input.text },
          ...(outcome.kind === "reply" ? [{ role: "assistant" as const, text: outcome.text }] : []),
        ]);
        await save(document);
      }),
    async mutation(input, path, operation) {
      const id = randomUUID();
      await transact(async () => {
        const document = copy(input.address);
        if (document.stopped) throw new BoundaryError("turn_stopped");
        document.mutations = document.mutations.slice(-63);
        document.mutations.push({ id, event: eventId(input), path, state: "intent" });
        await save(document);
      });
      await operation();
      await transact(async () => {
        const document = copy(input.address);
        const mutation = document.mutations.find((item) => item.id === id);
        if (!mutation) throw new BoundaryError("mutation_missing");
        mutation.state = "done";
        await save(document);
      });
    },
    delivery: (address, kind, text) =>
      transact(async () => {
        const document = copy(address);
        const id = randomUUID();
        document.deliveries = document.deliveries.slice(-15);
        document.deliveries.push({ id, kind, text, state: "attempting" });
        await save(document);
        return id;
      }),
    settle: (address, id, state) =>
      transact(async () => {
        const document = copy(address);
        const delivery = document.deliveries.find((item) => item.id === id);
        if (!delivery) throw new BoundaryError("delivery_missing");
        delivery.state = state;
        await save(document);
      }),
    snapshot: (address) => {
      const document = documents.get(keyOf(address));
      return document ? structuredClone(document) : undefined;
    },
    linkThread: (address, threadId, previousThreadId = null) =>
      transact(async () => {
        const document = copy(address);
        if (
          document.threadId !== null &&
          document.threadId !== threadId &&
          document.threadId !== previousThreadId
        )
          throw new BoundaryError("thread_identity_changed");
        document.threadId = threadId;
        await save(document);
      }),
    threads: () =>
      [...documents.values()].flatMap((document) =>
        document.threadId === null
          ? []
          : [{ address: document.address, threadId: document.threadId }],
      ),
  };
}
