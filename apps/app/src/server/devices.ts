import { env } from "cloudflare:workers";
import { z } from "zod";
import { auth } from "./auth";
import { codeSchema, nameSchema } from "@/lib/access";
import {
  deviceCookie,
  deviceModeCookie,
  pairingCookie,
  member,
  monitoringDevice,
  rememberedDevice,
} from "./access";
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
  const input = z
    .union([
      codeSchema.extend({ deviceId: z.string().min(1) }).strict(),
      codeSchema.extend(nameSchema.shape).strict(),
    ])
    .parse(await request.json());
  const { code } = input;
  const hash = await codeDigest("pairing", code);
  const now = Date.now();
  const id = "deviceId" in input ? input.deviceId : crypto.randomUUID();
  if (
    "deviceId" in input &&
    !(await env.DB.prepare("SELECT id FROM device WHERE id=? AND workspace_id=?")
      .bind(id, actor.workspaceId)
      .first())
  )
    throw new AccessError(404, "Device not found in this workspace.");
  try {
    const [created] = await env.DB.batch([
      "deviceId" in input
        ? env.DB.prepare(
            "UPDATE device SET token_hash=(SELECT claim_hash FROM pairing_request WHERE code_hash=? AND expires_at>? AND device_id IS NULL),revoked_at=NULL WHERE id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM pairing_request WHERE code_hash=? AND expires_at>? AND device_id IS NULL) RETURNING id",
          ).bind(hash, now, id, actor.workspaceId, hash, now)
        : env.DB.prepare(
            "INSERT INTO device(id,workspace_id,name,token_hash,created_at) SELECT ?,?,?,claim_hash,? FROM pairing_request WHERE code_hash=? AND expires_at>? AND device_id IS NULL RETURNING id",
          ).bind(id, actor.workspaceId, input.name, Date.now(), hash, Date.now()),
      env.DB.prepare(
        "UPDATE pairing_request SET device_id=? WHERE code_hash=? AND device_id IS NULL AND EXISTS(SELECT 1 FROM device WHERE id=? AND token_hash=pairing_request.claim_hash AND workspace_id=?)",
      ).bind(id, hash, id, actor.workspaceId),
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
    "SELECT p.device_id AS deviceId,d.revoked_at AS revokedAt,d.workspace_id AS workspaceId FROM pairing_request p LEFT JOIN device d ON d.id=p.device_id WHERE p.claim_hash=? AND p.expires_at>? AND (p.device_id IS NULL OR d.token_hash=p.claim_hash)",
  )
    .bind(await digest(claim), Date.now())
    .first<{ deviceId: string | null; revokedAt: number | null; workspaceId: string | null }>();
  if (!row) throw new AccessError(410, "Pairing expired. Generate a new code.");
  if (!row.deviceId) return json({ status: "pending" });
  if (row.revokedAt !== null) throw new AccessError(401, "Device access revoked.");
  const session = await auth().api.getSession({ headers: request.headers });
  if (session) {
    const membership = await env.DB.prepare(
      "SELECT workspace_id AS workspaceId FROM membership WHERE user_id=?",
    )
      .bind(session.user.id)
      .first<{ workspaceId: string }>();
    if (membership?.workspaceId !== row.workspaceId)
      throw new AccessError(
        403,
        "This pairing belongs to another workspace. Sign out before claiming it.",
      );
  }
  return switchToDevice(claim);
}
function switchToDevice(token: string) {
  const response = json({ status: "paired" });
  response.headers.append("Set-Cookie", setCookie(deviceCookie, token, deviceLifetime));
  response.headers.append("Set-Cookie", setCookie(deviceModeCookie, "device", deviceLifetime));
  response.headers.append("Set-Cookie", setCookie(pairingCookie, "", 0));
  return response;
}
export async function activateThisBrowser(request: Request) {
  const actor = await member(request, true);
  const { name } = nameSchema.parse(await request.json());
  const remembered = await rememberedDevice(request);
  const existingToken = cookie(request, deviceCookie);
  if (remembered && existingToken) return switchToDevice(existingToken);
  await limit(`activate:${actor.userId}`);
  const token = secret();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO device(id,workspace_id,name,token_hash,created_at) VALUES (?,?,?,?,?)",
  )
    .bind(id, actor.workspaceId, name, await digest(token), Date.now())
    .run();
  return switchToDevice(token);
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
  response.headers.append("Set-Cookie", setCookie(deviceModeCookie, "workspace", deviceLifetime));
  response.headers.append("Set-Cookie", setCookie(pairingCookie, "", 0));
  return response;
}
export async function forgetDevice() {
  const response = await leaveDevice();
  response.headers.append("Set-Cookie", setCookie(deviceCookie, "", 0));
  return response;
}
export async function rememberedDeviceStatus(request: Request) {
  return json({ device: await rememberedDevice(request) });
}
