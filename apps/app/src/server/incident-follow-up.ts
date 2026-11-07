import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { devicePrincipalSchema } from "@/lib/access";
import { incidentReportSchema } from "@/lib/incidents";

const creationSchema = z.object({
  id: z.string(),
  actor: devicePrincipalSchema,
  input: incidentReportSchema,
  now: z.number().int(),
});
const scheduleSchema = z.object({
  dueAt: z.number().int(),
  attemptedAt: z.number().int().nullable(),
  status: z.string(),
});

export class IncidentFollowUp extends DurableObject<Cloudflare.Env> {
  async create(creation: z.infer<typeof creationSchema>) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const input = creationSchema.parse(creation);
      await this.ctx.storage.put({ incidentId: input.id, creation: input });
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      const inserted = await this.insert(input);
      await this.ctx.storage.delete("creation");
      await this.schedule(input.id);
      return inserted;
    });
  }

  private async insert({ id, actor, input, now }: z.infer<typeof creationSchema>) {
    const inserted =
      await this.env.DB.prepare(`INSERT INTO incident(id,workspace_id,device_id,session_id,event_id,rule_id,event_time,received_at,context,status,version,owner,timeline,follow_up_due_at)
    SELECT ?1,?2,?3,?4,?5,r.id,?6,?7,
      json_object('source',json_object('id',s.id,'name',s.name,'kind',s.kind),
        'rule',json_object('id',r.id,'sourceId',r.source_id,'version',r.version,'enabled',json('true'),'definition',json(r.definition))),
      'open',1,NULL,json_array(json(?8)),?7+json_extract(r.definition,'$.escalationDelaySeconds')*1000
    FROM monitoring_rule r JOIN source s ON s.id=r.source_id AND s.workspace_id=r.workspace_id
      JOIN incident_capture_session c ON c.source_id=s.id AND c.workspace_id=r.workspace_id
    WHERE r.id=?9 AND r.workspace_id=?2 AND r.version=?10 AND r.enabled=1
      AND c.id=?4 AND c.device_id=?3 AND c.expires_at>?7 AND ?6>=c.started_at-30000 AND ?6<=?7+60000
      AND EXISTS (SELECT 1 FROM device WHERE id=?3 AND workspace_id=?2 AND revoked_at IS NULL)
    ON CONFLICT(device_id,session_id,event_id,rule_id) DO NOTHING RETURNING id`)
        .bind(
          id,
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
    return inserted !== null;
  }

  private async schedule(id: string) {
    const row = await this.env.DB.prepare(
      "SELECT follow_up_due_at AS dueAt,follow_up_attempted_at AS attemptedAt,status FROM incident WHERE id=?",
    )
      .bind(id)
      .first();
    if (!row) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const schedule = scheduleSchema.parse(row);
    if (schedule.status === "open" && schedule.attemptedAt === null) {
      await this.ctx.storage.setAlarm(Math.max(Date.now(), schedule.dueAt));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm() {
    return this.dispatch();
  }

  async dispatch() {
    try {
      await this.publish();
    } catch (error) {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      throw error;
    }
  }

  private async publish() {
    const creation = await this.ctx.storage.get("creation");
    if (creation !== undefined) {
      await this.insert(creationSchema.parse(creation));
      await this.ctx.storage.delete("creation");
    }
    const id = z.string().parse(await this.ctx.storage.get("incidentId"));
    const now = Date.now();
    await this.env.DB.prepare(`UPDATE incident SET follow_up_attempted_at=?1,
        timeline=json_insert(timeline,'$[#]',json_object('kind','follow-up-attempted',
          'at',?1,'actorId','system','actorName','Lookout'))
      WHERE id=?2 AND status='open' AND follow_up_due_at<=?1 AND follow_up_attempted_at IS NULL`)
      .bind(now, id)
      .run();
    await this.schedule(id);
  }
}
