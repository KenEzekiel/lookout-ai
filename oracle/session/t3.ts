import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { progressSchema } from "./domain.js";

const id = z.string().min(1);
const status = z.enum([
  "idle",
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);
const terminal = new Set([
  "idle",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);
const launchResult = z.object({ threadId: id, projectId: id, runId: id.nullable() });
const sendResult = z.object({
  threadId: id,
  runId: id,
  delivery: z.enum(["started", "queued", "steered", "restarted"]),
});
const waitResult = z.object({
  threadId: id,
  runId: id.nullable(),
  status,
  timedOut: z.boolean(),
  resultRun: z.object({ runId: id, status }).optional(),
});
const readResult = z.object({
  thread: z.object({
    threadId: id,
    projectId: id,
    status,
    activeRunId: id.nullable(),
    latestRunId: id.nullable(),
    pendingRequestCount: z.number().int().nonnegative(),
  }),
  recentRuns: z.array(z.object({ runId: id, status })),
  items: z.array(
    z.object({
      itemId: id,
      runId: id.nullable(),
      type: z.string(),
      text: z.string().nullable(),
      textTruncated: z.boolean(),
      nextTextOffset: z.number().int().nonnegative().nullable().optional(),
    }),
  ),
  nextPosition: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
});
const interruptResult = z.object({
  threadId: id,
  runId: id.nullable(),
  status: z.enum([
    "interrupt_requested",
    "no_active_run",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "rolled_back",
  ]),
});
const envelope = z.object({
  error: z.unknown().optional(),
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    })
    .optional(),
});

export type T3Transport = { call(name: string, input: object): Promise<unknown> };
export type T3Thread = z.infer<typeof readResult>["thread"];
export type T3Finish =
  | { kind: "completed"; reply: string | null }
  | { kind: "needs_input" }
  | { kind: "ended"; status: string };

export class T3Error extends Error {
  constructor() {
    super("The coding session could not be reached.");
    this.name = "T3Error";
  }
}

export class T3UnsafeToReleaseError extends T3Error {
  constructor() {
    super();
    this.name = "T3UnsafeToReleaseError";
  }
}

function rpcJson(text: string): unknown {
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:"));
  return JSON.parse(data.length > 0 ? data.map((line) => line.slice(5).trim()).join("\n") : text);
}

async function responseText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    bytes += chunk.value.byteLength;
    if (bytes > 2_000_000) {
      await reader.cancel();
      throw new T3Error();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

export async function connectT3(input: { endpoint: string; token: string }): Promise<T3Client> {
  const endpoint = new URL(input.endpoint);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.pathname !== "/mcp" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new T3Error();
  let sessionId: string | null = null;
  let nextId = 0;
  const post = async (body: object): Promise<Response> => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(35_000),
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
          ...(sessionId === null ? {} : { "MCP-Session-Id": sessionId }),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new T3Error();
      return response;
    } catch {
      throw new T3Error();
    }
  };
  const initialized = await post({
    jsonrpc: "2.0",
    id: nextId++,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "oracle", version: "1" },
    },
  });
  sessionId = initialized.headers.get("mcp-session-id");
  if (sessionId === null) throw new T3Error();
  await responseText(initialized);
  const notified = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  await responseText(notified);
  return new T3Client({
    async call(name, args) {
      try {
        const response = await post({
          jsonrpc: "2.0",
          id: nextId++,
          method: "tools/call",
          params: { name, arguments: args },
        });
        const parsed = envelope.parse(rpcJson(await responseText(response)));
        if (parsed.error !== undefined || !parsed.result || parsed.result.isError)
          throw new T3Error();
        if (parsed.result.structuredContent !== undefined) return parsed.result.structuredContent;
        return JSON.parse(parsed.result.content?.map((part) => part.text ?? "").join("") ?? "");
      } catch {
        throw new T3Error();
      }
    },
  });
}

export class T3Client {
  private readonly drainTimeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly transport: T3Transport,
    options: { drainTimeoutMs?: number; retryDelayMs?: number } = {},
  ) {
    this.drainTimeoutMs = options.drainTimeoutMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  async launch(input: {
    projectId: string;
    title: string;
    message?: string;
    requestId: string;
    modelSelection: { instanceId: string; model: string };
  }): Promise<z.infer<typeof launchResult>> {
    return launchResult.parse(
      await this.transport.call("t3_thread_launch", {
        projectId: input.projectId,
        title: input.title,
        ...(input.message === undefined ? {} : { message: input.message }),
        modelSelection: input.modelSelection,
        clientRequestId: input.requestId,
        workspaceStrategy: { type: "root" },
      }),
    );
  }

  async send(input: {
    threadId: string;
    message: string;
    requestId: string;
  }): Promise<z.infer<typeof sendResult>> {
    return sendResult.parse(
      await this.transport.call("t3_thread_send", {
        threadId: input.threadId,
        message: input.message,
        clientRequestId: input.requestId,
        mode: "queue",
      }),
    );
  }

  async read(input: { threadId: string }): Promise<T3Thread> {
    return (await this.readPage({ threadId: input.threadId, limit: 1 })).thread;
  }

  private async readPage(input: object): Promise<z.infer<typeof readResult>> {
    return readResult.parse(
      await this.transport.call("t3_thread_read", {
        runLimit: 1,
        maxCharsPerItem: 10_000,
        ...input,
      }),
    );
  }

  private async wait(input: {
    threadId: string;
    runId?: string;
  }): Promise<z.infer<typeof waitResult>> {
    return waitResult.parse(
      await this.transport.call("t3_thread_wait", {
        ...input,
        timeoutMs: 1_000,
        untilDelegatedWorkSettled: true,
      }),
    );
  }

  async stopAndDrain(input: { threadId: string; runId?: string }): Promise<void> {
    const clientRequestId = randomUUID();
    let runId = input.runId;
    const deadline = Date.now() + this.drainTimeoutMs;
    const beforeDeadline = async <T>(operation: () => Promise<T>): Promise<T> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new T3UnsafeToReleaseError();
      const timeout = new AbortController();
      try {
        return await Promise.race([
          operation(),
          delay(remaining, undefined, { signal: timeout.signal }).then(() => {
            throw new T3UnsafeToReleaseError();
          }),
        ]);
      } finally {
        timeout.abort();
      }
    };
    for (;;) {
      try {
        const stopped = interruptResult.parse(
          await beforeDeadline(() =>
            this.transport.call("t3_thread_interrupt", {
              threadId: input.threadId,
              stop: true,
              reason: "The user stopped this request.",
              clientRequestId,
            }),
          ),
        );
        runId ??= stopped.runId ?? undefined;
        const waited = await beforeDeadline(() =>
          this.wait({
            threadId: input.threadId,
            ...(runId === undefined ? {} : { runId }),
          }),
        );
        const thread = await beforeDeadline(() => this.read(input));
        if (!waited.timedOut && terminal.has(waited.status) && thread.activeRunId === null) return;
      } catch (error) {
        if (error instanceof T3UnsafeToReleaseError) throw error;
        // The writer lease stays held until the server proves that the turn stopped.
      }
      if (Date.now() >= deadline) throw new T3UnsafeToReleaseError();
      await delay(Math.min(this.retryDelayMs, deadline - Date.now()));
    }
  }

  async finish(input: {
    threadId: string;
    runId: string;
    signal: AbortSignal;
    onProgress?: (text: string) => Promise<void>;
  }): Promise<T3Finish> {
    const reported = new Set<string>();
    let stopped: Promise<void> | undefined;
    const stop = () => {
      stopped ??= this.stopAndDrain(input);
      void stopped.catch(() => {});
      return stopped;
    };
    const onAbort = () => {
      void stop();
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        input.signal.throwIfAborted();
        const waited = await this.wait({ threadId: input.threadId, runId: input.runId });
        input.signal.throwIfAborted();
        if (input.onProgress) {
          await this.progress({ ...input, onProgress: input.onProgress, reported });
          input.signal.throwIfAborted();
        }
        if (!waited.timedOut) {
          const resultRun = waited.resultRun ?? waited;
          if (resultRun.status !== "completed" || resultRun.runId === null)
            return { kind: "ended", status: resultRun.status };
          const reply = await this.reply({ threadId: input.threadId, runId: resultRun.runId });
          input.signal.throwIfAborted();
          return { kind: "completed", reply };
        }
        const thread = await this.read(input);
        if (thread.pendingRequestCount > 0) {
          await stop();
          return { kind: "needs_input" };
        }
      }
    } catch (error) {
      await stop();
      throw error;
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
  }

  private async progress(input: {
    threadId: string;
    runId: string;
    signal: AbortSignal;
    onProgress: (text: string) => Promise<void>;
    reported: Set<string>;
  }): Promise<void> {
    let afterPosition: number | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await this.readPage({
        threadId: input.threadId,
        view: "messages",
        limit: 100,
        ...(afterPosition === undefined ? {} : { afterPosition }),
      });
      for (const item of result.items) {
        input.signal.throwIfAborted();
        if (
          item.runId !== input.runId ||
          item.type !== "assistant_message" ||
          item.textTruncated ||
          !item.text ||
          input.reported.has(item.itemId)
        )
          continue;
        let data: unknown;
        try {
          data = JSON.parse(item.text);
        } catch {
          continue;
        }
        const parsed = progressSchema.safeParse(data);
        if (!parsed.success) continue;
        input.reported.add(item.itemId);
        await input.onProgress(parsed.data.text);
      }
      if (!result.hasMore || result.nextPosition === null) return;
      if (result.nextPosition <= (afterPosition ?? -1)) throw new T3Error();
      afterPosition = result.nextPosition;
    }
    throw new T3Error();
  }

  private async reply(input: { threadId: string; runId: string }): Promise<string | null> {
    let afterPosition: number | undefined;
    let last: z.infer<typeof readResult>["items"][number] | undefined;
    for (let pages = 0; ; pages++) {
      if (pages >= 50) throw new T3Error();
      const page = await this.readPage({
        threadId: input.threadId,
        view: "messages",
        limit: 100,
        ...(afterPosition === undefined ? {} : { afterPosition }),
      });
      for (const item of page.items)
        if (item.runId === input.runId && item.type === "assistant_message") last = item;
      if (!page.hasMore || page.nextPosition === null) break;
      if (page.nextPosition <= (afterPosition ?? -1)) throw new T3Error();
      afterPosition = page.nextPosition;
    }
    if (last === undefined) return null;
    let text = last.text ?? "";
    let offset = last.textTruncated ? (last.nextTextOffset ?? null) : null;
    for (let chunks = 0; offset !== null; chunks++) {
      if (chunks >= 50 || text.length > 200_000) throw new T3Error();
      const page = await this.readPage({
        threadId: input.threadId,
        itemId: last.itemId,
        textOffset: offset,
      });
      const chunk = page.items.find((item) => item.itemId === last.itemId);
      if (chunk === undefined) throw new T3Error();
      text += chunk.text ?? "";
      const nextOffset = chunk.textTruncated ? (chunk.nextTextOffset ?? null) : null;
      if (nextOffset !== null && nextOffset <= offset) throw new T3Error();
      offset = nextOffset;
    }
    if (text.length > 200_000) throw new T3Error();
    return text;
  }
}
