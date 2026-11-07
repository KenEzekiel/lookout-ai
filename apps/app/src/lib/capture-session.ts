export type CaptureState = "idle" | "starting" | "running" | "paused" | "stopped" | "error";
export type CaptureSource = "camera" | "file" | null;
export type CaptureIdentity = { deviceId: string; workspaceId: string };

export type FrameSample = CaptureIdentity & {
  id: string;
  epoch: number;
  capturedAt: number;
  mediaTimeMs: number;
  image: Blob;
};

export type RecentVideo =
  | (CaptureIdentity & {
      kind: "camera";
      epoch: number;
      from: number;
      to: number;
      segments: readonly RecordedSegment[];
    })
  | (CaptureIdentity & { kind: "file"; epoch: number; from: number; to: number; file: File })
  | null;

export type CaptureSnapshot = {
  state: CaptureState;
  source: CaptureSource;
  epoch: number;
  sampleCount: number;
  lastSampleAt: number | null;
  bufferedSeconds: number;
  error: string | null;
};

export type RecordedSegment = { from: number; to: number; blob: Blob };
export type EventInterval = { epoch: number; sourceTimeMs: number };
export type PreservedEvent =
  | (CaptureIdentity & {
      kind: "file";
      epoch: number;
      eventTimeMs: number;
      from: number;
      to: number;
      file: File;
    })
  | (CaptureIdentity & {
      kind: "camera";
      epoch: number;
      eventTimeMs: number;
      from: number;
      to: number;
      segments: readonly RecordedSegment[];
    });

type PendingEvent = {
  epoch: number;
  eventTimeMs: number;
  from: number;
  to: number;
  segments: Map<number, RecordedSegment>;
  resolve: (event: PreservedEvent) => void;
};

const bufferMs = 30_000;
const segmentMs = 5_000;
const maxBufferBytes = 24 * 1024 * 1024;
const maxSamples = 30;
const eventLeadInMs = 10_000;
const eventAftermathMs = 10_000;

export const initialCaptureSnapshot: CaptureSnapshot = {
  state: "idle",
  source: null,
  epoch: 0,
  sampleCount: 0,
  lastSampleAt: null,
  bufferedSeconds: 0,
  error: null,
};

export class CaptureSession {
  private state: CaptureState = "idle";
  private source: CaptureSource = null;
  private epoch = 0;
  private generation = 0;
  private error: string | null = null;
  private file: File | null = null;
  private fileUrl: string | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private sampleTimer: number | null = null;
  private segmentTimer: number | null = null;
  private samples: FrameSample[] = [];
  private segments: RecordedSegment[] = [];
  private activeChunks: Blob[] = [];
  private segmentStartedAt = 0;
  private pendingEvents = new Set<PendingEvent>();
  private canvas = document.createElement("canvas");

  constructor(
    private video: HTMLVideoElement,
    private onChange: (snapshot: CaptureSnapshot) => void,
    private identity: CaptureIdentity,
  ) {
    video.addEventListener("seeking", this.onSeek);
    video.addEventListener("ended", this.onEnd);
    video.addEventListener("pause", this.onPause);
    video.addEventListener("play", this.onPlay);
    video.addEventListener("error", this.onVideoError);
  }

  getSnapshot(): CaptureSnapshot {
    const now = Date.now();
    const cameraFrom =
      this.segments[0]?.from ?? (this.activeChunks.length ? this.segmentStartedAt : now);
    const cameraTo = this.activeChunks.length ? now : (this.segments.at(-1)?.to ?? now);
    const fileTime = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
    const bufferedSeconds =
      this.state !== "running"
        ? 0
        : this.source === "file"
          ? Math.min(fileTime, bufferMs / 1000)
          : Math.min((cameraTo - cameraFrom) / 1000, bufferMs / 1000);

    return {
      state: this.state,
      source: this.source,
      epoch: this.epoch,
      sampleCount: this.samples.length,
      lastSampleAt: this.samples.at(-1)?.capturedAt ?? null,
      bufferedSeconds: Math.max(0, bufferedSeconds),
      error: this.error,
    };
  }

  getSamples(): readonly FrameSample[] {
    return this.samples;
  }

  getRecentVideo(): RecentVideo {
    if (this.state !== "running") return null;
    if (this.source === "file" && this.file) {
      const to = this.video.currentTime * 1000;
      return {
        ...this.identity,
        kind: "file",
        epoch: this.epoch,
        from: Math.max(0, to - bufferMs),
        to,
        file: this.file,
      };
    }
    if (this.source === "camera") {
      const segments = [...this.segments];
      if (this.activeChunks.length) {
        segments.push({
          from: this.segmentStartedAt,
          to: Date.now(),
          blob: new Blob(this.activeChunks, { type: this.recorder?.mimeType || "video/webm" }),
        });
      }
      const first = segments[0];
      if (!first) return null;
      return {
        ...this.identity,
        kind: "camera",
        epoch: this.epoch,
        from: first.from,
        to: segments.at(-1)?.to ?? Date.now(),
        segments,
      };
    }
    return null;
  }

  preserveEventInterval({ epoch, sourceTimeMs }: EventInterval): Promise<PreservedEvent> {
    if (this.state !== "running" || epoch !== this.epoch) {
      return Promise.reject(new Error("This event belongs to an inactive capture run."));
    }
    if (!Number.isFinite(sourceTimeMs) || sourceTimeMs < 0) {
      return Promise.reject(new Error("The event time is invalid."));
    }
    if (this.source === "file" && this.file) {
      const durationMs = this.video.duration * 1000;
      const to = Number.isFinite(durationMs)
        ? Math.min(durationMs, sourceTimeMs + eventAftermathMs)
        : sourceTimeMs + eventAftermathMs;
      if (to <= sourceTimeMs) {
        return Promise.reject(new Error("The event is outside the selected video."));
      }
      return Promise.resolve({
        ...this.identity,
        kind: "file",
        epoch,
        eventTimeMs: sourceTimeMs,
        from: Math.max(0, sourceTimeMs - eventLeadInMs),
        to,
        file: this.file,
      });
    }
    if (this.source !== "camera") {
      return Promise.reject(new Error("No source footage is available for this event."));
    }
    return new Promise((resolve) => {
      const pending: PendingEvent = {
        epoch,
        eventTimeMs: sourceTimeMs,
        from: sourceTimeMs - eventLeadInMs,
        to: sourceTimeMs + eventAftermathMs,
        segments: new Map(),
        resolve,
      };
      this.pendingEvents.add(pending);
      this.updatePendingEvents();
    });
  }

  getPeerStream(): MediaStream | null {
    if (this.state !== "running") return null;
    if (this.stream) return this.stream.clone();
    if ("captureStream" in this.video && typeof this.video.captureStream === "function") {
      const captured: unknown = this.video.captureStream();
      return captured instanceof MediaStream ? captured : null;
    }
    return null;
  }

  async startCamera() {
    this.stop();
    const generation = this.generation;
    this.begin("camera");

    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera access is not available in this browser.");
      if (typeof MediaRecorder === "undefined")
        throw new Error("This browser cannot keep a recent camera buffer.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", this.onTrackEnd);
      this.video.srcObject = stream;
      this.video.muted = true;
      await this.video.play();
      if (generation !== this.generation) return;
      this.startRecorder(generation);
      this.runSampler(generation);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  async startFile(file: File) {
    this.stop();
    const generation = this.generation;
    this.begin("file");
    this.file = file;

    try {
      this.fileUrl = URL.createObjectURL(file);
      this.video.src = this.fileUrl;
      this.video.muted = true;
      this.video.load();
      await this.video.play();
      if (generation !== this.generation) return;
      this.runSampler(generation);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  stop() {
    this.updatePendingEvents(true);
    this.generation += 1;
    this.state = "stopped";
    this.release();
    this.error = null;
    this.publish();
  }

  dispose() {
    this.stop();
    this.video.removeEventListener("seeking", this.onSeek);
    this.video.removeEventListener("ended", this.onEnd);
    this.video.removeEventListener("pause", this.onPause);
    this.video.removeEventListener("play", this.onPlay);
    this.video.removeEventListener("error", this.onVideoError);
  }

  private begin(source: Exclude<CaptureSource, null>) {
    this.epoch += 1;
    this.source = source;
    this.state = "starting";
    this.error = null;
    this.publish();
  }

  private runSampler(generation: number) {
    this.state = "running";
    this.sampleTimer = window.setInterval(() => this.sampleFrame(generation), 1000);
    this.sampleFrame(generation);
    this.publish();
  }

  private sampleFrame(generation: number) {
    if (generation !== this.generation || this.state !== "running") return;
    if (this.video.videoWidth === 0 || this.video.videoHeight === 0) return;
    const width = Math.min(this.video.videoWidth, 640);
    this.canvas.width = width;
    this.canvas.height = Math.round((width * this.video.videoHeight) / this.video.videoWidth);
    const context = this.canvas.getContext("2d");
    if (!context) return;

    try {
      context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const bytes = Uint8Array.from(
        atob(this.canvas.toDataURL("image/jpeg", 0.7).split(",")[1] ?? ""),
        (character) => character.charCodeAt(0),
      );
      this.samples.push({
        id: crypto.randomUUID(),
        ...this.identity,
        epoch: this.epoch,
        capturedAt: Date.now(),
        mediaTimeMs: this.video.currentTime * 1000,
        image: new Blob([bytes], { type: "image/jpeg" }),
      });
      if (this.samples.length > maxSamples) this.samples.shift();
      this.publish();
    } catch {
      this.fail(new Error("This source cannot be sampled. Choose a local video or camera."));
    }
  }

  private startRecorder(generation: number) {
    if (!this.stream) return;
    const recorder = new MediaRecorder(this.stream);
    this.recorder = recorder;
    this.segmentStartedAt = Date.now();
    this.activeChunks = [];
    recorder.ondataavailable = (event) => {
      if (generation !== this.generation || event.data.size === 0) return;
      this.activeChunks.push(event.data);
      this.publish();
    };
    recorder.onerror = () => this.fail(new Error("Camera recording stopped. Restart capture."));
    recorder.onstop = () => {
      if (generation !== this.generation) return;
      if (this.segmentTimer !== null) window.clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
      if (this.activeChunks.length) {
        const segment = {
          from: this.segmentStartedAt,
          to: Date.now(),
          blob: new Blob(this.activeChunks, { type: recorder.mimeType || "video/webm" }),
        };
        this.segments.push(segment);
        this.rememberSegmentForPending(segment);
        this.trimSegments();
      }
      this.activeChunks = [];
      this.publish();
      if (this.state === "running") {
        try {
          this.startRecorder(generation);
        } catch (error) {
          this.fail(error);
        }
      }
    };
    recorder.start(1000);
    this.segmentTimer = window.setTimeout(() => {
      if (generation === this.generation && recorder.state === "recording") recorder.stop();
    }, segmentMs);
  }

  private trimSegments() {
    const cutoff = Date.now() - bufferMs;
    let bytes = this.segments.reduce((total, segment) => total + segment.blob.size, 0);
    while (this.segments[0] && (this.segments[0].to < cutoff || bytes > maxBufferBytes)) {
      bytes -= this.segments.shift()?.blob.size ?? 0;
    }
  }

  private fail(error: unknown) {
    this.updatePendingEvents(true);
    this.state = "error";
    this.release();
    this.error = this.errorMessage(error);
    this.publish();
  }

  private errorMessage(error: unknown) {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        return "Camera permission was denied. Allow access in your browser, then try again.";
      }
      if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        return "No camera was found. Connect a camera or choose a local video.";
      }
    }
    return error instanceof Error ? error.message : "The source could not start. Try again.";
  }

  private release() {
    if (this.sampleTimer !== null) window.clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    if (this.segmentTimer !== null) window.clearTimeout(this.segmentTimer);
    this.segmentTimer = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstop = null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
    }
    this.recorder = null;
    this.stream?.getVideoTracks()[0]?.removeEventListener("ended", this.onTrackEnd);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    this.video.load();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
    this.file = null;
    this.samples = [];
    this.segments = [];
    this.activeChunks = [];
    this.segmentStartedAt = 0;
  }

  private publish() {
    this.onChange(this.getSnapshot());
    this.updatePendingEvents();
  }

  private updatePendingEvents(force = false) {
    if (this.pendingEvents.size === 0) return;
    const recent = this.getRecentVideo();
    if (recent?.kind === "camera") {
      for (const segment of recent.segments) this.rememberSegmentForPending(segment);
    }
    for (const pending of this.pendingEvents) {
      const complete = this.segments.some((segment) => segment.to >= pending.to);
      if (!force && !complete) continue;
      const segments = [...pending.segments.values()].sort((a, b) => a.from - b.from);
      const first = segments[0];
      const last = segments.at(-1);
      pending.resolve({
        ...this.identity,
        kind: "camera",
        epoch: pending.epoch,
        eventTimeMs: pending.eventTimeMs,
        from: Math.max(pending.from, first?.from ?? pending.from),
        to: Math.min(pending.to, last?.to ?? pending.to),
        segments,
      });
      this.pendingEvents.delete(pending);
    }
  }

  private rememberSegmentForPending(segment: RecordedSegment) {
    for (const pending of this.pendingEvents) {
      if (segment.to <= pending.from || segment.from >= pending.to) continue;
      const earlier = pending.segments.get(segment.from);
      if (!earlier || earlier.to < segment.to) pending.segments.set(segment.from, segment);
    }
  }

  private onSeek = () => {
    if (this.source !== "file" || (this.state !== "running" && this.state !== "paused")) return;
    this.epoch += 1;
    this.samples = [];
    this.publish();
  };

  private onEnd = () => {
    if (this.state === "running" || this.state === "paused") this.stop();
  };

  private onPause = () => {
    if (this.source !== "file" || this.state !== "running") return;
    this.state = "paused";
    this.publish();
  };

  private onPlay = () => {
    if (this.source !== "file" || this.state !== "paused") return;
    this.state = "running";
    this.publish();
  };

  private onTrackEnd = () => {
    if (this.state === "running") {
      this.fail(new Error("Camera disconnected. Reconnect it, then start again."));
    }
  };

  private onVideoError = () => {
    if (this.state === "running" || this.state === "paused") {
      this.fail(new Error("Video playback stopped. Choose a playable local file and try again."));
    }
  };
}
