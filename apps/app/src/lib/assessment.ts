import { z } from "zod";
import { ruleVersionSchema, ruleInputSchema } from "./rules";

export const assessmentLimits = {
  requestBytes: 2 * 1024 * 1024,
  frameBytes: 192 * 1024,
  frames: 8,
  windowMs: 30_000,
  conditionCharacters: 2_000,
  providerTimeoutMs: 15_000,
  providerResponseBytes: 64 * 1024,
};

const frameMetadataSchema = z.strictObject({ mediaTimeMs: z.number().finite().nonnegative() });
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

export async function requestAssessment(
  request: AssessmentRequest,
  signal?: AbortSignal,
): Promise<AssessmentResult> {
  const input = assessmentRequestSchema.safeParse(request);
  if (!input.success) return { kind: "unavailable", reason: "invalid_request" };
  try {
    const body = new FormData();
    const { observation, ...reference } = input.data;
    body.set(
      "metadata",
      JSON.stringify({
        ...reference,
        observation: {
          ...observation,
          frames: observation.frames.map(({ mediaTimeMs }) => ({ mediaTimeMs })),
        },
      }),
    );
    observation.frames.forEach(({ image }, index) =>
      body.set(`frame-${index}`, image, `frame-${index}.jpg`),
    );
    const response = await fetch("/api/assessment", {
      method: "POST",
      body,
      signal,
    });
    if (response.status === 401 || response.status === 403)
      return { kind: "unavailable", reason: "unauthorized" };
    if (response.status === 429) return { kind: "unavailable", reason: "rate_limited" };
    if (response.status === 400 || response.status === 413)
      return { kind: "unavailable", reason: "invalid_request" };
    const result = assessmentResultSchema.safeParse(await response.json());
    if (
      !result.success ||
      (result.data.kind !== "unavailable" &&
        (!response.ok || result.data.kind !== request.observation.stage))
    )
      return { kind: "unavailable", reason: "invalid_result" };
    return result.data;
  } catch {
    return { kind: "unavailable", reason: signal?.aborted ? "cancelled" : "network_error" };
  }
}
