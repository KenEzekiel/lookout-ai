import { BellOff, BellRing, ExternalLink, Hand, RotateCw, Volume2, VolumeX } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LoadingIndicator } from "@/components/ui/loading";
import { ActionForm } from "@/components/access/forms";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Member } from "@/lib/access";
import { message, request } from "@/lib/api";
import {
  type Incident,
  incidentAlertKey,
  incidentInboxSchema,
  incidentSchema,
} from "@/lib/incidents";

function playAlarm(context: AudioContext, buffer: AudioBuffer) {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const stop = () => {
    source.disconnect();
  };
  source.onended = stop;
  return stop;
}

export function IncomingAlerts({ actor }: { actor: Member }) {
  const storageKey = `lookout:alerts:${actor.workspaceId}:${actor.userId}`;
  const [silenced, setSilenced] = useState<Set<string>>(() => {
    try {
      return new Set(
        z.array(z.string()).parse(JSON.parse(sessionStorage.getItem(storageKey) ?? "[]")),
      );
    } catch {
      return new Set();
    }
  });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [delivery, setDelivery] = useState<"connecting" | "connected" | "unavailable">(
    "connecting",
  );
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [soundLoading, setSoundLoading] = useState(false);
  const [sound, setSound] = useState<"off" | "on" | "blocked">("off");
  const [context, setContext] = useState<AudioContext | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const stopPlayback = useRef(() => {});
  const sequence = useRef(0);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await request("/api/incidents/alerts", incidentInboxSchema);
      if (active.current && current === sequence.current) {
        setIncidents(next.incidents);
        setDelivery("connected");
      }
    } catch {
      if (active.current && current === sequence.current) {
        setIncidents([]);
        setDelivery("unavailable");
      }
    }
  }, []);
  useEffect(() => {
    active.current = true;
    async function connect() {
      await refresh();
    }
    void connect();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active.current = false;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  useEffect(
    () => () => {
      if (context && context.state !== "closed") void context.close();
    },
    [context],
  );
  const incoming = incidents.filter(
    (incident) => incident.status === "open" && !silenced.has(incidentAlertKey(incident)),
  );
  const incident = incoming[0];
  const ringingId = incident ? incidentAlertKey(incident) : undefined;
  useEffect(() => {
    const audio = context;
    if (sound !== "on" || !audio || !buffer) return;
    const ring = () => {
      stopPlayback.current();
      if (audio.state !== "running") {
        setSound("blocked");
        return;
      }
      stopPlayback.current = playAlarm(audio, buffer);
    };
    if (ringingId) ring();
    const timer = ringingId ? setInterval(ring, 6000) : undefined;
    return () => {
      clearInterval(timer);
      stopPlayback.current();
    };
  }, [ringingId, sound, context, buffer]);
  function silence(id: string) {
    const next = new Set(silenced).add(id);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      setNotice("Silenced in this browser. The incident still needs acknowledgment.");
    } catch {
      setNotice("Silenced for this screen. Browser storage is unavailable.");
    }
    setSilenced(next);
    setActionError("");
  }
  async function testSound() {
    if (soundLoading) return;
    setSoundLoading(true);
    try {
      const audio = context ?? new AudioContext();
      setContext(audio);
      await audio.resume();
      if (audio.state !== "running") throw new Error("Playback unavailable");
      let clip = buffer;
      if (!clip) {
        const response = await fetch("/sounds/incident-alert.wav");
        if (!response.ok) throw new Error("Alert sound unavailable");
        clip = await audio.decodeAudioData(await response.arrayBuffer());
      }
      if (!active.current) {
        await audio.close();
        return;
      }
      setBuffer(clip);
      if (!ringingId || sound === "on") {
        stopPlayback.current();
        stopPlayback.current = playAlarm(audio, clip);
      }
      setSound("on");
    } catch {
      if (active.current) setSound("blocked");
    } finally {
      if (active.current) setSoundLoading(false);
    }
  }
  async function acknowledge() {
    if (!incident || pending) return;
    setPending(true);
    setActionError("");
    sequence.current++;
    try {
      const next = await request(
        `/api/incidents/commands/${encodeURIComponent(incident.id)}`,
        incidentSchema,
        {
          action: "acknowledge",
          version: incident.version,
        },
      );
      if (!active.current) return;
      sequence.current++;
      setIncidents((previous) => previous.filter((item) => item.id !== next.id));
      setNotice(`You are handling ${next.rule.definition.name}.`);
    } catch (error) {
      if (active.current) {
        setActionError(message(error));
        await refresh();
      }
    } finally {
      if (active.current) setPending(false);
    }
  }
  const soundControls = (
    <div className="flex flex-wrap gap-2">
      <Button
        icon={Volume2}
        variant="outline"
        loading={soundLoading}
        onClick={() => void testSound()}
      >
        {soundLoading ? "Loading sound…" : sound === "on" ? "Test sound" : "Enable sound and test"}
      </Button>
      {sound === "on" && (
        <Button icon={VolumeX} variant="ghost" onClick={() => setSound("off")}>
          Turn sound off
        </Button>
      )}
      {sound === "blocked" && (
        <output>Sound playback is unavailable or blocked. Visible alerts still work.</output>
      )}
    </div>
  );
  return (
    <section aria-label="Incoming alerts" className="mt-6 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {delivery === "connecting" && (
            <LoadingIndicator className="mr-2 inline-block align-middle" />
          )}
          {delivery === "connecting"
            ? "Connecting incoming alerts…"
            : delivery === "connected"
              ? "Incoming alerts connected"
              : "Incoming alerts unavailable. Reconnecting…"}{" "}
          {sound === "on" ? "Sound enabled." : "Sound off."}
        </p>
        <div className="flex flex-wrap gap-2">
          {delivery === "unavailable" && (
            <ActionForm
              icon={RotateCw}
              submit="Retry alerts"
              pendingLabel="Reconnecting…"
              variant="outline"
              size="sm"
              action={refresh}
            />
          )}
          <Button
            icon={Volume2}
            size="sm"
            variant="outline"
            loading={soundLoading}
            onClick={() => void testSound()}
          >
            {soundLoading
              ? "Loading sound…"
              : sound === "on"
                ? "Test sound"
                : "Enable sound and test"}
          </Button>
          {sound === "on" && (
            <Button icon={VolumeX} size="sm" variant="ghost" onClick={() => setSound("off")}>
              Turn sound off
            </Button>
          )}
        </div>
      </div>
      {sound === "blocked" && (
        <output className="text-sm text-muted-foreground">
          Sound playback is unavailable or blocked. Visible alerts still work. Try Enable sound and
          test again.
        </output>
      )}
      <p aria-live="polite" className={notice ? "text-sm" : "sr-only"}>
        {notice}
      </p>
      {actionError && !incident && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {incident
          ? `${incident.followUp.kind === "attempted" ? "Incident follow-up" : "Incoming incident"}. ${incident.rule.definition.name}. ${incident.source.name}.`
          : ""}
      </div>
      {incident && (
        <Dialog
          open
          onOpenChange={(open, details) => {
            if (!open && details.reason === "escape-key") silence(incidentAlertKey(incident));
          }}
        >
          <DialogContent
            showCloseButton={false}
            aria-label="Incoming incident"
            className="inset-0 z-[100] h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none bg-card p-6 sm:max-w-none sm:p-12"
          >
            <article className="m-auto w-full max-w-2xl min-w-0 break-words [overflow-wrap:anywhere]">
              {soundControls}
              {actionError && (
                <p role="alert" className="mt-4 text-destructive">
                  {actionError}
                </p>
              )}
              <p className="flex items-center gap-2 text-sm font-semibold text-incident">
                <BellRing aria-hidden="true" className="size-5" />
                {incident.followUp.kind === "attempted"
                  ? "Incident follow-up"
                  : "Incoming incident"}
                {incoming.length > 1 ? ` · ${incoming.length} waiting` : ""}
              </p>
              <DialogTitle className="sr-only">Incoming incident</DialogTitle>
              <h2 className="mt-3 text-2xl font-semibold break-words sm:text-3xl">
                {incident.rule.definition.name}
              </h2>
              <p className="mt-2 break-words">
                {incident.source.name} ·{" "}
                {incident.source.kind === "replay" ? "Replayed footage" : "Camera"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                <time dateTime={new Date(incident.eventTime).toISOString()}>
                  {new Date(incident.eventTime).toLocaleString()}
                </time>{" "}
                · {incident.rule.definition.severity === "critical" ? "Critical" : "Warning"} ·
                Evidence {incident.evidenceStatus}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                No owner yet. Acknowledge to let your team know you are handling it.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button icon={Hand} loading={pending} onClick={() => void acknowledge()}>
                  {pending ? "Acknowledging…" : "Acknowledge alert"}
                </Button>
                <Link
                  to="/incidents/$incidentId"
                  params={{ incidentId: incident.id }}
                  onClick={() => silence(incidentAlertKey(incident))}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <ExternalLink aria-hidden="true" />
                  Open incident
                </Link>
                <Button
                  icon={BellOff}
                  variant="ghost"
                  onClick={() => {
                    silence(incidentAlertKey(incident));
                  }}
                >
                  Silence here
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Opening or silencing leaves the incident unacknowledged.
              </p>
            </article>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
