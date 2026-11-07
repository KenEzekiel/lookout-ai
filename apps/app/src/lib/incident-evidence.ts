import type { CaptureSession, EventInterval } from "./capture-session";
import { z } from "zod";
import { request } from "./api";
import { buildEventClip, type EventClip } from "./event-clip";
import { incidentReportSchema, reportReceiptSchema, type Incident } from "./incidents";

type Report = z.infer<typeof incidentReportSchema>;
type Upload = { clip: EventClip; sessionId: string; eventId: string };
const retryable = new Map<string, Upload>();
const evidenceResponseSchema = z.object({
  evidenceStatus: z.enum(["preparing", "uploading", "ready", "unavailable"]),
  evidenceReason: z.string().nullable(),
  evidenceExpiresAt: z.number().nullable(),
});

export async function submitConfirmedEvent(
  session: CaptureSession,
  interval: EventInterval,
  report: Report,
): Promise<{ incident: Incident; evidenceError: string | null }> {
  const preserved = session.preserveEventInterval(interval).then(
    (event) => ({ event }),
    (error: unknown) => ({ error }),
  );
  const receipt = await request("/api/incidents/reports", reportReceiptSchema, report);
  const incident = receipt.incident;
  const result = await preserved;
  if ("error" in result) {
    await markUnavailable(incident.id, report, result.error);
    return { incident, evidenceError: errorMessage(result.error) };
  }
  let clip: EventClip;
  try {
    clip = await buildEventClip(result.event);
  } catch (error) {
    await markUnavailable(incident.id, report, error);
    return { incident, evidenceError: errorMessage(error) };
  }
  retryable.set(incident.id, { clip, sessionId: report.sessionId, eventId: report.eventId });
  try {
    await retryEvidenceUpload(incident.id);
    return { incident, evidenceError: null };
  } catch (error) {
    return { incident, evidenceError: errorMessage(error) };
  }
}

export async function retryEvidenceUpload(incidentId: string) {
  const upload = retryable.get(incidentId);
  if (!upload) throw new Error("This device no longer has the preserved clip to retry.");
  const started = await request(
    `/api/incidents/evidence-start/${encodeURIComponent(incidentId)}`,
    evidenceResponseSchema,
    { sessionId: upload.sessionId, eventId: upload.eventId },
  );
  if (started.evidenceStatus === "ready") {
    retryable.delete(incidentId);
    return;
  }
  const response = await fetch(`/api/incidents/evidence/${encodeURIComponent(incidentId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "X-Lookout-Session": upload.sessionId,
      "X-Lookout-Event": upload.eventId,
      "X-Clip-Duration-Ms": String(upload.clip.durationMs),
      "X-Event-Offset-Ms": String(upload.clip.eventOffsetMs),
    },
    body: upload.clip.blob,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error === "object" && error && "message" in error && typeof error.message === "string"
        ? error.message
        : "Clip upload failed. Retry while this device remains open.",
    );
  }
  const result = evidenceResponseSchema.parse(await response.json());
  if (result.evidenceStatus !== "ready")
    throw new Error(result.evidenceReason || "Clip upload did not finish.");
  retryable.delete(incidentId);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No playable footage is available.";
}

async function markUnavailable(incidentId: string, report: Report, error: unknown) {
  await request(
    `/api/incidents/evidence-unavailable/${encodeURIComponent(incidentId)}`,
    evidenceResponseSchema,
    {
      sessionId: report.sessionId,
      eventId: report.eventId,
      reason: errorMessage(error).slice(0, 240),
    },
  );
}
