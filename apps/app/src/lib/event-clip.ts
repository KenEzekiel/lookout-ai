import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";
import type { PreservedEvent, RecordedSegment } from "./capture-session";

export type EventClip = {
  blob: Blob;
  from: number;
  to: number;
  durationMs: number;
  eventOffsetMs: number;
};

const maxClipBytes = 32 * 1024 * 1024;

export async function buildEventClip(event: PreservedEvent): Promise<EventClip> {
  if (event.from >= event.to || event.eventTimeMs < event.from || event.eventTimeMs > event.to) {
    throw new Error("The event itself is no longer available in the source footage.");
  }
  const blob =
    event.kind === "file"
      ? await buildFileClip(event.file, event.from, event.to)
      : await buildCameraClip(event.segments, event.from, event.to);
  if (blob.size === 0 || blob.size > maxClipBytes) {
    throw new Error("The event clip could not be prepared within the upload size limit.");
  }
  const durationMs = await verifyPlayableClip(blob);
  return {
    blob,
    from: event.from,
    to: event.to,
    durationMs,
    eventOffsetMs: Math.min(durationMs, event.eventTimeMs - event.from),
  };
}

async function verifyPlayableClip(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The event clip could not be opened.")),
        5000,
      );
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("The event clip cannot be played in this browser."));
      };
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.seekable.length === 0) {
      throw new Error("The event clip is not seekable.");
    }
    if (video.duration > 0.5) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("The event clip cannot seek.")),
          5000,
        );
        video.onseeked = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("The event clip cannot seek."));
        };
        video.currentTime = Math.min(0.5, video.duration / 2);
      });
    }
    return video.duration * 1000;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function buildFileClip(file: File, from: number, to: number): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { codec: "avc", width: 1280, quality: new Quality("medium") },
      audio: { discard: true },
      trim: { start: from / 1000, end: to / 1000 },
    });
    if (!conversion.isValid) throw new Error("This video cannot be converted for replay.");
    await conversion.execute();
    if (!target.buffer) throw new Error("The event clip has no video.");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

async function buildCameraClip(
  segments: readonly RecordedSegment[],
  from: number,
  to: number,
): Promise<Blob> {
  if (segments.length === 0) throw new Error("No camera footage remains for this event.");
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new VideoSampleSource({
    codec: "avc",
    quality: new Quality("medium"),
    keyFrameInterval: 2,
    transform: { width: 1280 },
  });
  output.addVideoTrack(source);
  await output.start();
  let frames = 0;
  try {
    for (const segment of segments) {
      if (segment.to <= from || segment.from >= to) continue;
      const input = new Input({ source: new BlobSource(segment.blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) continue;
        const sink = new VideoSampleSink(track);
        const localStart = Math.max(0, (from - segment.from) / 1000);
        const localEnd = Math.min((segment.to - segment.from) / 1000, (to - segment.from) / 1000);
        for await (const sample of sink.samples(localStart, localEnd)) {
          const outputTime = (segment.from - from) / 1000 + sample.timestamp;
          if (outputTime < 0 || outputTime >= (to - from) / 1000) {
            sample.close();
            continue;
          }
          sample.setTimestamp(outputTime);
          await source.add(sample);
          sample.close();
          frames += 1;
        }
      } finally {
        input.dispose();
      }
    }
    if (frames === 0) throw new Error("No playable camera frames remain for this event.");
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  }
  if (!target.buffer) throw new Error("The event clip has no video.");
  return new Blob([target.buffer], { type: "video/mp4" });
}
