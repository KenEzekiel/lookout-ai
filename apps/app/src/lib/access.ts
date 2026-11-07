import { z } from "zod";

export const memberSchema = z.object({
  kind: z.literal("member"),
  userId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  name: z.string(),
  role: z.enum(["owner", "operator"]),
});
export const devicePrincipalSchema = z.object({
  kind: z.literal("device"),
  deviceId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  name: z.string(),
});
export const rememberedDeviceSchema = z.object({ device: devicePrincipalSchema.nullable() });
export const principalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visitor") }),
  z.object({ kind: z.literal("unassigned-user"), userId: z.string(), name: z.string() }),
  memberSchema,
  devicePrincipalSchema,
]);
export type Principal = z.infer<typeof principalSchema>;
export type Member = z.infer<typeof memberSchema>;
export type DevicePrincipal = z.infer<typeof devicePrincipalSchema>;
export const teamSchema = z.object({
  members: z.array(
    z.object({ userId: z.string(), name: z.string(), role: z.enum(["owner", "operator"]) }),
  ),
  devices: z.array(
    z.object({ id: z.string(), name: z.string(), revokedAt: z.number().nullable() }),
  ),
});
export const inviteSchema = z.object({
  code: z.string(),
  token: z.string(),
  expiresAt: z.number(),
});
export const pairingSchema = z.object({ code: z.string(), expiresAt: z.number() });
export const pairingStatusSchema = z.object({ status: z.enum(["pending", "paired"]) });
export const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const joinSchema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/) }),
  z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
