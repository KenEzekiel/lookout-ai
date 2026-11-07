import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  captureSessionInputSchema,
  captureSessionSchema,
  incidentCommandSchema,
  incidentInboxSchema,
  incidentReportSchema,
  incidentSchema,
  responseTransitions,
} from "@/lib/incidents";
import { member, monitoringDevice } from "./access";
import { ruleSchema, sourceSchema } from "@/lib/rules";
import { AccessError, json } from "./http";
import { evidenceForIncident } from "./evidence";
import { deliverIncidentPush } from "./push";

const columns = `id,device_id AS deviceId,session_id AS sessionId,event_id AS eventId,
  event_time AS eventTime,received_at AS receivedAt,context,status,version,owner,timeline,
  follow_up_due_at AS followUpDueAt,follow_up_attempted_at AS followUpAttemptedAt,
  CASE WHEN EXISTS (SELECT 1 FROM push_delivery p WHERE p.incident_id=incident.id AND p.status='accepted') THEN 'accepted'
    WHEN EXISTS (SELECT 1 FROM push_delivery p WHERE p.incident_id=incident.id AND p.status='attempting') THEN 'attempting'
    WHEN EXISTS (SELECT 1 FROM push_delivery p WHERE p.incident_id=incident.id) THEN 'failed'
    ELSE 'not-sent' END AS notificationStatus`;
const recordSchema = z
  .object({
    followUpDueAt: z.number().nullable(),
    followUpAttemptedAt: z.number().nullable(),
    context: z.string().transform((value): unknown => JSON.parse(value)),
    owner: z
      .string()
      .nullable()
      .transform((value): unknown => (value === null ? null : JSON.parse(value))),
    timeline: z.string().transform((value): unknown => JSON.parse(value)),
  })
  .passthrough()
  .transform(({ context, followUpDueAt, followUpAttemptedAt, ...row }) => {
    const snapshot = z.object({ source: sourceSchema, rule: ruleSchema }).parse(context);
    return incidentSchema.parse({
      ...row,
      ...snapshot,
      evidenceStatus: "preparing",
      evidenceReason: null,
      evidenceExpiresAt: null,
      followUp:
        followUpDueAt === null
          ? { kind: "none" }
          : followUpAttemptedAt !== null
            ? { kind: "attempted", dueAt: followUpDueAt, attemptedAt: followUpAttemptedAt }
            : { kind: row.status === "open" ? "scheduled" : "cancelled", dueAt: followUpDueAt },
    });
  });

async function incidentWithEvidence(row: Record<string, unknown>, checkObject = false) {
  const incident = recordSchema.parse(row);
  return incidentSchema.parse({
    ...incident,
    ...(await evidenceForIncident(incident.id, checkObject)),
  });
}

export async function startIncidentSession(request: Request) {
  const actor = await monitoringDevice(request);
  const input = captureSessionInputSchema.parse(await request.json());
  const now = Date.now();
  const row =
    await env.DB.prepare(`INSERT INTO incident_capture_session(id,workspace_id,device_id,source_id,started_at,expires_at)
    SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM source WHERE id=?4 AND workspace_id=?2)
      AND EXISTS (SELECT 1 FROM device WHERE id=?3 AND workspace_id=?2 AND revoked_at IS NULL)
    ON CONFLICT(device_id,source_id) DO UPDATE SET id=excluded.id,started_at=excluded.started_at,expires_at=excluded.expires_at
    RETURNING id,source_id AS sourceId,started_at AS startedAt,expires_at AS expiresAt`)
      .bind(
        crypto.randomUUID(),
        actor.workspaceId,
        actor.deviceId,
        input.sourceId,
        now,
        now + 12 * 60 * 60 * 1000,
      )
      .first();
  if (!row) throw new AccessError(403, "This source is not available to this device.");
  return json(captureSessionSchema.parse(row), 201);
}
export async function endIncidentSession(request: Request) {
  const actor = await monitoringDevice(request);
  const input = z
    .object({ id: z.string().min(1) })
    .strict()
    .parse(await request.json());
  await env.DB.prepare(
    "DELETE FROM incident_capture_session WHERE id=? AND workspace_id=? AND device_id=?",
  )
    .bind(input.id, actor.workspaceId, actor.deviceId)
    .run();
  return json({ ended: true });
}
export async function reportIncident(request: Request) {
  const actor = await monitoringDevice(request);
  const input = incidentReportSchema.parse(await request.json());
  const now = Date.now();
  const id = crypto.randomUUID();
  const inserted = await env.INCIDENT_FOLLOW_UP.getByName(id).create({ id, actor, input, now });
  const row = await env.DB.prepare(
    `SELECT ${columns} FROM incident WHERE workspace_id=? AND device_id=? AND session_id=? AND event_id=? AND rule_id=?`,
  )
    .bind(actor.workspaceId, actor.deviceId, input.sessionId, input.eventId, input.ruleId)
    .first();
  if (!row)
    throw new AccessError(
      409,
      "The rule or capture session is stale or unavailable. Refresh device configuration and start a current session.",
    );
  const incident = await incidentWithEvidence(row);
  if (incident.eventTime !== input.eventTime || incident.rule.version !== input.ruleVersion)
    throw new AccessError(409, "This event ID already belongs to a different report.");
  await deliverIncidentPush(incident.id);
  const delivered = await env.DB.prepare(`SELECT ${columns} FROM incident WHERE id=?`)
    .bind(incident.id)
    .first();
  if (!delivered) throw new AccessError(404, "Incident no longer exists.");
  return json({ incident: await incidentWithEvidence(delivered) }, inserted ? 201 : 200);
}
export async function incidentInbox(request: Request) {
  const actor = await member(request);
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM incident WHERE workspace_id=? ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,received_at DESC,id LIMIT 100`,
  )
    .bind(actor.workspaceId)
    .all();
  return json(
    incidentInboxSchema.parse({
      incidents: await Promise.all(rows.results.map((row) => incidentWithEvidence(row))),
    }),
  );
}
export async function incomingIncidents(request: Request) {
  const actor = await member(request);
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM incident WHERE workspace_id=?1 AND status='open'
      AND EXISTS (SELECT 1 FROM json_each(context,'$.rule.definition.recipientIds') WHERE value=?2)
      ORDER BY received_at,id LIMIT 100`,
  )
    .bind(actor.workspaceId, actor.userId)
    .all();
  return json(
    incidentInboxSchema.parse({
      incidents: await Promise.all(rows.results.map((row) => incidentWithEvidence(row))),
    }),
  );
}
export async function incidentDetail(request: Request, id: string) {
  const actor = await member(request);
  const row = await env.DB.prepare(`SELECT ${columns} FROM incident WHERE id=? AND workspace_id=?`)
    .bind(id, actor.workspaceId)
    .first();
  if (!row) throw new AccessError(404, "Incident not found in this workspace.");
  return json(await incidentWithEvidence(row, true));
}
export async function commandIncident(request: Request, id: string) {
  const actor = await member(request);
  const input = incidentCommandSchema.parse(await request.json());
  const transition = responseTransitions[input.action];
  const from: readonly string[] = transition.from;
  const row = await env.DB.prepare(`UPDATE incident SET status=?1,version=version+1,
      owner=CASE WHEN ?2='acknowledge' THEN ?3 ELSE owner END,
      timeline=json_insert(timeline,'$[#]',json(?4))
    WHERE id=?5 AND workspace_id=?6 AND version=?7 AND status IN (SELECT value FROM json_each(?8))
      AND EXISTS (SELECT 1 FROM membership WHERE user_id=?9 AND workspace_id=?6)
    RETURNING ${columns}`)
    .bind(
      transition.to,
      input.action,
      JSON.stringify({ userId: actor.userId, name: actor.name }),
      JSON.stringify({
        kind: transition.to,
        at: Date.now(),
        actorId: actor.userId,
        actorName: actor.name,
      }),
      id,
      actor.workspaceId,
      input.version,
      JSON.stringify(from),
      actor.userId,
    )
    .first();
  if (!row)
    throw new AccessError(
      409,
      "Incident changed or this action is unavailable. Reload the incident before responding.",
    );
  return json(await incidentWithEvidence(row));
}
