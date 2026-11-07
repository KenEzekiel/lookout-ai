import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { request } from "@/lib/api";
import { healthReportIntervalMs, type HealthReport } from "@/lib/device-health";

export function HealthReporting({ report }: { report: HealthReport }) {
  const current = useRef(report);
  const send = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState("Connecting health reports…");
  const changeKey = JSON.stringify([
    report.sourceId,
    report.capture,
    report.assessment,
    report.configurationAvailable,
    report.appliedRules,
  ]);
  useEffect(() => {
    current.current = report;
  }, [report]);
  useEffect(() => {
    let disposed = false;
    let sending = false;
    let pending = false;
    const abort = new AbortController();
    async function publish() {
      if (disposed) return;
      if (sending) {
        pending = true;
        return;
      }
      sending = true;
      try {
        await request(
          "/api/health/report",
          z.object({ receivedAt: z.number() }),
          current.current,
          AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
        );
        if (!disposed) setNotice("Health reports connected. Only status metadata is sent.");
      } catch {
        if (!disposed)
          setNotice(
            "Health reports unavailable. The operator will see this device as stale. Retrying…",
          );
      } finally {
        sending = false;
        if (pending && !disposed) {
          pending = false;
          void publish();
        }
      }
    }
    send.current = () => {
      void publish();
    };
    const timer = setInterval(() => {
      void publish();
    }, healthReportIntervalMs);
    return () => {
      disposed = true;
      send.current = null;
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    send.current?.();
  }, [changeKey]);
  return <output className="mt-3 block text-xs text-muted-foreground">{notice}</output>;
}
