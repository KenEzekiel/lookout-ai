import { z } from "zod";
import { request } from "./api";
import { createAssessmentClient, type AssessmentResult } from "./assessment";
import { type CaptureSession, type FrameSample } from "./capture-session";
import { captureSessionSchema, reportReceiptSchema } from "./incidents";
import {
  preserveIncidentEvidence,
  uploadIncidentEvidence,
  retryIncidentEvidence,
  type EvidenceUploadStatus,
} from "./incident-evidence";
import { type Rule } from "./rules";
import { type HealthReport } from "./device-health";

type EventWindow = {
  id: string;
  eventTime: number;
  from: number;
  to: number;
  frames: FrameSample[];
};
type AssessmentObservation = Extract<AssessmentResult, { kind: "assessment" }> & {
  receivedAt: number;
  latencyMs: number;
  frameCount: number;
  from: number;
  to: number;
};
type RuleState = {
  latestAssessment: AssessmentObservation | null;
  review: Extract<AssessmentResult, { kind: "review" }> | null;
  rule: Rule;
  lastFrame: string | null;
  clearSince: number | null;
  positiveSince: number | null;
  notice: string;
  assessment: HealthReport["assessment"];
  lastAssessmentAt: number | null;
  event:
    | { kind: "armed" }
    | { kind: "observing" | "candidate"; window: EventWindow }
    | {
        kind: "reporting";
        window: EventWindow;
        preserved: ReturnType<typeof preserveIncidentEvidence>;
      }
    | { kind: "held"; window: EventWindow };
};
export type MonitoringStatus = {
  sourceId: string;
  epoch: number;
  assessment: HealthReport["assessment"];
  lastAssessmentAt: number | null;
  appliedRules: HealthReport["appliedRules"];
  notice: string;
  rules: {
    id: string;
    name: string;
    version: number;
    notice: string;
    definition: Rule["definition"];
    latestAssessment: AssessmentObservation | null;
    review: RuleState["review"];
  }[];
  latest: {
    eventTime: number;
    from: number;
    to: number;
    incidentId: string;
    evidence: EvidenceUploadStatus;
  } | null;
};

export class DeviceMonitoring {
  private states: RuleState[] = [];
  private configured = false;
  private appliedRules: HealthReport["appliedRules"] = [];
  private delayed = false;
  private requestFailed = false;
  private disposed = false;
  private revision = 0;
  private abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private session: z.infer<typeof captureSessionSchema> | null = null;
  private assess = createAssessmentClient();
  private nextRule = 0;
  private nextReviewAt = 0;
  private latest: MonitoringStatus["latest"] = null;
  private notice = "Waiting for assigned rules.";

  constructor(
    private capture: CaptureSession,
    private sourceId: string,
    private epoch: number,
    private publish: (status: MonitoringStatus) => void,
  ) {
    this.timer = setTimeout(() => void this.tick(), 0);
  }

  configure(rules: Rule[] | null) {
    const enabled = rules?.filter((rule) => rule.sourceId === this.sourceId && rule.enabled);
    const unchanged =
      this.configured === (rules !== null) &&
      JSON.stringify(enabled?.map(({ id, version }) => [id, version])) ===
        JSON.stringify(this.states.map(({ rule }) => [rule.id, rule.version]));
    this.appliedRules =
      rules
        ?.filter((rule) => rule.sourceId === this.sourceId)
        .map(({ id, version }) => ({ id, version })) ?? [];
    if (unchanged) {
      this.emit();
      return;
    }
    this.invalidate();
    this.configured = rules !== null;
    this.requestFailed = false;
    for (const state of this.states) {
      state.positiveSince = null;
      state.clearSince = null;
    }
    if (enabled) {
      this.states = enabled.map(
        (rule) =>
          this.states.find(
            (state) => state.rule.id === rule.id && state.rule.version === rule.version,
          ) ?? {
            rule,
            latestAssessment: null,
            review: null,
            lastFrame: null,
            clearSince: null,
            positiveSince: null,
            notice: "Waiting for a fresh observation.",
            assessment: "unavailable",
            lastAssessmentAt: null,
            event: { kind: "armed" },
          },
      );
    }
    this.emit(
      rules === null
        ? "Monitoring degraded: configuration unavailable."
        : "Applying assigned rules.",
    );
  }

  captureChanged() {
    if (this.capture.getSnapshot().state !== "running") {
      this.invalidate();
      for (const state of this.states) {
        state.positiveSince = null;
        state.clearSince = null;
      }
      this.emit("Monitoring paused. Waiting for capture.");
    }
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
    clearTimeout(this.timer);
    if (this.session) this.endSession(this.session.id);
    this.states = [];
  }

  retryEvidence() {
    const latest = this.latest;
    if (latest?.evidence.kind !== "unavailable" || !latest.evidence.retryable) return;
    void retryIncidentEvidence(latest.incidentId, (status) =>
      this.evidenceChanged(latest.incidentId, status),
    );
  }

  private evidenceChanged(incidentId: string, evidence: EvidenceUploadStatus) {
    if (this.latest?.incidentId !== incidentId) return;
    this.latest = { ...this.latest, evidence };
    this.emit();
  }

  private invalidate() {
    this.revision += 1;
    this.abort.abort();
    this.abort = new AbortController();
  }

  private endSession(id: string) {
    void request(
      "/api/incidents/sessions/end",
      z.unknown(),
      { id },
      AbortSignal.timeout(8000),
    ).catch(() => {});
  }

  private current(revision: number) {
    const snapshot = this.capture.getSnapshot();
    return (
      !this.disposed &&
      this.configured &&
      revision === this.revision &&
      snapshot.state === "running" &&
      snapshot.epoch === this.epoch
    );
  }

  private emit(notice = this.notice) {
    this.notice = notice;
    if (!this.disposed)
      this.publish({
        sourceId: this.sourceId,
        epoch: this.epoch,
        notice,
        assessment:
          !this.configured || !this.states.length
            ? "unavailable"
            : this.delayed ||
                this.requestFailed ||
                this.states.some((state) => state.assessment === "degraded")
              ? "degraded"
              : this.states.every((state) => state.assessment === "ready")
                ? "ready"
                : "unavailable",
        lastAssessmentAt:
          this.states.length && this.states.every((state) => state.lastAssessmentAt !== null)
            ? Math.min(...this.states.map((state) => state.lastAssessmentAt ?? 0))
            : null,
        appliedRules: this.appliedRules,
        rules: this.states.map(({ rule, notice, latestAssessment, review }) => ({
          id: rule.id,
          name: rule.definition.name,
          version: rule.version,
          notice,
          definition: rule.definition,
          latestAssessment,
          review,
        })),
        latest: this.latest,
      });
  }

  private async tick() {
    const revision = this.revision;
    let slow: ReturnType<typeof setTimeout> | undefined;
    let assessing: RuleState | undefined;
    try {
      if (!this.current(revision)) return;
      if (this.states.length > 8) {
        this.requestFailed = true;
        this.emit(
          "Monitoring degraded: this device supports at most eight enabled rules per source.",
        );
        return;
      }
      if (!this.states.length) {
        this.emit("Not monitoring: no enabled rules for this source.");
        return;
      }
      if (this.session && this.session.expiresAt <= Date.now()) {
        this.requestFailed = true;
        this.emit("Monitoring degraded: session expired. Stop and restart capture.");
        return;
      }
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]);
      slow = setTimeout(() => {
        if (this.current(revision)) {
          this.delayed = true;
          this.emit(
            "Monitoring degraded: assessment is behind capture. New frames replace older pending frames.",
          );
        }
      }, 5000);
      if (!this.session) {
        this.emit("Starting monitoring session…");
        const session = await request(
          "/api/incidents/sessions",
          captureSessionSchema,
          { sourceId: this.sourceId },
          signal,
        );
        if (!this.current(revision)) {
          this.endSession(session.id);
          return;
        }
        this.session = session;
      }
      const state = this.states[this.nextRule++ % this.states.length];
      if (!state) return;
      assessing = state;
      if (state.event.kind === "reporting") {
        await this.report(state, signal, revision);
        return;
      }
      const captured = this.capture
        .getSamples()
        .filter(
          (frame, index, all) =>
            frame.epoch === this.epoch &&
            (all.at(-1)?.mediaTimeMs ?? frame.mediaTimeMs) - frame.mediaTimeMs <= 30_000 &&
            (!all[index - 1] || frame.mediaTimeMs > (all[index - 1]?.mediaTimeMs ?? -1)),
        );
      const continuous = captured.slice(
        captured.reduce(
          (start, frame, index) =>
            index > 0 &&
            frame.mediaTimeMs - (captured[index - 1]?.mediaTimeMs ?? frame.mediaTimeMs) > 5000
              ? index
              : start,
          0,
        ),
      );
      const previousEnd = state.event.kind === "observing" ? state.event.window.to : null;
      const window =
        previousEnd === null
          ? continuous.slice(-8)
          : continuous.filter((frame) => frame.mediaTimeMs >= previousEnd);
      const selected = new Set(
        Array.from({ length: 8 }, (_, index) => Math.round((index * (window.length - 1)) / 7)),
      );
      const samples = window.filter((_, index) => selected.has(index));
      const first = samples[0];
      const last = samples.at(-1);
      if (!first || !last || last.id === state.lastFrame) return;
      if (Date.now() - last.capturedAt > 5000) {
        this.emit("Monitoring degraded: waiting for fresh capture frames.");
        return;
      }
      if (state.event.kind === "candidate") {
        await this.review(state, samples, signal, revision);
        return;
      }
      state.lastFrame = last.id;
      this.emit("Assessing assigned rules…");
      const startedAt = Date.now();
      const result = await this.assess(
        {
          rule: { id: state.rule.id, version: state.rule.version },
          sourceId: this.sourceId,
          observation: {
            stage: "assessment",
            frames: samples.map(({ id, mediaTimeMs, image }) => ({ id, mediaTimeMs, image })),
          },
        },
        signal,
      );
      if (!this.current(revision)) return;
      if (result.kind !== "assessment") {
        state.assessment = "degraded";
        state.positiveSince = null;
        state.clearSince = null;
        state.notice = `Assessment unavailable: ${result.kind === "unavailable" ? result.reason : "invalid_result"}.`;
        this.emit("Monitoring degraded. Assessment will retry with fresh frames.");
        return;
      }
      state.latestAssessment = {
        ...result,
        receivedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        frameCount: samples.length,
        from: first.mediaTimeMs,
        to: last.mediaTimeMs,
      };
      state.assessment = "ready";
      state.lastAssessmentAt = Date.now();
      this.requestFailed = false;
      this.delayed = false;
      if (result.matchProbability >= 0.7) {
        state.clearSince = null;
        if (state.event.kind === "held") {
          state.notice = "Event still present. Initial alert will not repeat.";
        } else {
          if (
            state.event.kind === "observing" &&
            (state.positiveSince === null || first.mediaTimeMs - state.event.window.to > 5000)
          ) {
            state.event = { kind: "armed" };
            state.positiveSince = null;
          }
          if (state.event.kind === "armed") {
            state.review = null;
            state.event = {
              kind: "observing",
              window: {
                id: crypto.randomUUID(),
                eventTime: first.capturedAt,
                from: first.mediaTimeMs,
                to: last.mediaTimeMs,
                frames: samples,
              },
            };
          }
          state.event.window.frames = samples;
          state.event.window.to = last.mediaTimeMs;
          state.positiveSince ??= last.mediaTimeMs;
          const duration = (state.rule.definition.durationSeconds ?? 0) * 1000;
          if (last.mediaTimeMs - state.positiveSince >= duration) {
            state.positiveSince = null;
            state.event = { kind: "candidate", window: state.event.window };
            await this.review(state, samples, signal, revision);
            return;
          }
          state.notice = "Candidate observed. Checking the configured duration.";
        }
      } else if (result.matchProbability <= 0.2 && result.unclearProbability <= 0.3) {
        state.positiveSince = null;
        if (state.event.kind === "armed")
          state.notice = "Monitoring. No candidate in the latest observation.";
        else if (first.mediaTimeMs > state.event.window.to) {
          state.clearSince ??= last.mediaTimeMs;
          if (last.mediaTimeMs - state.clearSince >= 3000) {
            state.event = { kind: "armed" };
            state.review = null;
            state.clearSince = null;
            state.notice = "Scene cleared. Armed for a new event.";
          } else state.notice = "Checking that the scene stays clear before rearming.";
        } else state.notice = "Waiting for fresh evidence beyond the event window.";
      } else {
        state.positiveSince = null;
        state.clearSince = null;
        state.notice = "Observation uncertain. Gathering fresh evidence.";
      }
      this.emit("Monitoring assigned rules.");
    } catch {
      if (this.current(revision)) {
        this.requestFailed = true;
        if (assessing) assessing.assessment = "degraded";
        for (const state of this.states) {
          state.positiveSince = null;
          state.clearSince = null;
        }
        this.emit(
          "Monitoring degraded: request unavailable. Retrying without creating another event.",
        );
      }
    } finally {
      clearTimeout(slow);
      this.delayed = false;
      this.emit();
      if (!this.disposed) this.timer = setTimeout(() => void this.tick(), 1500);
    }
  }

  private async review(
    state: RuleState,
    samples: FrameSample[],
    signal: AbortSignal,
    revision: number,
  ) {
    if (state.event.kind !== "candidate") return;
    if (Date.now() < this.nextReviewAt) {
      state.notice = "Candidate waiting for the review limit. Gathering fresh evidence.";
      this.emit("Candidate awaiting review.");
      return;
    }
    const window = state.event.window;
    const combined = [
      ...window.frames,
      ...samples.filter((frame) => frame.mediaTimeMs > (window.frames.at(-1)?.mediaTimeMs ?? -1)),
    ];
    const frames =
      combined.length <= 8 ? combined : [...combined.slice(0, 4), ...combined.slice(-4)];
    const latest = frames.at(-1);
    const first = frames[0];
    if (!first || !latest) return;
    if (latest.mediaTimeMs - first.mediaTimeMs > 30_000) {
      state.event = { kind: "held", window };
      state.notice = "Review inconclusive: evidence window expired. Waiting for scene clear.";
      state.assessment = "degraded";
      this.emit("Monitoring degraded: candidate could not be confirmed.");
      return;
    }
    window.frames = frames;
    window.to = latest.mediaTimeMs;
    state.lastFrame = latest.id;
    this.nextReviewAt = Date.now() + 12_000;
    state.notice = "Reviewing candidate…";
    this.emit("Candidate awaiting second-stage review.");
    const result = await this.assess(
      {
        rule: { id: state.rule.id, version: state.rule.version },
        sourceId: this.sourceId,
        observation: {
          stage: "review",
          frames: frames.map(({ id, mediaTimeMs, image }) => ({ id, mediaTimeMs, image })),
        },
      },
      signal,
    );
    if (!this.current(revision)) return;
    if (result.kind === "review") state.review = result;
    if (result.kind !== "review") {
      state.assessment = "degraded";
      state.notice = `Review unavailable: ${result.kind === "unavailable" ? result.reason : "invalid_result"}. Candidate retained.`;
      this.emit("Monitoring degraded. Candidate review will retry.");
    } else {
      state.assessment = "ready";
      state.lastAssessmentAt = Date.now();
      this.requestFailed = false;
      this.delayed = false;
      if (result.outcome === "positive") {
        state.event = {
          kind: "reporting",
          window,
          preserved: preserveIncidentEvidence(this.capture, {
            epoch: this.epoch,
            sourceTimeMs:
              this.capture.getSnapshot().source === "camera" ? window.eventTime : window.from,
          }),
        };
        state.notice = "Candidate confirmed. Reporting incident…";
        this.emit();
        await this.report(state, signal, revision);
      } else if (result.outcome === "rejected") {
        state.event = { kind: "held", window };
        state.notice = `Candidate rejected. ${result.explanation}`;
        this.emit("Monitoring. Rejected candidate will not alert; waiting for scene clear.");
      } else {
        state.notice = `More evidence needed. ${result.explanation}`;
        this.emit("Candidate retained. Waiting for fresh evidence before another review.");
      }
    }
  }

  private async report(state: RuleState, signal: AbortSignal, revision: number) {
    if (state.event.kind !== "reporting" || !this.session) return;
    const { window, preserved } = state.event;
    const report = {
      sessionId: this.session.id,
      eventId: window.id,
      ruleId: state.rule.id,
      ruleVersion: state.rule.version,
      eventTime: window.eventTime,
    };
    const { incident } = await request(
      "/api/incidents/reports",
      reportReceiptSchema,
      report,
      signal,
    );
    void uploadIncidentEvidence(preserved, incident.id, report, (status) =>
      this.evidenceChanged(incident.id, status),
    );
    if (!this.current(revision)) return;
    state.event = { kind: "held", window };
    state.notice = "Incident reported. Waiting for scene clear before rearming.";
    this.latest = {
      eventTime: window.eventTime,
      from: window.from,
      to: window.to,
      incidentId: incident.id,
      evidence: { kind: "preparing" },
    };
    this.emit("Incident reported. Monitoring continues without repeating the initial alert.");
  }
}
