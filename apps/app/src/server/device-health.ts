import { env } from "cloudflare:workers";
import { z } from "zod";
import { deviceHealthSchema, healthReportSchema } from "@/lib/device-health";
import { ruleDefinitionSchema, sourceSchema } from "@/lib/rules";
import { member, monitoringDevice } from "./access";
import { AccessError, json } from "./http";

export async function reportHealth(request: Request) {
  const actor = await monitoringDevice(request);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AccessError(415, "Health reports must contain JSON metadata only.");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "A health report is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) {
        void reader.cancel();
        throw new AccessError(413, "Health report is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const report = healthReportSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const now = Date.now();
  if (
    [report.lastObservationAt, report.lastAssessmentAt].some((at) => at !== null && at > now + 5000)
  )
    throw new AccessError(400, "Observation times cannot be in the future.");
  if (report.sourceId !== null) {
    const source = await env.DB.prepare("SELECT id FROM source WHERE id=? AND workspace_id=?")
      .bind(report.sourceId, actor.workspaceId)
      .first();
    if (!source) throw new AccessError(404, "Source not found in this workspace.");
  }
  const previous = await env.DB.prepare("SELECT report FROM device_health WHERE device_id=?")
    .bind(actor.deviceId)
    .first<{ report: string }>();
  if (previous) {
    const prior = healthReportSchema.parse(JSON.parse(previous.report));
    if (prior.sourceId === report.sourceId) {
      report.lastObservationAt ??= prior.lastObservationAt;
      report.lastAssessmentAt ??= prior.lastAssessmentAt;
    }
  }
  const row = await env.DB.prepare(`
    INSERT INTO device_health(device_id,last_contact_at,report)
    SELECT id,?1,?2 FROM device WHERE id=?3 AND workspace_id=?4 AND revoked_at IS NULL
    ON CONFLICT(device_id) DO UPDATE SET last_contact_at=excluded.last_contact_at,report=excluded.report
    RETURNING device_id`)
    .bind(now, JSON.stringify(report), actor.deviceId, actor.workspaceId)
    .first();
  if (!row) throw new AccessError(401, "Device access revoked.");
  return json({ receivedAt: now });
}

export async function operatorHealth(request: Request) {
  const actor = await member(request);
  const [devices, sources, rules] = await env.DB.batch([
    env.DB.prepare(`SELECT d.id,d.name,d.revoked_at AS revokedAt,h.last_contact_at AS lastContactAt,h.report
      FROM device d LEFT JOIN device_health h ON h.device_id=d.id WHERE d.workspace_id=? ORDER BY d.created_at,d.id`).bind(
      actor.workspaceId,
    ),
    env.DB.prepare("SELECT id,name,kind FROM source WHERE workspace_id=?").bind(actor.workspaceId),
    env.DB.prepare(
      "SELECT id,source_id AS sourceId,version,enabled,definition FROM monitoring_rule WHERE workspace_id=?",
    ).bind(actor.workspaceId),
  ]);
  const storedDevices = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        revokedAt: z.number().nullable(),
        lastContactAt: z.number().nullable(),
        report: z.string().nullable(),
      }),
    )
    .parse(devices?.results);
  const storedSources = z.array(sourceSchema).parse(sources?.results);
  const storedRules = z
    .array(
      z.object({
        id: z.string(),
        sourceId: z.string(),
        version: z.number(),
        enabled: z.number(),
        definition: z.string(),
      }),
    )
    .parse(rules?.results);
  return json(
    deviceHealthSchema.parse({
      serverTime: Date.now(),
      devices: storedDevices.map((device) => {
        const report =
          typeof device.report === "string"
            ? healthReportSchema.parse(JSON.parse(device.report))
            : null;
        return {
          ...device,
          report,
          source: storedSources.find((source) => source.id === report?.sourceId) ?? null,
          assignedRules: storedRules
            .filter((rule) => rule.sourceId === report?.sourceId)
            .map((rule) => ({
              id: rule.id,
              version: rule.version,
              enabled: rule.enabled === 1,
              name: ruleDefinitionSchema.parse(JSON.parse(rule.definition)).name,
            })),
        };
      }),
    }),
  );
}
