import { assessmentLimits, assessmentMetadataSchema, uploadRequestSchema } from "../lib/assessment";

async function readAssessmentBody(
  message: Request | Response,
  maximum: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (message instanceof Response && Number(message.headers.get("content-length")) > maximum) {
    await message.body?.cancel();
    throw new RangeError("Body too large.");
  }
  const reader = message.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body.");
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        if (message instanceof Response) {
          await reader.cancel();
          throw new RangeError("Body too large.");
        }
        continue;
      }
      chunks.push(value);
    }
    if (bytes > maximum) throw new RangeError("Body too large.");
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function readAssessmentJson(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
  const body = await readAssessmentBody(response, maximum, signal);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

export async function readAssessmentRequest(request: Request, signal: AbortSignal) {
  const body = await readAssessmentBody(request, assessmentLimits.requestBytes, signal);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType))
    throw new SyntaxError("Expected multipart images.");
  const form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  signal.throwIfAborted();
  const metadata = form.getAll("metadata");
  if (metadata.length !== 1 || typeof metadata[0] !== "string")
    throw new SyntaxError("Invalid metadata.");
  const input = assessmentMetadataSchema.parse(JSON.parse(metadata[0]));
  const expected = new Set([
    "metadata",
    ...input.observation.frames.map((_, index) => `frame-${index}`),
  ]);
  for (const key of form.keys()) {
    if (!expected.has(key) || form.getAll(key).length !== 1)
      throw new SyntaxError("Unexpected image part.");
  }
  return uploadRequestSchema.parse({
    ...input,
    observation: {
      ...input.observation,
      frames: input.observation.frames.map((frame, index) => ({
        ...frame,
        image: form.get(`frame-${index}`) ?? undefined,
      })),
    },
  });
}
