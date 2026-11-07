import { env } from "cloudflare:workers";
import { z } from "zod";
import { member, monitoringDevice } from "./access";
import { AccessError, json } from "./http";

const retentionMs = 7 * 24 * 60 * 60 * 1000;
const uploadTimeoutMs = 2 * 60 * 1000;
const maxClipBytes = 32 * 1024 * 1024;
const identitySchema = z.object({ sessionId: z.string(), eventId: z.string() }).strict();
const unavailableSchema = identitySchema.extend({ reason: z.string().min(1).max(240) });
type EvidenceRow = {
  status: "preparing" | "uploading" | "ready" | "unavailable";
  reason: string | null;
  objectKey: string | null;
  updatedAt: number;
  expiresAt: number | null;
};

export async function evidenceForIncident(id: string, checkObject = false) {
  const row = await env.DB.prepare(
    "SELECT status,reason,object_key AS objectKey,updated_at AS updatedAt,expires_at AS expiresAt FROM incident_evidence WHERE incident_id=?",
  )
    .bind(id)
    .first<EvidenceRow>();
  if (!row)
    return { evidenceStatus: "preparing" as const, evidenceReason: null, evidenceExpiresAt: null };
  const now = Date.now();
  if (row.status === "uploading" && row.updatedAt + uploadTimeoutMs <= now) {
    await env.DB.prepare(
      "UPDATE incident_evidence SET status='unavailable',reason='Upload interrupted. Retry from the device.',updated_at=? WHERE incident_id=? AND status='uploading' AND updated_at=?",
    )
      .bind(now, id, row.updatedAt)
      .run();
    return {
      evidenceStatus: "unavailable" as const,
      evidenceReason: "Upload interrupted. Retry from the device.",
      evidenceExpiresAt: null,
    };
  }
  if (row.status === "ready" && row.expiresAt !== null && row.expiresAt <= now) {
    return {
      evidenceStatus: "unavailable" as const,
      evidenceReason: "Clip expired.",
      evidenceExpiresAt: row.expiresAt,
    };
  }
  if (
    checkObject &&
    row.status === "ready" &&
    row.objectKey &&
    !(await env.EVIDENCE.head(row.objectKey))
  ) {
    await env.DB.prepare(
      "UPDATE incident_evidence SET status='unavailable',reason='Saved clip is missing.',updated_at=? WHERE incident_id=? AND status='ready'",
    )
      .bind(now, id)
      .run();
    return {
      evidenceStatus: "unavailable" as const,
      evidenceReason: "Saved clip is missing.",
      evidenceExpiresAt: null,
    };
  }
  return {
    evidenceStatus: row.status,
    evidenceReason: row.reason,
    evidenceExpiresAt: row.expiresAt,
  };
}

async function deviceIncident(
  request: Request,
  id: string,
  identity: z.infer<typeof identitySchema>,
) {
  const actor = await monitoringDevice(request);
  const row = await env.DB.prepare(
    "SELECT id,workspace_id AS workspaceId FROM incident WHERE id=? AND workspace_id=? AND device_id=? AND session_id=? AND event_id=?",
  )
    .bind(id, actor.workspaceId, actor.deviceId, identity.sessionId, identity.eventId)
    .first<{ id: string; workspaceId: string }>();
  if (!row) throw new AccessError(404, "Incident not found for this device event.");
  return row;
}

async function rejectExpiredReady(id: string) {
  const row = await env.DB.prepare(
    "SELECT status,expires_at AS expiresAt FROM incident_evidence WHERE incident_id=?",
  )
    .bind(id)
    .first<{ status: string; expiresAt: number | null }>();
  if (row?.status === "ready" && row.expiresAt !== null && row.expiresAt <= Date.now()) {
    throw new AccessError(410, "This saved clip has expired.");
  }
}

export async function unavailableEvidence(request: Request, id: string) {
  const input = unavailableSchema.parse(await request.json());
  await deviceIncident(request, id, input);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO incident_evidence(incident_id,status,reason,updated_at)
      VALUES (?,'unavailable',?,?) ON CONFLICT(incident_id) DO UPDATE SET
      status='unavailable',reason=excluded.reason,updated_at=excluded.updated_at
      WHERE incident_evidence.status!='ready'`,
  )
    .bind(id, input.reason, now)
    .run();
  return json(await evidenceForIncident(id));
}

export async function startEvidence(request: Request, id: string) {
  const identity = identitySchema.parse(await request.json());
  await deviceIncident(request, id, identity);
  await rejectExpiredReady(id);
  await env.DB.prepare(
    `INSERT INTO incident_evidence(incident_id,status,reason,updated_at)
      VALUES (?,'uploading',NULL,?) ON CONFLICT(incident_id) DO UPDATE SET
      status='uploading',reason=NULL,updated_at=excluded.updated_at
      WHERE incident_evidence.status!='ready'`,
  )
    .bind(id, Date.now())
    .run();
  return json(await evidenceForIncident(id));
}

export async function uploadEvidence(request: Request, id: string) {
  const identity = identitySchema.parse({
    sessionId: request.headers.get("x-lookout-session"),
    eventId: request.headers.get("x-lookout-event"),
  });
  const incident = await deviceIncident(request, id, identity);
  await rejectExpiredReady(id);
  if (request.headers.get("content-type") !== "video/mp4")
    throw new AccessError(415, "Upload a video MP4 clip.");
  const durationMs = Number(request.headers.get("x-clip-duration-ms"));
  const eventOffsetMs = Number(request.headers.get("x-event-offset-ms"));
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > 21_000 ||
    !Number.isFinite(eventOffsetMs) ||
    eventOffsetMs < 0 ||
    eventOffsetMs > durationMs
  ) {
    throw new AccessError(400, "Clip interval is invalid.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength < 12 || bytes.byteLength > maxClipBytes)
    throw new AccessError(413, "Clip size is outside the upload limit.");
  if (new TextDecoder().decode(bytes.slice(4, 8)) !== "ftyp")
    throw new AccessError(415, "The clip is not an MP4 file.");
  const previous = await evidenceForIncident(id);
  if (previous.evidenceStatus === "ready") return json(previous);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO incident_evidence(incident_id,status,reason,updated_at)
      VALUES (?,'uploading',NULL,?) ON CONFLICT(incident_id) DO UPDATE SET
      status='uploading',reason=NULL,updated_at=excluded.updated_at
      WHERE incident_evidence.status!='ready'`,
  )
    .bind(id, now)
    .run();
  const objectKey = `${incident.workspaceId}/${id}.mp4`;
  await env.EVIDENCE.put(objectKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
  await env.DB.prepare(
    `UPDATE incident_evidence SET status='ready',reason=NULL,object_key=?,bytes=?,updated_at=?,expires_at=?
      WHERE incident_id=? AND status='uploading'`,
  )
    .bind(objectKey, bytes.byteLength, Date.now(), Date.now() + retentionMs, id)
    .run();
  return json(await evidenceForIncident(id, true));
}

export async function replayEvidence(request: Request, id: string) {
  const actor = await member(request);
  const row = await env.DB.prepare(
    `SELECT e.object_key AS objectKey,e.expires_at AS expiresAt FROM incident_evidence e
      JOIN incident i ON i.id=e.incident_id
      WHERE i.id=? AND i.workspace_id=? AND e.status='ready'`,
  )
    .bind(id, actor.workspaceId)
    .first<{ objectKey: string; expiresAt: number }>();
  if (!row || row.expiresAt <= Date.now()) throw new AccessError(404, "Replay is unavailable.");
  const head = await env.EVIDENCE.head(row.objectKey);
  const range = request.headers.get("range");
  let selected: { offset: number; length: number } | undefined;
  if (head && range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (match[1] === "" && match[2] === "")) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head.size}` },
      });
    }
    const start = match[1] === "" ? Math.max(0, head.size - Number(match[2])) : Number(match[1]);
    const end =
      match[2] === "" || match[1] === ""
        ? head.size - 1
        : Math.min(head.size - 1, Number(match[2]));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= head.size
    ) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head.size}` },
      });
    }
    selected = { offset: start, length: end - start + 1 };
  }
  const object = head
    ? await env.EVIDENCE.get(row.objectKey, selected ? { range: selected } : undefined)
    : null;
  if (!object || !("body" in object)) {
    await env.DB.prepare(
      "UPDATE incident_evidence SET status='unavailable',reason='Saved clip is missing.',updated_at=? WHERE incident_id=? AND status='ready'",
    )
      .bind(Date.now(), id)
      .run();
    throw new AccessError(404, "Replay is unavailable.");
  }
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Length": String(selected ? selected.length : object.size),
    "X-Content-Type-Options": "nosniff",
  });
  if (selected) {
    headers.set(
      "Content-Range",
      `bytes ${selected.offset}-${selected.offset + selected.length - 1}/${object.size}`,
    );
  }
  return new Response(object.body, { status: selected ? 206 : 200, headers });
}
