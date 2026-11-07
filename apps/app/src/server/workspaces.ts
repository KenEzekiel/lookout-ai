import { z } from "zod";
import { env } from "cloudflare:workers";
import { joinSchema, nameSchema } from "@/lib/access";
import { member, unassigned } from "./access";
import { AccessError, codeDigest, digest, json, limit, secret, shortCode } from "./http";

export async function createWorkspace(request: Request) {
  const actor = await unassigned(request);
  const { name } = nameSchema.parse(await request.json());
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO workspace(id,name,created_at) VALUES (?,?,?)").bind(
        id,
        name,
        Date.now(),
      ),
      env.DB.prepare("INSERT INTO membership(user_id,workspace_id,role) VALUES (?,?,'owner')").bind(
        actor.userId,
        id,
      ),
    ]);
  } catch (error) {
    if (
      await env.DB.prepare("SELECT user_id FROM membership WHERE user_id=?")
        .bind(actor.userId)
        .first()
    )
      throw new AccessError(409, "You already belong to a workspace.");
    throw error;
  }
  return json({ id }, 201);
}
export async function team(request: Request) {
  const actor = await member(request);
  const [members, devices] = await env.DB.batch([
    env.DB.prepare(
      "SELECT m.user_id AS userId,u.name,m.role FROM membership m JOIN user u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.role,u.name",
    ).bind(actor.workspaceId),
    env.DB.prepare(
      "SELECT id,name,revoked_at AS revokedAt FROM device WHERE workspace_id=? ORDER BY created_at DESC",
    ).bind(actor.workspaceId),
  ]);
  return json({ members: members?.results, devices: devices?.results });
}
export async function createInvitation(request: Request) {
  const actor = await member(request, true);
  await limit(`invite:${actor.userId}`);
  const expiresAt = Date.now() + 15 * 60_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = secret();
    const code = shortCode();
    const row = await env.DB.prepare(
      "INSERT INTO invitation(id,workspace_id,token_hash,code_hash,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(code_hash) DO NOTHING RETURNING id",
    )
      .bind(
        crypto.randomUUID(),
        actor.workspaceId,
        await digest(token),
        await codeDigest("invitation", code),
        expiresAt,
      )
      .first();
    if (row) return json({ token, code, expiresAt }, 201);
  }
  throw new AccessError(503, "Could not create an invitation. Try again.");
}
export async function joinWorkspace(request: Request) {
  const actor = await unassigned(request);
  await limit(`join:${actor.userId}`);
  await limit(`join-ip:${request.headers.get("cf-connecting-ip") ?? "local"}`, 30);
  const input = joinSchema.parse(await request.json());
  const hash =
    "code" in input ? await codeDigest("invitation", input.code) : await digest(input.token);
  const field = "code" in input ? "code_hash" : "token_hash";
  try {
    const [added] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO membership(user_id,workspace_id,role,invitation_id) SELECT ?,workspace_id,'operator',id FROM invitation WHERE ${field}=? AND expires_at>? AND used_by IS NULL AND revoked_at IS NULL RETURNING workspace_id`,
      ).bind(actor.userId, hash, Date.now()),
      env.DB.prepare(
        "UPDATE invitation SET used_by=? WHERE id=(SELECT invitation_id FROM membership WHERE user_id=?) AND used_by IS NULL",
      ).bind(actor.userId, actor.userId),
    ]);
    if (!added?.results.length)
      throw new AccessError(400, "Invitation is invalid, expired, or already used.");
  } catch (error) {
    if (
      await env.DB.prepare("SELECT user_id FROM membership WHERE user_id=?")
        .bind(actor.userId)
        .first()
    )
      throw new AccessError(409, "You already belong to a workspace.");
    throw error;
  }
  return json({ joined: true });
}
export async function removeMember(request: Request) {
  const actor = await member(request, true);
  const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
  const [, removed] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE monitoring_rule SET enabled=0,version=version+1 WHERE workspace_id=?1 AND EXISTS (SELECT 1 FROM json_each(definition,'$.recipientIds') WHERE value=?2) AND EXISTS (SELECT 1 FROM membership WHERE user_id=?2 AND workspace_id=?1 AND role='operator')",
    ).bind(actor.workspaceId, id),
    env.DB.prepare(
      "DELETE FROM membership WHERE user_id=? AND workspace_id=? AND role='operator' RETURNING user_id",
    ).bind(id, actor.workspaceId),
  ]);
  if (!removed?.results.length) throw new AccessError(404, "Operator not found in this workspace.");
  return json({ removed: true });
}
