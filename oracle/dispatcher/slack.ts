import { App, LogLevel } from "@slack/bolt";
import { z } from "zod";
import {
  addressSchema,
  BoundaryError,
  defaultLimits,
  type Incoming,
  incomingSchema,
  type ThreadContext,
} from "../session/domain.js";
import type { Oracle } from "./index.js";
import { createProfileDirectory, userIdSchema } from "./profiles.js";

export const identitySchema = z.object({
  user_id: userIdSchema,
  team_id: z.string().regex(/^T[A-Z0-9]+$/),
});
export type Identity = z.infer<typeof identitySchema>;
const eventSchema = z.object({
  channel: addressSchema.shape.channel,
  user: userIdSchema,
  ts: incomingSchema.shape.ts,
  thread_ts: incomingSchema.shape.ts.optional(),
  text: z.string(),
  team: identitySchema.shape.team_id.optional(),
  user_team: identitySchema.shape.team_id.optional(),
  channel_type: z.string().optional(),
  bot_id: z.unknown().optional(),
  bot_profile: z.unknown().optional(),
  subtype: z.unknown().optional(),
});

export function routeSlack(args: {
  event: unknown;
  listener: "mention" | "message";
  identity: Identity;
  teamId: unknown;
  owns: Oracle["owns"];
}): Incoming | undefined {
  const parsed = eventSchema.safeParse(args.event);
  if (!parsed.success) return;
  const event = parsed.data;
  if (
    args.teamId !== args.identity.team_id ||
    (event.team !== undefined && event.team !== args.identity.team_id) ||
    (event.user_team !== undefined && event.user_team !== args.identity.team_id) ||
    event.user === args.identity.user_id ||
    event.bot_id !== undefined ||
    event.bot_profile !== undefined ||
    event.subtype !== undefined
  )
    return;
  const ownMention = `<@${args.identity.user_id}>`;
  const mentioned = event.text.includes(ownMention);
  const direct = mentioned || event.channel_type === "im" || event.channel.startsWith("D");
  if (args.listener === "mention" && !mentioned) return;
  const address = { channel: event.channel, rootTs: event.thread_ts ?? event.ts };
  if (!direct && (!event.thread_ts || !args.owns(address))) return;
  const text = event.text.split(ownMention).join("").trim();
  if (!text && !mentioned) return;
  return incomingSchema.parse({
    address,
    ts: event.ts,
    actor: event.user,
    text: text || "Respond to the latest request in this Slack thread.",
    route: direct ? "direct" : "thread",
  });
}

const repliesSchema = z.object({
  messages: z.array(
    z.object({
      ts: incomingSchema.shape.ts,
      user: userIdSchema.optional(),
      text: z.string().default(""),
    }),
  ),
  has_more: z.boolean().optional(),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

export function createSlackTransport(options: {
  identity: Identity;
  call: (method: string, args: Record<string, unknown>) => Promise<unknown>;
  onFault: (code: string) => void;
  mappings?: () => Promise<unknown>;
}) {
  const { identity, call, onFault } = options;
  const directory = createProfileDirectory({
    teamId: identity.team_id,
    call,
    mappings: options.mappings ?? (async () => undefined),
    onFault,
  });
  return {
    profiles: directory.resolve,
    async receive(args: {
      event: unknown;
      teamId: unknown;
      listener: "mention" | "message";
      oracle: Oracle;
    }): Promise<void> {
      const input = routeSlack({ ...args, identity, owns: args.oracle.owns });
      if (input && (await directory.isMember(input.actor))) await args.oracle.receive(input);
    },
    async publish(address: Incoming["address"], text: string): Promise<void> {
      await call("chat.postMessage", {
        channel: address.channel,
        thread_ts: address.rootTs,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
    },
    async setStatus(address: Incoming["address"], status: "processing" | "active"): Promise<void> {
      await call("agents.sessions.setStatus", {
        channel_id: address.channel,
        thread_ts: address.rootTs,
        status,
      });
    },
    async context(input: Incoming): Promise<ThreadContext> {
      try {
        let cursor: string | undefined;
        const messages: { actor: string; ts: string; text: string }[] = [];
        let truncated = false;
        for (let page = 0; page < 5; page++) {
          const result = repliesSchema.parse(
            await call("conversations.replies", {
              channel: input.address.channel,
              ts: input.address.rootTs,
              latest: input.ts,
              inclusive: false,
              limit: 100,
              ...(cursor ? { cursor } : {}),
            }),
          );
          for (const message of result.messages) {
            if (message.user && Number(message.ts) < Number(input.ts))
              messages.push({ actor: message.user, ts: message.ts, text: message.text });
          }
          cursor = result.response_metadata?.next_cursor || undefined;
          truncated = Boolean(result.has_more || cursor);
          if (!truncated) break;
          if (!cursor) throw new BoundaryError("slack_context_incomplete");
        }
        messages.sort((a, b) => Number(a.ts) - Number(b.ts));
        while (
          messages.length > defaultLimits.maxHistoryTurns ||
          Buffer.byteLength(JSON.stringify(messages)) > defaultLimits.maxHistoryBytes
        ) {
          messages.shift();
          truncated = true;
        }
        return { kind: "available", messages, truncated };
      } catch {
        onFault("slack_context_unavailable");
        return { kind: "unavailable" };
      }
    },
  };
}

export async function connectSlack(options: {
  botToken: string;
  appToken: string;
  expectedIdentity?: Identity;
  onFault: (code: string) => void;
  mappings: () => Promise<unknown>;
}): Promise<{
  identity: Identity;
  publish: (address: Incoming["address"], text: string) => Promise<void>;
  setStatus: ReturnType<typeof createSlackTransport>["setStatus"];
  context: ReturnType<typeof createSlackTransport>["context"];
  profiles: ReturnType<typeof createSlackTransport>["profiles"];
  listen: (oracle: Oracle) => Promise<void>;
  close: () => Promise<void>;
}> {
  const app = new App({
    token: options.botToken,
    appToken: options.appToken,
    socketMode: true,
    clientOptions: {
      timeout: 5_000,
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
    },
    logger: {
      debug() {},
      info() {},
      warn() {
        options.onFault("slack_warning");
      },
      error() {
        options.onFault("slack_error");
      },
      setLevel() {},
      getLevel() {
        return LogLevel.ERROR;
      },
      setName() {},
    },
  });
  const identity = identitySchema.parse(await app.client.auth.test({ token: options.botToken }));
  if (
    options.expectedIdentity &&
    (options.expectedIdentity.user_id !== identity.user_id ||
      options.expectedIdentity.team_id !== identity.team_id)
  )
    throw new BoundaryError("slack_identity_changed");
  app.error(async () => {
    options.onFault("slack_listener_error");
  });
  const transport = createSlackTransport({
    identity,
    call: (method, args) => app.client.apiCall(method, args),
    onFault: options.onFault,
    mappings: options.mappings,
  });
  const receiving = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  const receive = async (args: Parameters<typeof transport.receive>[0]): Promise<void> => {
    if (closing) return;
    const operation = transport.receive(args);
    receiving.add(operation);
    try {
      await operation;
    } finally {
      receiving.delete(operation);
    }
  };
  return {
    identity,
    publish: transport.publish,
    setStatus: transport.setStatus,
    context: transport.context,
    profiles: transport.profiles,
    async listen(oracle) {
      app.event("app_mention", async ({ event, body }) => {
        await receive({ event, teamId: body.team_id, listener: "mention", oracle });
      });
      app.event("message", async ({ event, body }) => {
        await receive({ event, teamId: body.team_id, listener: "message", oracle });
      });
      await app.start();
    },
    close() {
      closing ??= (async () => {
        await app.stop();
        await Promise.allSettled(receiving);
      })();
      return closing;
    },
  };
}
