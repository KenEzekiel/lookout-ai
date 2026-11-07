import { DurableObject } from "cloudflare:workers";
import { assessmentLimits, type AssessmentRequest } from "../lib/assessment";

type Frame = Omit<AssessmentRequest["observation"]["frames"][number], "image"> & {
  image?: ArrayBuffer;
};
type Entry = Frame & { image: ArrayBuffer; deviceId: string; expiresAt: number };

export class FrameCache extends DurableObject {
  #frames = new Map<string, Entry>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  #expire() {
    const now = Date.now();
    for (const [key, frame] of this.#frames) {
      if (frame.expiresAt <= now) this.#frames.delete(key);
    }
    clearTimeout(this.#timer);
    const next = Math.min(...[...this.#frames.values()].map((frame) => frame.expiresAt));
    this.#timer = Number.isFinite(next)
      ? setTimeout(() => this.#expire(), Math.max(1, next - now))
      : undefined;
  }

  resolve(input: { deviceId: string; sourceId: string; frames: Frame[] }) {
    this.#expire();
    const keyFor = (id: string) => JSON.stringify([input.deviceId, input.sourceId, id]);
    for (const frame of input.frames) {
      const existing = this.#frames.get(keyFor(frame.id));
      if (!existing) continue;
      if (existing.mediaTimeMs !== frame.mediaTimeMs) return { kind: "conflict" } as const;
      if (frame.image) {
        const previous = new Uint8Array(existing.image);
        const incoming = new Uint8Array(frame.image);
        if (
          incoming.length !== previous.length ||
          !incoming.every((byte, index) => byte === previous[index])
        )
          return { kind: "conflict" } as const;
      }
    }
    for (const frame of input.frames) {
      const key = keyFor(frame.id);
      if (frame.image && !this.#frames.has(key)) {
        this.#frames.set(key, {
          ...frame,
          image: frame.image,
          deviceId: input.deviceId,
          expiresAt: Date.now() + assessmentLimits.cacheTtlMs,
        });
      }
    }
    const protectedKeys = new Set(input.frames.map((frame) => keyFor(frame.id)));
    for (const scope of [input.deviceId, undefined]) {
      const entries = [...this.#frames].filter(
        ([, frame]) => scope === undefined || frame.deviceId === scope,
      );
      let bytes = entries.reduce((sum, [, frame]) => sum + frame.image.byteLength, 0);
      let count = entries.length;
      for (const [key, frame] of entries) {
        if (
          bytes <=
            (scope === undefined
              ? assessmentLimits.workspaceCacheBytes
              : assessmentLimits.deviceCacheBytes) &&
          count <=
            (scope === undefined
              ? assessmentLimits.workspaceCacheFrames
              : assessmentLimits.deviceCacheFrames)
        )
          break;
        if (protectedKeys.has(key)) continue;
        this.#frames.delete(key);
        bytes -= frame.image.byteLength;
        count -= 1;
      }
    }
    this.#expire();
    const frames = input.frames.map((frame) => this.#frames.get(keyFor(frame.id)));
    const missing = input.frames.filter((_, index) => !frames[index]).map((frame) => frame.id);
    const present = frames.filter((frame): frame is Entry => frame !== undefined);
    const receipts = present.map(({ id, expiresAt }) => ({ id, expiresAt }));
    if (missing.length) return { kind: "missing", frameIds: missing, receipts } as const;
    return {
      kind: "ready",
      frames: present.map(({ id, mediaTimeMs, image }) => ({ id, mediaTimeMs, image })),
      receipts,
    } as const;
  }
}
