import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { type Incoming, incomingSchema } from "../session/domain.js";

export const testNow = 1_900_000_000_000;
let sequence = 0;
export function input(text = "Inspect the project", overrides: Partial<Incoming> = {}): Incoming {
  sequence++;
  const ts = `${Math.floor(testNow / 1000)}.${sequence.toString().padStart(6, "0")}`;
  return incomingSchema.parse({
    address: { channel: "CTEST1", rootTs: ts },
    ts,
    actor: "UACTOR1",
    text,
    route: "direct",
    ...overrides,
  });
}

export async function directory(t: TestContext): Promise<string> {
  const root = join(dirname(dirname(fileURLToPath(import.meta.url))), ".local");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error("not_initialized");
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
