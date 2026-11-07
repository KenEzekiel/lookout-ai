import { env } from "cloudflare:workers";
import { z } from "zod";
import { codeSchema, nameSchema } from "@/lib/access";
import { auth } from "./auth";
import { deviceCookie, pairingCookie, member, monitoringDevice } from "./access";
import {
  AccessError,
  codeDigest,
  cookie,
  digest,
  json,
  limit,
  secret,
  setCookie,
  shortCode,
} from "./http";

const deviceLifetime = 400 * 24 * 60 * 60;
export async function startPairing(request: Request) {
  await limit(`pair-start:${request.headers.get("cf-connecting-ip") ?? "local"}`);
  const claim = secret();
  const expiresAt = Date.now() + 5 * 60_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shortCode();
    const row = await env.DB.prepare(
      "INSERT INTO pairing_request(id,code_hash,claim_hash,expires_at) VALUES (?,?,?,?) ON CONFLICT(code_hash) DO NOTHING RETURNING id",
    )
      .bind(crypto.randomUUID(), await codeDigest("pairing", code), await digest(claim), expiresAt)
      .first();
    if (!row) continue;
    const response = json({ code, expiresAt }, 201);
    response.headers.append("Set-Cookie", setCookie(pairingCookie, claim, 5 * 60));
    return response;
  }
  throw new AccessError(503, "Could not create a pairing code. Try again.");
}
export async function approvePairing(request: Request) {
  const actor = await member(request, true);
  await limit(`pair-approve:${actor.userId}`);
  const { code, name } = codeSchema.extend(nameSchema.shape).parse(await request.json());
  const hash = await codeDigest("pairing", code);
  const id = crypto.randomUUID();
  try {
    const [created] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO device(id,workspace_id,name,token_hash,created_at) SELECT ?,?,?,claim_hash,? FROM pairing_request WHERE code_hash=? AND expires_at>? AND device_id IS NULL RETURNING id",
      ).bind(id, actor.workspaceId, name, Date.now(), hash, Date.now()),
      env.DB.prepare(
        "UPDATE pairing_request SET device_id=? WHERE code_hash=? AND device_id IS NULL AND EXISTS(SELECT 1 FROM device WHERE id=?)",
      ).bind(id, hash, id),
    ]);
    if (!created?.results.length)
      throw new AccessError(400, "Pairing code is invalid, expired, or already used.");
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: device.token_hash"))
      throw new AccessError(409, "This device was already paired.");
    throw error;
  }
  return json({ paired: true });
}
export async function claimPairing(request: Request) {
  const claim = cookie(request, pairingCookie);
  if (!claim) throw new AccessError(410, "Pairing expired. Generate a new code.");
  const row = await env.DB.prepare(
    "SELECT p.device_id AS deviceId,d.revoked_at AS revokedAt FROM pairing_request p LEFT JOIN device d ON d.id=p.device_id WHERE p.claim_hash=? AND p.expires_at>?",
  )
    .bind(await digest(claim), Date.now())
    .first<{ deviceId: string | null; revokedAt: number | null }>();
  if (!row) throw new AccessError(410, "Pairing expired. Generate a new code.");
  if (!row.deviceId) return json({ status: "pending" });
  if (row.revokedAt !== null) throw new AccessError(401, "Device access revoked.");
  const response = await switchToDevice(request, claim);
  return response;
}
async function switchToDevice(request: Request, token: string) {
  const signOut = await auth().api.signOut({ headers: request.headers, asResponse: true });
  if (!signOut.ok) throw new AccessError(503, "Could not end the human session. Try again.");
  const response = json({ status: "paired" });
  for (const value of signOut.headers.getSetCookie()) response.headers.append("Set-Cookie", value);
  response.headers.append("Set-Cookie", setCookie(deviceCookie, token, deviceLifetime));
  response.headers.append("Set-Cookie", setCookie(pairingCookie, "", 0));
  return response;
}
export async function activateThisBrowser(request: Request) {
  const actor = await member(request, true);
  const { name } = nameSchema.parse(await request.json());
  await limit(`activate:${actor.userId}`);
  const token = secret();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO device(id,workspace_id,name,token_hash,created_at) VALUES (?,?,?,?,?)",
  )
    .bind(id, actor.workspaceId, name, await digest(token), Date.now())
    .run();
  try {
    return await switchToDevice(request, token);
  } catch (error) {
    await env.DB.prepare("DELETE FROM device WHERE id=?").bind(id).run();
    throw error;
  }
}
export async function revokeDevice(request: Request) {
  const actor = await member(request, true);
  const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
  const row = await env.DB.prepare(
    "UPDATE device SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND workspace_id=? RETURNING id",
  )
    .bind(Date.now(), id, actor.workspaceId)
    .first();
  if (!row) throw new AccessError(404, "Device not found in this workspace.");
  return json({ revoked: true });
}
export async function deviceStatus(request: Request) {
  const actor = await monitoringDevice(request);
  const response = json(actor);
  const token = cookie(request, deviceCookie);
  if (token) response.headers.append("Set-Cookie", setCookie(deviceCookie, token, deviceLifetime));
  return response;
}
export async function leaveDevice() {
  const response = json({ left: true });
  response.headers.append("Set-Cookie", setCookie(deviceCookie, "", 0));
  response.headers.append("Set-Cookie", setCookie(pairingCookie, "", 0));
  return response;
}
