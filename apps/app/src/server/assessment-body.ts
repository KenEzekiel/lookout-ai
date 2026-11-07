export async function readAssessmentJson(
  message: Request | Response,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
