import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  deviceConfigurationSchema,
  operatorConfigurationSchema,
  ruleInputSchema,
  ruleSchema,
  ruleUpdateSchema,
  ruleVersionSchema,
  sourceInputSchema,
} from "@/lib/rules";
import { member, monitoringDevice } from "./access";
import { AccessError, json } from "./http";

const storedRuleSchema = z
  .object({
    id: z.string(),
    sourceId: z.string(),
    version: z.number(),
    enabled: z.number().transform((value) => value === 1),
    definition: z.string().transform((value): unknown => JSON.parse(value)),
  })
  .pipe(ruleSchema);
const ruleColumns = "id,source_id AS sourceId,version,enabled,definition";
const validAssignment = `EXISTS (SELECT 1 FROM source WHERE id=?1 AND workspace_id=?2)
  AND NOT EXISTS (SELECT 1 FROM json_each(?3,'$.recipientIds') r
    WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id=r.value AND m.workspace_id=?2))`;

async function configuration(workspaceId: string) {
  const [sources, rules] = await env.DB.batch([
    env.DB.prepare("SELECT id,name,kind FROM source WHERE workspace_id=? ORDER BY name,id").bind(
      workspaceId,
    ),
    env.DB.prepare(
      `SELECT ${ruleColumns} FROM monitoring_rule WHERE workspace_id=? ORDER BY created_at,id`,
    ).bind(workspaceId),
  ]);
  return deviceConfigurationSchema.parse({
    sources: sources?.results,
    rules: rules?.results.map((row) => storedRuleSchema.parse(row)),
  });
}
export async function operatorConfiguration(request: Request) {
  const actor = await member(request);
  const recipients = await env.DB.prepare(
    "SELECT m.user_id AS userId,u.name,m.role FROM membership m JOIN user u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.role,u.name,m.user_id",
  )
    .bind(actor.workspaceId)
    .all();
  return json(
    operatorConfigurationSchema.parse({
      ...(await configuration(actor.workspaceId)),
      recipients: recipients.results,
    }),
  );
}
export async function deviceConfiguration(request: Request) {
  const actor = await monitoringDevice(request);
  return json(await configuration(actor.workspaceId));
}
export async function createSource(request: Request) {
  const actor = await member(request);
  const input = sourceInputSchema.parse(await request.json());
  const row = await env.DB.prepare(
    "INSERT INTO source(id,workspace_id,name,kind) VALUES (?,?,?,?) ON CONFLICT(workspace_id,name) DO NOTHING RETURNING id,name,kind",
  )
    .bind(crypto.randomUUID(), actor.workspaceId, input.name, input.kind)
    .first();
  if (!row) throw new AccessError(409, "A source with this name already exists.");
  return json(row, 201);
}
export async function createRule(request: Request) {
  const actor = await member(request);
  const input = ruleInputSchema.parse(await request.json());
  const row =
    await env.DB.prepare(`INSERT INTO monitoring_rule(id,workspace_id,source_id,definition,enabled,version,created_at)
    SELECT ?4,?2,?1,?3,?5,1,?6 WHERE ${validAssignment} RETURNING ${ruleColumns}`)
      .bind(
        input.sourceId,
        actor.workspaceId,
        JSON.stringify(input.definition),
        crypto.randomUUID(),
        Number(input.enabled),
        Date.now(),
      )
      .first();
  if (!row) throw new AccessError(400, "Choose a source and recipients from this workspace.");
  return json(storedRuleSchema.parse(row), 201);
}
export async function updateRule(request: Request) {
  const actor = await member(request);
  const input = ruleUpdateSchema.parse(await request.json());
  const row =
    await env.DB.prepare(`UPDATE monitoring_rule SET source_id=?1,definition=?3,enabled=?4,version=version+1
    WHERE id=?5 AND workspace_id=?2 AND version=?6 AND ${validAssignment} RETURNING ${ruleColumns}`)
      .bind(
        input.sourceId,
        actor.workspaceId,
        JSON.stringify(input.definition),
        Number(input.enabled),
        input.id,
        input.version,
      )
      .first();
  if (!row)
    throw new AccessError(
      409,
      "Rule changed or its assignments are unavailable. Reload triggers and check the source and recipients.",
    );
  return json(storedRuleSchema.parse(row));
}
export async function disableRule(request: Request) {
  const actor = await member(request);
  const input = ruleVersionSchema.parse(await request.json());
  const row = await env.DB.prepare(
    `UPDATE monitoring_rule SET enabled=0,version=version+1 WHERE id=? AND workspace_id=? AND version=? RETURNING ${ruleColumns}`,
  )
    .bind(input.id, actor.workspaceId, input.version)
    .first();
  if (!row)
    throw new AccessError(409, "Rule changed or is unavailable. Reload triggers and try again.");
  return json(storedRuleSchema.parse(row));
}
