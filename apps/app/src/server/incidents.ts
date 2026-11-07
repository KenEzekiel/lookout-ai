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

const columns = `id,device_id AS deviceId,session_id AS sessionId,event_id AS eventId,
  event_time AS eventTime,received_at AS receivedAt,context,status,version,owner,timeline`;
const recordSchema = z
  .object({
    context: z.string().transform((value): unknown => JSON.parse(value)),
    owner: z
      .string()
      .nullable()
      .transform((value): unknown => (value === null ? null : JSON.parse(value))),
    timeline: z.string().transform((value): unknown => JSON.parse(value)),
  })
  .passthrough()
  .transform(({ context, ...row }) => {
    const snapshot = z.object({ source: sourceSchema, rule: ruleSchema }).parse(context);
    return incidentSchema.parse({
      ...row,
      ...snapshot,
      evidenceStatus: "pending",
      notificationStatus: "not-sent",
    });
  });

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
  const inserted =
    await env.DB.prepare(`INSERT INTO incident(id,workspace_id,device_id,session_id,event_id,rule_id,event_time,received_at,context,status,version,owner,timeline)
    SELECT ?1,?2,?3,?4,?5,r.id,?6,?7,
      json_object('source',json_object('id',s.id,'name',s.name,'kind',s.kind),
        'rule',json_object('id',r.id,'sourceId',r.source_id,'version',r.version,'enabled',json('true'),'definition',json(r.definition))),
      'open',1,NULL,json_array(json(?8))
    FROM monitoring_rule r JOIN source s ON s.id=r.source_id AND s.workspace_id=r.workspace_id
      JOIN incident_capture_session c ON c.source_id=s.id AND c.workspace_id=r.workspace_id
    WHERE r.id=?9 AND r.workspace_id=?2 AND r.version=?10 AND r.enabled=1
      AND c.id=?4 AND c.device_id=?3 AND c.expires_at>?7 AND ?6>=c.started_at-30000 AND ?6<=?7+60000
      AND EXISTS (SELECT 1 FROM device WHERE id=?3 AND workspace_id=?2 AND revoked_at IS NULL)
    ON CONFLICT(device_id,session_id,event_id,rule_id) DO NOTHING RETURNING id`)
      .bind(
        crypto.randomUUID(),
        actor.workspaceId,
        actor.deviceId,
        input.sessionId,
        input.eventId,
        input.eventTime,
        now,
        JSON.stringify({
          kind: "reported",
          at: now,
          actorId: actor.deviceId,
          actorName: actor.name,
        }),
        input.ruleId,
        input.ruleVersion,
      )
      .first();
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
  const incident = recordSchema.parse(row);
  if (incident.eventTime !== input.eventTime || incident.rule.version !== input.ruleVersion)
    throw new AccessError(409, "This event ID already belongs to a different report.");
  return json({ incident }, inserted ? 201 : 200);
}
export async function incidentInbox(request: Request) {
  const actor = await member(request);
  const rows = await env.DB.prepare(
    `SELECT ${columns} FROM incident WHERE workspace_id=? ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,received_at DESC,id LIMIT 100`,
  )
    .bind(actor.workspaceId)
    .all();
  return json(
    incidentInboxSchema.parse({ incidents: rows.results.map((row) => recordSchema.parse(row)) }),
  );
}
export async function incidentDetail(request: Request, id: string) {
  const actor = await member(request);
  const row = await env.DB.prepare(`SELECT ${columns} FROM incident WHERE id=? AND workspace_id=?`)
    .bind(id, actor.workspaceId)
    .first();
  if (!row) throw new AccessError(404, "Incident not found in this workspace.");
  return json(recordSchema.parse(row));
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
  return json(recordSchema.parse(row));
}
