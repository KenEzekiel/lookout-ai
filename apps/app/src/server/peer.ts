import { env } from "cloudflare:workers";
import {
  peerSourceSchema,
  peerSyncSchema,
  peerSessionSchema,
  peerOpenSchema,
  peerIdSchema,
  peerDescriptionSchema,
  peerLeaseMs,
} from "@/lib/peer";
import { member, monitoringDevice } from "./access";
import { AccessError, json, limit } from "./http";

async function prune() {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM peer_session WHERE expires_at<=? OR NOT EXISTS(SELECT 1 FROM membership m WHERE m.user_id=peer_session.user_id AND m.workspace_id=peer_session.workspace_id) OR NOT EXISTS(SELECT 1 FROM device d WHERE d.id=peer_session.device_id AND d.revoked_at IS NULL) OR NOT EXISTS(SELECT 1 FROM peer_source p WHERE p.device_id=peer_session.device_id AND p.run_id=peer_session.run_id AND p.expires_at>?)",
    ).bind(now, now),
    env.DB.prepare("DELETE FROM peer_source WHERE expires_at<=?").bind(now),
  ]);
}
const selectSession =
  "SELECT s.id,s.run_id AS runId,p.kind,s.offer,s.answer FROM peer_session s JOIN peer_source p ON p.device_id=s.device_id AND p.run_id=s.run_id";

export async function syncDevice(request: Request) {
  const actor = await monitoringDevice(request);
  const source = peerSourceSchema.parse(await request.json());
  await prune();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM peer_session WHERE device_id=? AND run_id<>?").bind(
      actor.deviceId,
      source.runId,
    ),
    env.DB.prepare(
      "INSERT INTO peer_source(device_id,run_id,kind,expires_at) VALUES (?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET run_id=excluded.run_id,kind=excluded.kind,expires_at=excluded.expires_at",
    ).bind(actor.deviceId, source.runId, source.kind, Date.now() + peerLeaseMs),
  ]);
  const rows = await env.DB.prepare(`${selectSession} WHERE s.device_id=?`)
    .bind(actor.deviceId)
    .all();
  return json(peerSyncSchema.parse({ sessions: rows.results }));
}
export async function stopSource(request: Request) {
  const actor = await monitoringDevice(request);
  const { runId } = peerSourceSchema.pick({ runId: true }).parse(await request.json());
  await env.DB.batch([
    env.DB.prepare("DELETE FROM peer_session WHERE device_id=? AND run_id=?").bind(
      actor.deviceId,
      runId,
    ),
    env.DB.prepare("DELETE FROM peer_source WHERE device_id=? AND run_id=?").bind(
      actor.deviceId,
      runId,
    ),
  ]);
  return json({ closed: true });
}
export async function openView(request: Request) {
  const actor = await member(request);
  const { deviceId } = peerOpenSchema.parse(await request.json());
  await limit(`peer-open:${actor.userId}`, 20);
  await prune();
  const id = crypto.randomUUID();
  const row = await env.DB.prepare(
    "INSERT INTO peer_session(id,device_id,user_id,workspace_id,run_id,expires_at) SELECT ?,d.id,?,?,p.run_id,? FROM device d JOIN peer_source p ON p.device_id=d.id WHERE d.id=? AND d.workspace_id=? AND d.revoked_at IS NULL AND p.expires_at>? RETURNING id",
  )
    .bind(
      id,
      actor.userId,
      actor.workspaceId,
      Date.now() + peerLeaseMs,
      deviceId,
      actor.workspaceId,
      Date.now(),
    )
    .first();
  if (!row)
    throw new AccessError(
      409,
      "Device is offline or capture is stopped. Start capture on the device, then retry.",
    );
  const session = await env.DB.prepare(`${selectSession} WHERE s.id=?`).bind(id).first();
  return json(peerSessionSchema.parse(session), 201);
}
async function viewer(request: Request, id: string) {
  const actor = await member(request);
  await prune();
  const row = await env.DB.prepare(
    "SELECT id FROM peer_session WHERE id=? AND user_id=? AND workspace_id=?",
  )
    .bind(id, actor.userId, actor.workspaceId)
    .first();
  if (!row)
    throw new AccessError(
      410,
      "Live view ended. The source stopped, access changed, or the connection expired. Retry to reconnect.",
    );
  return actor;
}
export async function pollView(request: Request) {
  const { id } = peerIdSchema.parse(await request.json());
  await viewer(request, id);
  await env.DB.prepare("UPDATE peer_session SET expires_at=? WHERE id=?")
    .bind(Date.now() + peerLeaseMs, id)
    .run();
  const row = await env.DB.prepare(`${selectSession} WHERE s.id=?`).bind(id).first();
  if (!row) throw new AccessError(410, "Live view ended. Retry to reconnect.");
  return json(peerSessionSchema.parse(row));
}
export async function offerView(request: Request) {
  const { id, sdp } = peerDescriptionSchema.parse(await request.json());
  const actor = await viewer(request, id);
  const row = await env.DB.prepare(
    "UPDATE peer_session SET offer=? WHERE id=? AND user_id=? AND workspace_id=? AND offer IS NULL RETURNING id",
  )
    .bind(sdp, id, actor.userId, actor.workspaceId)
    .first();
  if (!row) throw new AccessError(409, "This live view already has an offer. Retry to reconnect.");
  return json({ accepted: true });
}
export async function answerView(request: Request) {
  const actor = await monitoringDevice(request);
  const { id, sdp } = peerDescriptionSchema.parse(await request.json());
  await prune();
  const row = await env.DB.prepare(
    "UPDATE peer_session SET answer=? WHERE id=? AND device_id=? AND workspace_id=? AND offer IS NOT NULL AND answer IS NULL RETURNING id",
  )
    .bind(sdp, id, actor.deviceId, actor.workspaceId)
    .first();
  if (!row) throw new AccessError(410, "Live view ended or is not assigned to this device.");
  return json({ accepted: true });
}
export async function closeView(request: Request) {
  const actor = await member(request);
  const { id } = peerIdSchema.parse(await request.json());
  await env.DB.prepare("DELETE FROM peer_session WHERE id=? AND user_id=? AND workspace_id=?")
    .bind(id, actor.userId, actor.workspaceId)
    .run();
  return json({ closed: true });
}
