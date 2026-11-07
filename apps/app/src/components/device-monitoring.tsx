import { useEffect, useRef, useState, type RefObject } from "react";
import { request } from "@/lib/api";
import { type CaptureSession, type CaptureSnapshot } from "@/lib/capture-session";
import { DeviceMonitoring, type MonitoringStatus } from "@/lib/device-monitoring";
import { deviceConfigurationSchema, type DeviceConfiguration } from "@/lib/rules";
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
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const configurationRef = useRef(configuration);
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
        controller.current?.configure(next.rules);
        setConfiguration(next);
        setConfigurationNotice("Assigned configuration is current.");
      } catch {
        if (disposed) return;
        configurationRef.current = null;
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
    <section className="mt-5 border-t border-border pt-5" aria-label="AI monitoring">
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
      <button
        type="button"
        className="mt-2 text-xs text-primary underline"
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh assigned rules
      </button>
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
      <ul className="mt-3 space-y-3 text-xs">
        {active &&
          status?.rules.map((rule) => (
            <li key={rule.id}>
              <strong>
                {rule.name} · v{rule.version}
              </strong>
              <p className="mt-1 text-muted-foreground">{rule.notice}</p>
            </li>
          ))}
      </ul>
      {active && status?.latest && (
        <div className="mt-4 rounded-lg bg-incident/10 p-3 text-xs">
          <strong>Latest incident reported</strong>
          <p className="mt-1">
            Approximate event time: {new Date(status.latest.eventTime).toLocaleTimeString()}
          </p>
          <p>
            Source interval: {(status.latest.from / 1000).toFixed(1)}–
            {(status.latest.to / 1000).toFixed(1)}s
          </p>
          <p>Replay unavailable. Clip upload is not connected.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Monitoring sends sampled frames for remote AI assessment. Capture must remain open and
        visible.
      </p>
    </section>
  );
}
