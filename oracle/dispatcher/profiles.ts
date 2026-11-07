import { z } from "zod";
import type { Incoming, ThreadContext, UserProfiles } from "../session/domain.js";

export const userIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);
const labelSchema = z.string().transform((value) => value.trim().slice(0, 200) || null);
const memberSchema = z.object({
  user: z.object({
    id: userIdSchema,
    name: labelSchema.optional(),
    team_id: z.string(),
    is_bot: z.boolean(),
    deleted: z.boolean(),
    is_stranger: z.boolean().optional(),
    profile: z
      .object({
        display_name: labelSchema.optional(),
        real_name: labelSchema.optional(),
      })
      .optional(),
  }),
});
const mappingsSchema = z
  .object({
    teamId: z.string().regex(/^T[A-Z0-9]+$/),
    users: z
      .array(
        z
          .object({
            slackUserId: userIdSchema,
            githubLogin: z
              .string()
              .max(39)
              .regex(/^[a-z\d]+(?:-[a-z\d]+)*$/i),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .superRefine(({ users }, ctx) => {
    if (
      new Set(users.map((user) => user.slackUserId)).size !== users.length ||
      new Set(users.map((user) => user.githubLogin.toLowerCase())).size !== users.length
    )
      ctx.addIssue({ code: "custom", message: "User mappings must be unique." });
  });

export function createProfileDirectory(options: {
  teamId: string;
  call: (method: string, args: Record<string, unknown>) => Promise<unknown>;
  mappings: () => Promise<unknown>;
  onFault: (code: string) => void;
}) {
  const members = new Map<string, Promise<z.infer<typeof memberSchema>["user"] | undefined>>();
  const member = (actor: string) => {
    let lookup = members.get(actor);
    if (!lookup) {
      lookup = (async () => {
        try {
          const { user } = memberSchema.parse(await options.call("users.info", { user: actor }));
          if (
            user.id === actor &&
            user.team_id === options.teamId &&
            !user.is_bot &&
            !user.deleted &&
            !user.is_stranger
          )
            return user;
        } catch {
          members.delete(actor);
          options.onFault("slack_membership_unavailable");
        }
        return undefined;
      })();
      members.set(actor, lookup);
    }
    return lookup;
  };
  return {
    isMember: async (actor: string): Promise<boolean> => Boolean(await member(actor)),
    async resolve(input: Incoming, thread: ThreadContext): Promise<UserProfiles> {
      let mappings: UserProfiles["mappings"] = "available";
      let configured: z.infer<typeof mappingsSchema>["users"] = [];
      try {
        const raw = await options.mappings();
        if (raw !== undefined) {
          const parsed = mappingsSchema.parse(raw);
          if (parsed.teamId !== options.teamId) throw new Error("profile_workspace_changed");
          configured = parsed.users;
        }
      } catch {
        mappings = "unavailable";
        options.onFault("profile_map_unavailable");
      }
      const messages = thread.kind === "available" ? thread.messages : [];
      const ids = new Set([
        input.actor,
        ...[input.text, ...messages.map((message) => message.text)].flatMap((text) =>
          Array.from(text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g)).flatMap(([, id]) =>
            id ? [id] : [],
          ),
        ),
        ...messages.map((message) => message.actor),
        ...configured.map((user) => user.slackUserId),
      ]);
      const selected = [...ids].slice(0, 64);
      const users: UserProfiles["users"][number][] = [];
      const unresolved: string[] = [];
      const resolved = await Promise.all(selected.map(member));
      for (const [index, actor] of selected.entries()) {
        const user = resolved[index];
        if (!user) {
          unresolved.push(actor);
          continue;
        }
        users.push({
          slackUserId: actor,
          slackUsername: user.name ?? null,
          displayName: user.profile?.display_name ?? null,
          realName: user.profile?.real_name ?? null,
          githubLogin:
            configured.find((profile) => profile.slackUserId === actor)?.githubLogin ?? null,
        });
      }
      return { users, unresolved, mappings, truncated: ids.size > selected.length };
    },
  };
}
