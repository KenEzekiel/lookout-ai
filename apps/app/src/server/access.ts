import { env } from "cloudflare:workers";
import { devicePrincipalSchema, memberSchema, type Principal } from "@/lib/access";
import { auth } from "./auth";
import { AccessError, cookie, digest } from "./http";

export const deviceCookie = "lookout_device";
export const pairingCookie = "lookout_pairing";
export async function principal(request: Request): Promise<Principal> {
  const credential = cookie(request, deviceCookie);
  if (credential) {
    const row = await env.DB.prepare(
      "SELECT d.id AS deviceId,d.workspace_id AS workspaceId,w.name AS workspaceName,d.name FROM device d JOIN workspace w ON w.id=d.workspace_id WHERE d.token_hash=? AND d.revoked_at IS NULL",
    )
      .bind(await digest(credential))
      .first();
    if (!row)
      throw new AccessError(
        401,
        "Device access revoked. Ask the owner to pair this browser again.",
      );
    return devicePrincipalSchema.parse({ ...row, kind: "device" });
  }
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return { kind: "visitor" };
  const row = await env.DB.prepare(
    "SELECT m.workspace_id AS workspaceId,w.name AS workspaceName,m.role FROM membership m JOIN workspace w ON w.id=m.workspace_id WHERE m.user_id=?",
  )
    .bind(session.user.id)
    .first();
  if (!row) return { kind: "unassigned-user", userId: session.user.id, name: session.user.name };
  return memberSchema.parse({
    ...row,
    kind: "member",
    userId: session.user.id,
    name: session.user.name,
  });
}
export async function member(request: Request, ownerOnly = false) {
  const actor = await principal(request);
  if (actor.kind !== "member")
    throw new AccessError(
      actor.kind === "visitor" ? 401 : 403,
      "Workspace member access required.",
    );
  if (ownerOnly && actor.role !== "owner")
    throw new AccessError(403, "Only the workspace owner can do this.");
  return actor;
}
export async function unassigned(request: Request) {
  const actor = await principal(request);
  if (actor.kind !== "unassigned-user")
    throw new AccessError(
      actor.kind === "visitor" ? 401 : 409,
      "Sign in with an account that has not joined a workspace.",
    );
  return actor;
}
export async function monitoringDevice(request: Request) {
  const actor = await principal(request);
  if (actor.kind !== "device")
    throw new AccessError(
      actor.kind === "visitor" ? 401 : 403,
      "A paired monitoring device is required.",
    );
  return actor;
}
