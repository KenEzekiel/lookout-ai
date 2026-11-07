import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { LoadingStatus } from "@/components/ui/loading";
import { request } from "@/lib/api";
import { type CaptureSession, type CaptureSnapshot } from "@/lib/capture-session";
import { DeviceMonitoring, type MonitoringStatus } from "@/lib/device-monitoring";
import { conditionText, deviceConfigurationSchema, type DeviceConfiguration } from "@/lib/rules";
import { HealthReporting } from "@/components/device-health-reporting";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function MonitoringControls({
  session,
  snapshot,
  onController,
}: {
  session: RefObject<CaptureSession | null>;
  snapshot: CaptureSnapshot;
  onController: (controller: DeviceMonitoring | null) => void;
}) {
  const controller = useRef<DeviceMonitoring | null>(null);
  const [configuration, setConfiguration] = useState<DeviceConfiguration | null>(null);
  const [configurationNotice, setConfigurationNotice] = useState("Loading assigned sources…");
  const [sourceId, setSourceId] = useState("");
  const [monitoringStatus, setStatus] = useState<MonitoringStatus | null>(null);
  const status =
    monitoringStatus?.sourceId === sourceId && monitoringStatus.epoch === snapshot.epoch
      ? monitoringStatus
      : null;
  const configurationRef = useRef(configuration);
  const [configurationAvailable, setConfigurationAvailable] = useState(false);
  const [reload, setReload] = useState(0);
  const active = snapshot.state === "running" || snapshot.state === "paused";
  const source = configuration?.sources.find((source) => source.id === sourceId);
  const compatible = source?.kind === (snapshot.source === "file" ? "replay" : "camera");

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function load() {
      try {
        const next = await request(
          "/api/config/device",
          deviceConfigurationSchema,
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
        );
        if (disposed) return;
        configurationRef.current = next;
        setConfigurationAvailable(true);
        controller.current?.configure(next.rules);
        setConfiguration(next);
        setConfigurationNotice("Assigned configuration is current.");
      } catch {
        if (disposed) return;
        configurationRef.current = null;
        setConfigurationAvailable(false);
        controller.current?.configure(null);
        setConfigurationNotice("Monitoring degraded: configuration unavailable. Retrying…");
      } finally {
        if (!disposed) timer = setTimeout(load, 5000);
      }
    }
    void load();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [controller, reload]);

  useEffect(() => {
    const capture = session.current;
    if (!active || !compatible || !sourceId || !capture) {
      return;
    }
    const monitoring = new DeviceMonitoring(capture, sourceId, snapshot.epoch, setStatus);
    controller.current = monitoring;
    onController(monitoring);
    monitoring.configure(configurationRef.current?.rules ?? null);
    return () => {
      monitoring.dispose();
      controller.current = null;
      onController(null);
    };
  }, [active, compatible, onController, session, snapshot.epoch, sourceId]);

  return (
    <section aria-label="AI monitoring">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Live AI assessment</h2>
        <Badge variant="secondary">
          {snapshot.state === "paused"
            ? "Assessment paused"
            : active
              ? "Capture active"
              : "Standby"}
        </Badge>
      </div>
      <label htmlFor="assigned-source" className="text-xs text-muted-foreground">
        Assigned source
      </label>
      <Select
        value={sourceId}
        items={Object.fromEntries(
          configuration?.sources.map((source) => [source.id, source.name]) ?? [],
        )}
        onValueChange={(value) => {
          session.current?.stop();
          setSourceId(value ?? "");
        }}
      >
        <SelectTrigger id="assigned-source" className="mt-2 w-full">
          <SelectValue placeholder="Choose an assigned source" />
        </SelectTrigger>
        <SelectContent>
          {configuration?.sources.map((source) => (
            <SelectItem key={source.id} value={source.id}>
              {source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-2 text-xs text-muted-foreground">{configurationNotice}</p>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="mt-2 px-0 text-xs"
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh assigned rules
      </Button>
      {configuration?.sources.length === 0 && (
        <p className="mt-2 text-xs">
          An operator must create a source and assign an enabled trigger.
        </p>
      )}
      <output className="mt-3 block text-sm" aria-live="polite">
        {!active
          ? "AI monitoring stopped."
          : !sourceId
            ? "Preview only. Choose an assigned source to monitor."
            : !compatible
              ? `Preview only. This source requires ${source?.kind === "replay" ? "a local video" : "a camera"}.`
              : snapshot.state === "paused"
                ? "AI monitoring paused with playback."
                : (status?.notice ?? "Preparing AI monitoring…")}
      </output>
      <ul className="mt-4 space-y-4">
        {active &&
          compatible &&
          status?.rules.map((rule) => (
            <li
              key={rule.id}
              className="min-w-0 rounded-xl border border-border bg-background/50 p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="break-words text-sm font-semibold">
                  {rule.name} · v{rule.version}
                </h3>
                <Badge variant="secondary">{rule.definition.severity}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-line break-words leading-relaxed text-muted-foreground">
                {conditionText(rule.definition.condition)}
              </p>
              <p className="mt-3 font-medium">{rule.notice}</p>
              {rule.latestAssessment ? (
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-primary/10 p-2">
                      <dt className="text-muted-foreground">Match probability</dt>
                      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl text-primary">
                        {(rule.latestAssessment.matchProbability * 100).toFixed(1)}%
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted p-2">
                      <dt className="text-muted-foreground">Uncertainty</dt>
                      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                        {(rule.latestAssessment.unclearProbability * 100).toFixed(1)}%
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-muted-foreground">
                    Latest completed assessment. AI estimates, not confirmation.
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 tabular-nums">
                    <div>
                      <dt className="text-muted-foreground">Result received</dt>
                      <dd>{new Date(rule.latestAssessment.receivedAt).toLocaleTimeString()}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Assessment time</dt>
                      <dd>{(rule.latestAssessment.latencyMs / 1000).toFixed(1)}s</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Frames assessed</dt>
                      <dd>{rule.latestAssessment.frameCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source interval</dt>
                      <dd>
                        {(rule.latestAssessment.from / 1000).toFixed(1)}–
                        {(rule.latestAssessment.to / 1000).toFixed(1)}s
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="mt-3 text-muted-foreground">
                  Waiting for the first assessment. Percentages appear after AI responds.
                </p>
              )}
              <p className="mt-3 text-muted-foreground">
                Review threshold 70% ·{" "}
                {rule.definition.durationSeconds
                  ? `${rule.definition.durationSeconds}s sustained match required`
                  : "No duration requirement"}
              </p>
              {rule.review && (
                <div className="mt-3 rounded-lg bg-surface-raised p-3">
                  <strong>
                    Latest review ·{" "}
                    {rule.review.outcome === "positive"
                      ? "Confirmed"
                      : rule.review.outcome === "rejected"
                        ? "Rejected"
                        : "Needs evidence"}
                  </strong>
                  <p className="mt-1 break-words leading-relaxed">{rule.review.explanation}</p>
                </div>
              )}
            </li>
          ))}
      </ul>
      {active && compatible && status?.latest && (
        <div className="mt-4 rounded-lg bg-incident/10 p-3 text-xs">
          <strong>Latest incident reported</strong>
          <p className="mt-1">
            Approximate event time: {new Date(status.latest.eventTime).toLocaleTimeString()}
          </p>
          <p>
            Source interval: {(status.latest.from / 1000).toFixed(1)}–
            {(status.latest.to / 1000).toFixed(1)}s
          </p>
          {status.latest.evidence.kind === "preparing" ||
          status.latest.evidence.kind === "uploading" ? (
            <LoadingStatus
              label={
                status.latest.evidence.kind === "preparing"
                  ? "Preparing incident video…"
                  : "Uploading incident video…"
              }
            />
          ) : status.latest.evidence.kind === "ready" ? (
            <output>Incident video ready for replay.</output>
          ) : (
            <div>
              <output>Incident video unavailable. {status.latest.evidence.reason}</output>
              {status.latest.evidence.retryable && (
                <Button className="mt-2" onClick={() => controller.current?.retryEvidence()}>
                  Retry video upload
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Monitoring sends sampled frames for remote AI assessment. Capture must remain open and
        visible.
      </p>
      <HealthReporting
        report={{
          sourceId: sourceId || null,
          capture: snapshot.state,
          lastObservationAt: snapshot.lastSampleAt,
          assessment: active && compatible ? (status?.assessment ?? "unavailable") : "unavailable",
          lastAssessmentAt: status?.lastAssessmentAt ?? null,
          configurationAvailable,
          appliedRules: status?.appliedRules ?? [],
        }}
      />
    </section>
  );
}
