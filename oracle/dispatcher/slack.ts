import { App, LogLevel } from "@slack/bolt";
import { z } from "zod";
import { addressSchema, BoundaryError, type Incoming, incomingSchema } from "../session/domain.js";
import type { Oracle } from "./index.js";

const userIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);
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
  channel_type: z.string().optional(),
  bot_id: z.unknown().optional(),
  bot_profile: z.unknown().optional(),
  subtype: z.unknown().optional(),
});

export function routeSlack(args: {
  event: unknown;
  listener: "mention" | "message";
  identity: Identity;
  allowedActors: ReadonlySet<string>;
  owns: Oracle["owns"];
}): Incoming | undefined {
  const parsed = eventSchema.safeParse(args.event);
  if (!parsed.success) return;
  const event = parsed.data;
  if (
    event.user === args.identity.user_id ||
    !args.allowedActors.has(event.user) ||
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
  return incomingSchema.parse({
    address,
    ts: event.ts,
    actor: event.user,
    text: event.text.split(ownMention).join("").trim(),
    route: direct ? "direct" : "thread",
  });
}

export async function connectSlack(options: {
  botToken: string;
  appToken: string;
  allowedActors: ReadonlySet<string>;
  expectedIdentity?: Identity;
  onFault: (code: string) => void;
}): Promise<{
  identity: Identity;
  publish: (address: Incoming["address"], text: string) => Promise<void>;
  listen: (oracle: Oracle) => Promise<void>;
  close: () => Promise<void>;
}> {
  const app = new App({
    token: options.botToken,
    appToken: options.appToken,
    socketMode: true,
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
  return {
    identity,
    async publish(address, text) {
      await app.client.chat.postMessage({
        channel: address.channel,
        thread_ts: address.rootTs,
        text,
      });
    },
    async listen(oracle) {
      const receive = async (event: unknown, listener: "mention" | "message"): Promise<void> => {
        const input = routeSlack({
          event,
          listener,
          identity,
          allowedActors: options.allowedActors,
          owns: oracle.owns,
        });
        if (input) await oracle.receive(input);
      };
      app.event("app_mention", async ({ event }) => {
        await receive(event, "mention");
      });
      app.event("message", async ({ event }) => {
        await receive(event, "message");
      });
      await app.start();
    },
    async close() {
      await app.stop();
    },
  };
}
