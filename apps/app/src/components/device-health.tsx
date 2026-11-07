import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { request, message } from "@/lib/api";
import {
  deviceHealthSchema,
  configurationMatches,
  healthStatus,
  healthReportIntervalMs,
  type DeviceHealth,
} from "@/lib/device-health";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function time(at: number | null) {
  return at === null ? "Not reported" : new Date(at).toLocaleString();
}

function HealthDetails({ device, now }: { device: DeviceHealth; now: number }) {
  const status = healthStatus(device, now);
  return (
    <li className="min-w-0 py-5" aria-label={`Health of ${device.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="break-words font-medium">{device.name}</h3>
        <Badge
          variant="outline"
          className={status === "Monitoring" ? "text-resolved" : "text-muted-foreground"}
        >
          {status}
        </Badge>
      </div>
      <p className="mt-1 break-all text-xs text-muted-foreground">Device ID {device.id}</p>
      <p className="mt-3 text-sm">Source: {device.source?.name ?? "No assigned source"}</p>
      {device.source && (
        <p className="mt-1 break-all text-xs text-muted-foreground">
          Source ID {device.source.id} · {device.source.kind === "camera" ? "Camera" : "Replay"}
        </p>
      )}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Last contact</dt>
          <dd className="mt-1 tabular-nums">{time(device.lastContactAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last observation</dt>
          <dd className="mt-1 tabular-nums">{time(device.report?.lastObservationAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last assessment</dt>
          <dd className="mt-1 tabular-nums">{time(device.report?.lastAssessmentAt ?? null)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm">Assessment: {device.report?.assessment ?? "unavailable"}</p>
      <p className="mt-1 text-sm">
        Configuration: {configurationMatches(device) ? "Applied" : "Not current"}
      </p>
      <ul
        className="mt-2 space-y-2 text-xs text-muted-foreground"
        aria-label="Assigned trigger versions"
      >
        {device.assignedRules.map((rule) => {
          const applied = device.report?.appliedRules.find((applied) => applied.id === rule.id);
          return (
            <li key={rule.id}>
              {rule.name} · Assigned v{rule.version}
              {rule.enabled ? "" : " (disabled)"} · Applied{" "}
              {applied ? `v${applied.version}` : "not reported"}
            </li>
          );
        })}
      </ul>
      {device.assignedRules.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No triggers assigned to this source.</p>
      )}
    </li>
  );
}

export function DeviceHealthPanel() {
  const [devices, setDevices] = useState<DeviceHealth[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [clock, setClock] = useState({ serverTime: 0, receivedAt: 0 });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function load() {
      try {
        const result = await request(
          "/api/health/operator",
          deviceHealthSchema,
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
        );
        if (disposed) return;
        setDevices(result.devices);
        setClock({ serverTime: result.serverTime, receivedAt: performance.now() });
        setElapsed(0);
        setError("");
      } catch (error) {
        if (!disposed) {
          setDevices(null);
          setError(message(error));
        }
      } finally {
        if (!disposed) timer = setTimeout(load, healthReportIntervalMs);
      }
    }
    void load();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(performance.now() - clock.receivedAt);
    }, 1000);
    return () => clearInterval(timer);
  }, [clock]);
  return (
    <section className="mb-8 rounded-xl bg-card p-5 sm:p-6" aria-labelledby="device-health-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="device-health-title" className="font-medium">
          Monitoring health
        </h2>
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCw}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh health
        </Button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Reports refresh every 5 seconds. No contact for 20 seconds means disconnected or stale.
        Capture stalls after 10 seconds without an observation.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Health status unavailable. {error}
        </p>
      ) : devices === null ? (
        <output className="mt-4 block text-sm">Loading monitoring health…</output>
      ) : devices.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Pair a device to see monitoring health.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {devices.map((device) => (
            <HealthDetails key={device.id} device={device} now={clock.serverTime + elapsed} />
          ))}
        </ul>
      )}
    </section>
  );
}
