import { z } from "zod";
import { ruleSchema, sourceSchema } from "./rules";

export const captureSessionInputSchema = z.object({ sourceId: z.string().min(1) }).strict();
export const captureSessionSchema = captureSessionInputSchema.extend({
  id: z.string(),
  startedAt: z.number().int(),
  expiresAt: z.number().int(),
});
export const incidentReportSchema = z
  .object({
    sessionId: z.string().min(1).max(100),
    eventId: z.string().min(1).max(100),
    ruleId: z.string().min(1).max(100),
    ruleVersion: z.number().int().positive(),
    eventTime: z.number().int().positive(),
  })
  .strict();
export const incidentStatusSchema = z.enum(["open", "acknowledged", "dismissed", "resolved"]);
export const incidentCommandSchema = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(["acknowledge", "dismiss", "resolve"]),
  })
  .strict();
const ownerSchema = z.object({ userId: z.string(), name: z.string() });
const incidentBaseSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  eventId: z.string(),
  eventTime: z.number().int(),
  receivedAt: z.number().int(),
  source: sourceSchema,
  rule: ruleSchema,
  version: z.number().int().positive(),
  evidenceStatus: z.literal("pending"),
  notificationStatus: z.enum(["not-sent", "attempting", "accepted", "failed"]),
  timeline: z.array(
    z.object({
      kind: z.enum(["reported", "acknowledged", "dismissed", "resolved"]),
      at: z.number().int(),
      actorId: z.string(),
      actorName: z.string(),
    }),
  ),
});
export const incidentSchema = z.discriminatedUnion("status", [
  incidentBaseSchema.extend({ status: z.literal("open"), owner: z.null() }),
  incidentBaseSchema.extend({ status: z.literal("acknowledged"), owner: ownerSchema }),
  incidentBaseSchema.extend({ status: z.literal("dismissed"), owner: ownerSchema.nullable() }),
  incidentBaseSchema.extend({ status: z.literal("resolved"), owner: ownerSchema }),
]);
export const incidentInboxSchema = z.object({ incidents: z.array(incidentSchema) });
export const reportReceiptSchema = z.object({ incident: incidentSchema });
export type Incident = z.infer<typeof incidentSchema>;
export type IncidentCommand = z.infer<typeof incidentCommandSchema>;
export const incidentStatusLabels: Record<Incident["status"], string> = {
  open: "Needs attention",
  acknowledged: "Acknowledged",
  dismissed: "Dismissed as incorrect",
  resolved: "Resolved",
};
export const responseTransitions = {
  acknowledge: { from: ["open"], to: "acknowledged" },
  dismiss: { from: ["open", "acknowledged"], to: "dismissed" },
  resolve: { from: ["acknowledged"], to: "resolved" },
} satisfies Record<
  IncidentCommand["action"],
  { from: Incident["status"][]; to: Incident["status"] }
>;
