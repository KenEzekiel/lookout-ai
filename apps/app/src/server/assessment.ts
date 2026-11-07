import { env } from "cloudflare:workers";
import { conditionText } from "../lib/rules";
import { monitoringDevice } from "./access";
import { readAssessmentRequest } from "./assessment-body";
import { json, limit } from "./http";
import { assessmentRule } from "./rules";
import { requestProviderAssessment } from "./assessment-provider";

export async function assessment(request: Request) {
  const device = await monitoringDevice(request);
  await limit(`assessment:device:${device.deviceId}`, 60);
  await limit(`assessment:workspace:${device.workspaceId}`, 240);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  let input;
  try {
    input = await readAssessmentRequest(request, signal);
  } catch (error) {
    if (error instanceof RangeError)
      return json({ kind: "unavailable", reason: "invalid_request" }, 413);
    if (signal.aborted) return json({ kind: "unavailable", reason: "timeout" }, 408);
    return json({ kind: "unavailable", reason: "invalid_request" }, 400);
  }
  const rule = await assessmentRule(device.workspaceId, input.rule, input.sourceId);
  if (!rule) return json({ kind: "unavailable", reason: "rule_unavailable" }, 409);
  if (input.observation.stage === "review") {
    await limit(`review:device:${device.deviceId}`, 6);
    await limit(`review:workspace:${device.workspaceId}`, 24);
  }
  let resolved;
  try {
    resolved = await env.FRAME_CACHE.getByName(device.workspaceId).resolve({
      deviceId: device.deviceId,
      sourceId: input.sourceId,
      frames: await Promise.all(
        input.observation.frames.map(async (frame) => ({
          ...frame,
          image: frame.image ? await frame.image.arrayBuffer() : undefined,
        })),
      ),
    });
  } catch {
    return json({ kind: "unavailable", reason: "cache_unavailable" }, 503);
  }
  if (resolved.kind === "conflict")
    return json({ kind: "unavailable", reason: "invalid_request" }, 400);
  if (resolved.kind === "missing") {
    const response = json({ kind: "frames_missing", frameIds: resolved.frameIds }, 409);
    response.headers.set("X-Lookout-Frames", JSON.stringify(resolved.receipts));
    return response;
  }
  const result = await requestProviderAssessment(
    {
      observation: {
        ...input.observation,
        frames: resolved.frames.map((frame) => ({
          ...frame,
          image: new Blob([frame.image], { type: "image/jpeg" }),
        })),
      },
      condition: conditionText(rule.definition.condition),
    },
    env.OPENAI_API_KEY ?? "",
    request.signal,
    env.OPENAI_BASE_URL,
  );
  const response = json(result, result.kind === "unavailable" ? 503 : 200);
  response.headers.set("X-Lookout-Frames", JSON.stringify(resolved.receipts));
  return response;
}
