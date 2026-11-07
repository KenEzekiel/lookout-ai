import { Check, Hand, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { message, request } from "@/lib/api";
import {
  type Incident,
  type IncidentCommand,
  incidentInboxSchema,
  incidentSchema,
  incidentStatusLabels,
} from "@/lib/incidents";
import { conditionText } from "@/lib/rules";

function EventTime({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time>;
}
function Status({ incident }: { incident: Incident }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${incident.status === "open" ? "bg-incident text-incident-foreground" : incident.status === "resolved" ? "bg-muted text-resolved" : "bg-muted text-foreground"}`}
    >
      {incidentStatusLabels[incident.status]}
    </span>
  );
}
export function IncidentInbox() {
  const [incidents, setIncidents] = useState<Incident[]>();
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await request("/api/incidents/inbox", incidentInboxSchema);
      if (current === sequence.current) {
        setIncidents(next.incidents);
        setError("");
      }
    } catch (error) {
      if (current === sequence.current) {
        setIncidents(undefined);
        setError(message(error));
      }
    }
  }, []);
  useEffect(() => {
    let active = true;
    async function check() {
      const current = ++sequence.current;
      try {
        const next = await request("/api/incidents/inbox", incidentInboxSchema);
        if (active && current === sequence.current) {
          setIncidents(next.incidents);
          setError("");
        }
      } catch (error) {
        if (active && current === sequence.current) {
          setIncidents(undefined);
          setError(message(error));
        }
      }
    }
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section aria-labelledby="inbox-title" className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="inbox-title" className="text-3xl font-semibold tracking-tight">
            Incident inbox
          </h2>
          <p className="mt-2 text-muted-foreground">
            Review what happened and take ownership of the response.
          </p>
        </div>
        <Button icon={RotateCw} variant="outline" onClick={() => void refresh()}>
          Reload inbox
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : !incidents ? (
        <output>Loading incidents…</output>
      ) : incidents.length === 0 ? (
        <div className="rounded-2xl bg-card p-8">
          <h3 className="text-xl font-medium">No incidents yet</h3>
          <p className="mt-2 text-muted-foreground">
            Reported events will appear here. Configure a trigger and keep its monitoring device
            active.
          </p>
          <Link
            to="/triggers"
            className="mt-4 inline-block text-signal underline underline-offset-4"
          >
            View triggers
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3" aria-label="Incidents">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                to="/incidents/$incidentId"
                params={{ incidentId: incident.id }}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-card p-6 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="text-lg font-semibold break-words">
                    {incident.rule.definition.name}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground break-words">
                    {incident.source.name} ·{" "}
                    {incident.source.kind === "replay" ? "Replayed footage" : "Camera"}
                  </p>
                  <p className="mt-2 text-sm">
                    <EventTime at={incident.eventTime} />
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {incident.owner ? `Owned by ${incident.owner.name}` : "No owner yet"} · Evidence
                    pending
                  </p>
                </div>
                <Status incident={incident} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {incidents && incidents.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing up to 100 incidents, with active responses first.
        </p>
      )}
    </section>
  );
}

export function IncidentDetail({ id }: { id: string }) {
  const [incident, setIncident] = useState<Incident>();
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await request(`/api/incidents/detail/${encodeURIComponent(id)}`, incidentSchema);
      if (current === sequence.current) {
        setIncident((previous) =>
          !previous || next.version >= previous.version ? next : previous,
        );
        setError("");
      }
    } catch (error) {
      if (current === sequence.current) {
        setIncident(undefined);
        setError(message(error));
      }
    }
  }, [id]);
  useEffect(() => {
    let active = true;
    async function check() {
      const current = ++sequence.current;
      try {
        const next = await request(
          `/api/incidents/detail/${encodeURIComponent(id)}`,
          incidentSchema,
        );
        if (active && current === sequence.current) {
          setIncident((previous) =>
            !previous || next.version >= previous.version ? next : previous,
          );
          setError("");
        }
      } catch (error) {
        if (active && current === sequence.current) {
          setIncident(undefined);
          setError(message(error));
        }
      }
    }
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  async function respond(action: IncidentCommand["action"]) {
    if (!incident || pending) return;
    setPending(true);
    setActionError("");
    setNotice("");
    sequence.current++;
    try {
      const next = await request(
        `/api/incidents/commands/${encodeURIComponent(id)}`,
        incidentSchema,
        { action, version: incident.version },
      );
      setIncident((previous) => (!previous || next.version >= previous.version ? next : previous));
      setNotice(
        action === "acknowledge"
          ? "You are handling this incident."
          : action === "dismiss"
            ? "Dismissed as an incorrect alert."
            : "Incident resolved.",
      );
    } catch (error) {
      setActionError(message(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="grid gap-6" aria-label="Incident detail">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/incidents" className="text-signal underline underline-offset-4">
          Back to inbox
        </Link>
        <Button
          icon={RotateCw}
          variant="outline"
          disabled={pending}
          onClick={() => {
            setActionError("");
            void refresh();
          }}
        >
          Reload incident
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : !incident ? (
        <output>Loading incident…</output>
      ) : (
        <>
          <header>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Status incident={incident} />
              <span
                className={`text-sm font-medium ${incident.rule.definition.severity === "critical" ? "text-critical" : "text-incident"}`}
              >
                {incident.rule.definition.severity === "critical" ? "Critical" : "Warning"}
              </span>
            </div>
            <h2 className="text-3xl font-semibold tracking-tight break-words">
              {incident.rule.definition.name}
            </h2>
            <p className="mt-2 text-muted-foreground break-words">
              {incident.source.name} ·{" "}
              {incident.source.kind === "replay" ? "Replayed footage" : "Camera"}
            </p>
            <p className="mt-2 text-sm">
              Event time · <EventTime at={incident.eventTime} />
            </p>
          </header>
          <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
            <div className="grid gap-6">
              <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl bg-card p-8 text-center">
                <Video aria-hidden="true" className="size-8 text-muted-foreground" />
                <h3 className="text-xl font-medium">Evidence pending</h3>
                <p className="max-w-sm text-muted-foreground">
                  Preparing replay. No saved clip is available yet. You can respond while evidence
                  is pending.
                </p>
              </div>
              <section aria-labelledby="rule-title" className="rounded-2xl bg-card p-6">
                <h3 id="rule-title" className="text-lg font-semibold">
                  Matched trigger
                </h3>
                <p className="mt-3">{conditionText(incident.rule.definition.condition)}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Rule version {incident.rule.version}
                  {incident.rule.definition.durationSeconds !== null &&
                    ` · Duration ${incident.rule.definition.durationSeconds} seconds`}
                </p>
              </section>
            </div>
            <div className="grid gap-6 rounded-2xl bg-card p-6">
              <section aria-labelledby="response-title">
                <h3 id="response-title" className="text-xl font-semibold">
                  Response
                </h3>
                <p className="mt-3">
                  {incident.owner ? `Owned by ${incident.owner.name}` : "No owner yet"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {incident.status === "open"
                    ? "Acknowledge to let your team know you are handling it."
                    : incident.status === "acknowledged"
                      ? "The response stays open until it is resolved or dismissed."
                      : incident.status === "dismissed"
                        ? "Recorded as an incorrect alert."
                        : "The response is closed."}
                </p>
                {actionError && (
                  <p role="alert" className="mt-4 text-sm text-destructive">
                    {actionError}
                  </p>
                )}
                {notice && <output className="mt-4 block text-sm">{notice}</output>}
                <div className="mt-5 grid gap-3">
                  {incident.status === "open" && (
                    <Button
                      icon={Hand}
                      disabled={pending}
                      onClick={() => void respond("acknowledge")}
                    >
                      Acknowledge
                    </Button>
                  )}
                  {incident.status === "acknowledged" && (
                    <Button icon={Check} disabled={pending} onClick={() => void respond("resolve")}>
                      Resolve
                    </Button>
                  )}
                  {(incident.status === "open" || incident.status === "acknowledged") && (
                    <Button
                      icon={X}
                      variant="outline"
                      disabled={pending}
                      onClick={() => void respond("dismiss")}
                    >
                      Dismiss as incorrect
                    </Button>
                  )}
                </div>
              </section>
              <section aria-labelledby="alert-title">
                <h3 id="alert-title" className="font-medium">
                  Alert delivery
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  No background notification delivery recorded.
                </p>
                {incident.status === "open" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Configured follow-up delay {incident.rule.definition.escalationDelaySeconds}{" "}
                    seconds. No follow-up is scheduled.
                  </p>
                )}
              </section>
              <section aria-labelledby="timeline-title">
                <h3 id="timeline-title" className="flex items-center gap-2 font-medium">
                  <Clock aria-hidden="true" className="size-4" />
                  Timeline
                </h3>
                <ol className="mt-4 grid gap-4">
                  {incident.timeline.map((entry, index) => (
                    <li key={index} className="text-sm">
                      <p>
                        {entry.kind === "reported"
                          ? "Reported by"
                          : entry.kind === "acknowledged"
                            ? "Acknowledged by"
                            : entry.kind === "dismissed"
                              ? "Dismissed by"
                              : "Resolved by"}{" "}
                        {entry.actorName}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        <EventTime at={entry.at} />
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />A reported event
            needs human review. A trigger match does not confirm what happened.
          </p>
        </>
      )}
    </section>
  );
}
