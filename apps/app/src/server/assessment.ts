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
  const result = await requestProviderAssessment(
    { observation: input.observation, condition: conditionText(rule.definition.condition) },
    env.OPENAI_API_KEY ?? "",
    request.signal,
    env.OPENAI_BASE_URL,
  );
  return json(result, result.kind === "unavailable" ? 503 : 200);
}
