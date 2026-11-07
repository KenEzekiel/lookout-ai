import { z } from "zod";

export const addressSchema = z.object({
  channel: z.string().regex(/^[CDG][A-Z0-9]+$/),
  rootTs: z.string().regex(/^\d{10,}\.\d{1,6}$/),
});
export type Address = z.infer<typeof addressSchema>;

export const incomingSchema = z.object({
  address: addressSchema,
  ts: z.string().regex(/^\d{10,}\.\d{1,6}$/),
  actor: z.string().regex(/^[UW][A-Z0-9]+$/),
  text: z.string(),
  route: z.enum(["direct", "thread"]),
});
export type Incoming = z.infer<typeof incomingSchema>;
export const keyOf = (address: Address): string => `${address.channel}:${address.rootTs}`;
export const eventId = (input: Incoming): string => `${input.address.channel}:${input.ts}`;

export const historySchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string() });
export type HistoryItem = z.infer<typeof historySchema>;
export type ThreadContext =
  | {
      kind: "available";
      messages: readonly { actor: string; ts: string; text: string }[];
      truncated: boolean;
    }
  | { kind: "unavailable" };
export type UserProfiles = {
  users: readonly {
    slackUserId: string;
    slackUsername: string | null;
    displayName: string | null;
    realName: string | null;
    githubLogin: string | null;
  }[];
  unresolved: readonly string[];
  mappings: "available" | "unavailable";
  truncated: boolean;
};
export const outcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reply"), text: z.string().min(1).max(6000) }),
  z.object({ kind: z.literal("silent") }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;
export const progressSchema = z.object({
  kind: z.literal("progress"),
  text: z.string().min(1).max(6000),
});
export type Admission = "accepted" | "duplicate" | "ignored" | "busy" | "stopped";

export type Limits = typeof defaultLimits;
export const defaultLimits = {
  maxConcurrentSessions: 24,
  maxQueuedGlobal: 32,
  maxQueuedPerSession: 4,
  maxSessions: 128,
  maxHistoryBytes: 32_000,
  maxHistoryTurns: 24,
  maxInputBytes: 12_000,
  maxTurnMs: 180_000,
  maxEventAgeMs: 3_600_000,
  maxClockSkewMs: 60_000,
  maxDedupEntries: 512,
};

export function isCurrentInput(input: Incoming, limits: Limits, now: number): boolean {
  const at = Number(input.ts) * 1000;
  return (
    at >= now - limits.maxEventAgeMs &&
    at <= now + limits.maxClockSkewMs &&
    Buffer.byteLength(input.text) <= limits.maxInputBytes &&
    Boolean(input.text.trim())
  );
}

export class BoundaryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BoundaryError";
  }
}

export const assertActive = (signal: AbortSignal): void => {
  if (signal.aborted) throw new BoundaryError("turn_stopped");
};
