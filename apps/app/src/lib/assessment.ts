import { z } from "zod";
import { ruleVersionSchema, ruleInputSchema } from "./rules";

export const assessmentLimits = {
  cacheTtlMs: 60_000,
  deviceCacheBytes: 8 * 1024 * 1024,
  deviceCacheFrames: 64,
  workspaceCacheBytes: 24 * 1024 * 1024,
  workspaceCacheFrames: 192,
  requestBytes: 2 * 1024 * 1024,
  frameBytes: 192 * 1024,
  frames: 8,
  windowMs: 30_000,
  conditionCharacters: 2_010,
  providerTimeoutMs: 15_000,
  providerResponseBytes: 64 * 1024,
};

const frameMetadataSchema = z.strictObject({
  id: z.uuid(),
  mediaTimeMs: z.number().finite().nonnegative(),
});
const frameSchema = frameMetadataSchema.extend({
  image: z
    .instanceof(Blob)
    .refine(
      (image) =>
        image.type === "image/jpeg" && image.size > 0 && image.size <= assessmentLimits.frameBytes,
    ),
});

const observationMetadataSchema = z
  .strictObject({
    stage: z.enum(["assessment", "review"]),
    frames: z.array(frameMetadataSchema).min(1).max(assessmentLimits.frames),
  })
  .superRefine(({ frames }, context) => {
    if (new Set(frames.map((frame) => frame.id)).size !== frames.length)
      context.addIssue({ code: "custom", message: "Frame IDs must be unique." });
    const first = frames[0];
    for (const [index, frame] of frames.entries()) {
      const previous = frames[index - 1];
      if (
        (previous && frame.mediaTimeMs <= previous.mediaTimeMs) ||
        (first && frame.mediaTimeMs - first.mediaTimeMs > assessmentLimits.windowMs)
      ) {
        context.addIssue({
          code: "custom",
          message: "Frames must be chronological within 30 seconds.",
        });
      }
    }
  });

export const observationSchema = observationMetadataSchema.safeExtend({
  frames: z.array(frameSchema).min(1).max(assessmentLimits.frames),
});

export const reviewVerdictSchema = z.strictObject({
  outcome: z.enum(["positive", "rejected", "need_more_evidence"]),
  explanation: z.string().min(1).max(600),
});

export const assessmentMetadataSchema = z.strictObject({
  rule: ruleVersionSchema.strict(),
  sourceId: ruleInputSchema.shape.sourceId,
  observation: observationMetadataSchema,
});

export const assessmentRequestSchema = assessmentMetadataSchema.extend({
  observation: observationSchema,
});

export const uploadRequestSchema = assessmentMetadataSchema.extend({
  observation: observationMetadataSchema.safeExtend({
    frames: z
      .array(frameMetadataSchema.extend({ image: frameSchema.shape.image.optional() }))
      .min(1)
      .max(assessmentLimits.frames),
  }),
});

export const frameReceiptsSchema = z
  .array(z.strictObject({ id: z.uuid(), expiresAt: z.number().finite().positive() }))
  .max(assessmentLimits.frames);

export const missingFramesSchema = z.strictObject({
  kind: z.literal("frames_missing"),
  frameIds: z.array(z.uuid()).min(1).max(assessmentLimits.frames),
});

export const unavailableSchema = z.strictObject({
  kind: z.literal("unavailable"),
  reason: z.enum([
    "rule_unavailable",
    "unauthorized",
    "invalid_request",
    "rate_limited",
    "provider_not_configured",
    "provider_error",
    "provider_refusal",
    "invalid_result",
    "timeout",
    "cancelled",
    "network_error",
    "frames_missing",
    "cache_unavailable",
  ]),
});

export const assessmentResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("assessment"),
    matchProbability: z.number().min(0).max(1),
    unclearProbability: z.number().min(0).max(1),
  }),
  z.strictObject({ kind: z.literal("review"), ...reviewVerdictSchema.shape }),
  unavailableSchema,
]);

export type Observation = z.infer<typeof observationSchema>;
export type AssessmentRequest = z.infer<typeof assessmentRequestSchema>;
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;
export type Unavailable = z.infer<typeof unavailableSchema>;

export function createAssessmentClient() {
  const cached = new Map<string, { image: Blob; mediaTimeMs: number; expiresAt: number }>();
  return async function requestAssessment(
    request: AssessmentRequest,
    signal?: AbortSignal,
  ): Promise<AssessmentResult> {
    const input = assessmentRequestSchema.safeParse(request);
    if (!input.success) return { kind: "unavailable", reason: "invalid_request" };
    const { observation, ...reference } = input.data;
    const keyFor = (id: string) => JSON.stringify([reference.sourceId, id]);
    for (const [key, receipt] of cached) if (receipt.expiresAt <= Date.now()) cached.delete(key);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();
        const body = new FormData();
        body.set(
          "metadata",
          JSON.stringify({
            ...reference,
            observation: {
              ...observation,
              frames: observation.frames.map(({ id, mediaTimeMs }) => ({ id, mediaTimeMs })),
            },
          }),
        );
        observation.frames.forEach(({ id, image, mediaTimeMs }, index) => {
          const receipt = cached.get(keyFor(id));
          if (!receipt || receipt.image !== image || receipt.mediaTimeMs !== mediaTimeMs)
            body.set(`frame-${index}`, image, `frame-${index}.jpg`);
        });
        const response = await fetch("/api/assessment", { method: "POST", body, signal });
        if (response.status === 401 || response.status === 403) {
          cached.clear();
          return { kind: "unavailable", reason: "unauthorized" };
        }
        if (response.status === 429) return { kind: "unavailable", reason: "rate_limited" };
        if (response.status === 400 || response.status === 413)
          return { kind: "unavailable", reason: "invalid_request" };
        const data: unknown = await response.json();
        const receipts = frameReceiptsSchema.safeParse(
          JSON.parse(response.headers.get("X-Lookout-Frames") ?? "[]"),
        );
        if (!receipts.success) return { kind: "unavailable", reason: "invalid_result" };
        for (const receipt of receipts.data) {
          const frame = observation.frames.find((frame) => frame.id === receipt.id);
          if (!frame) return { kind: "unavailable", reason: "invalid_result" };
          cached.set(keyFor(frame.id), {
            image: frame.image,
            mediaTimeMs: frame.mediaTimeMs,
            expiresAt: Math.min(receipt.expiresAt, Date.now() + assessmentLimits.cacheTtlMs),
          });
        }
        while (cached.size > assessmentLimits.deviceCacheFrames) {
          const oldest = cached.keys().next();
          if (!oldest.done) cached.delete(oldest.value);
        }
        const missing = missingFramesSchema.safeParse(data);
        if (response.status === 409 && missing.success) {
          if (
            missing.data.frameIds.some((id) => !observation.frames.some((frame) => frame.id === id))
          )
            return { kind: "unavailable", reason: "invalid_result" };
          for (const id of missing.data.frameIds) cached.delete(keyFor(id));
          if (attempt === 0) continue;
          return { kind: "unavailable", reason: "frames_missing" };
        }
        const result = assessmentResultSchema.safeParse(data);
        if (
          !result.success ||
          (result.data.kind !== "unavailable" &&
            (!response.ok || result.data.kind !== observation.stage))
        )
          return { kind: "unavailable", reason: "invalid_result" };
        return result.data;
      }
      return { kind: "unavailable", reason: "frames_missing" };
    } catch {
      return { kind: "unavailable", reason: signal?.aborted ? "cancelled" : "network_error" };
    }
  };
}
