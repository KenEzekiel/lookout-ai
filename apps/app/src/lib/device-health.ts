import { z } from "zod";
import { ruleVersionSchema, sourceSchema } from "./rules";

export const healthReportIntervalMs = 5000;
export const healthFreshnessMs = 20_000;
export const captureFreshnessMs = 10_000;
export const assessmentFreshnessMs = 45_000;
const timestamp = z.number().int().nonnegative().safe();
export const assessmentHealthSchema = z.enum(["unavailable", "ready", "degraded"]);
export const healthReportSchema = z.strictObject({
  sourceId: z.string().min(1).max(100).nullable(),
  capture: z.enum(["idle", "starting", "running", "paused", "stopped", "error"]),
  lastObservationAt: timestamp.nullable(),
  assessment: assessmentHealthSchema,
  lastAssessmentAt: timestamp.nullable(),
  configurationAvailable: z.boolean(),
  appliedRules: z
    .array(ruleVersionSchema.strict())
    .max(100)
    .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length),
});
export type HealthReport = z.infer<typeof healthReportSchema>;
export const deviceHealthSchema = z.object({
  serverTime: timestamp,
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      revokedAt: timestamp.nullable(),
      lastContactAt: timestamp.nullable(),
      source: sourceSchema.nullable(),
      report: healthReportSchema.nullable(),
      assignedRules: z.array(ruleVersionSchema.extend({ name: z.string(), enabled: z.boolean() })),
    }),
  ),
});
export type DeviceHealth = z.infer<typeof deviceHealthSchema>["devices"][number];

export function configurationMatches(device: DeviceHealth) {
  const report = device.report;
  return (
    !!report?.configurationAvailable &&
    device.assignedRules.length === report.appliedRules.length &&
    device.assignedRules.every((rule) =>
      report.appliedRules.some(
        (applied) => applied.id === rule.id && applied.version === rule.version,
      ),
    )
  );
}

export function healthStatus(device: DeviceHealth, now: number) {
  const report = device.report;
  if (device.revokedAt !== null) return "Access removed";
  if (!report || device.lastContactAt === null) return "No reports yet";
  if (now - device.lastContactAt >= healthFreshnessMs) return "Disconnected / stale";
  if (report.capture === "paused") return "Paused";
  if (report.capture === "idle" || report.capture === "stopped") return "Stopped";
  if (report.capture === "error") return "Capture error";
  if (report.capture === "starting") return "Starting capture";
  if (report.lastObservationAt === null || now - report.lastObservationAt >= captureFreshnessMs)
    return "Capture stalled";
  if (!device.source) return "Preview only";
  if (!configurationMatches(device)) return "Configuration out of date";
  if (!device.assignedRules.some((rule) => rule.enabled)) return "No enabled triggers";
  if (report.assessment === "degraded") return "Assessment degraded";
  if (report.assessment === "unavailable" || report.lastAssessmentAt === null)
    return "Assessment unavailable";
  if (now - report.lastAssessmentAt >= assessmentFreshnessMs) return "Assessment stale";
  return "Monitoring";
}
