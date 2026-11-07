import { Check, Hand, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Video } from "lucide-react";
import { ActionForm } from "@/components/access/forms";
import { LoadingIndicator, LoadingState } from "@/components/ui/loading";
import { SavedReplay } from "./saved-replay";
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
const evidenceLabels: Record<Incident["evidenceStatus"], string> = {
  preparing: "Preparing evidence",
  uploading: "Uploading evidence",
  ready: "Replay ready",
  unavailable: "Evidence unavailable",
};
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
        <ActionForm
          icon={RotateCw}
          submit="Reload inbox"
          pendingLabel="Reloading inbox…"
          variant="outline"
          action={refresh}
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : !incidents ? (
        <LoadingState label="Loading incidents…" />
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
                    {incident.owner ? `Owned by ${incident.owner.name}` : "No owner yet"} ·{" "}
                    {evidenceLabels[incident.evidenceStatus]}
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
  const [pending, setPending] = useState<IncidentCommand["action"] | null>(null);
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
    setPending(action);
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
      setPending(null);
    }
  }
  return (
    <section className="grid gap-6" aria-label="Incident detail">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/incidents" className="text-signal underline underline-offset-4">
          Back to inbox
        </Link>
        <ActionForm
          icon={RotateCw}
          disabled={pending !== null}
          submit="Reload incident"
          pendingLabel="Reloading incident…"
          variant="outline"
          action={async () => {
            setActionError("");
            await refresh();
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : !incident ? (
        <LoadingState label="Loading incident…" layout="detail" />
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
              <section
                aria-label="Evidence"
                className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl bg-card p-8 text-center"
              >
                {incident.evidenceStatus === "ready" ? (
                  <>
                    <h3 className="text-xl font-medium">Saved event replay</h3>
                    <SavedReplay id={incident.id} />
                    {incident.evidenceExpiresAt && (
                      <p className="text-sm text-muted-foreground">
                        Available until <EventTime at={incident.evidenceExpiresAt} />
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {incident.evidenceStatus === "unavailable" ? (
                      <Video aria-hidden="true" className="size-8 text-muted-foreground" />
                    ) : (
                      <LoadingIndicator className="size-8 text-muted-foreground" />
                    )}
                    <h3 className="text-xl font-medium">
                      {evidenceLabels[incident.evidenceStatus]}
                    </h3>
                    <p className="max-w-sm text-muted-foreground">
                      {incident.evidenceStatus === "unavailable"
                        ? incident.evidenceReason || "No playable clip is available for this event."
                        : incident.evidenceStatus === "uploading"
                          ? "The device is sending the clip. You can respond while it uploads."
                          : "The device is preparing the clip. You can respond while evidence is pending."}
                    </p>
                  </>
                )}
              </section>
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
                      disabled={pending !== null}
                      loading={pending === "acknowledge"}
                      onClick={() => void respond("acknowledge")}
                    >
                      {pending === "acknowledge" ? "Acknowledging…" : "Acknowledge"}
                    </Button>
                  )}
                  {incident.status === "acknowledged" && (
                    <Button
                      icon={Check}
                      disabled={pending !== null}
                      loading={pending === "resolve"}
                      onClick={() => void respond("resolve")}
                    >
                      {pending === "resolve" ? "Resolving…" : "Resolve"}
                    </Button>
                  )}
                  {(incident.status === "open" || incident.status === "acknowledged") && (
                    <Button
                      icon={X}
                      variant="outline"
                      disabled={pending !== null}
                      loading={pending === "dismiss"}
                      onClick={() => void respond("dismiss")}
                    >
                      {pending === "dismiss" ? "Dismissing…" : "Dismiss as incorrect"}
                    </Button>
                  )}
                </div>
              </section>
              <section aria-labelledby="alert-title">
                <h3 id="alert-title" className="font-medium">
                  Alert delivery
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {
                    {
                      "not-sent": "No background notification delivery recorded.",
                      attempting: "Background notification delivery is being attempted.",
                      accepted:
                        "A push service accepted a notification. Device display is not confirmed.",
                      failed:
                        "Background notification attempts failed. Check Lookout directly for updates.",
                    }[incident.notificationStatus]
                  }
                </p>
                <ol className="mt-3 grid gap-3 text-sm" aria-label="Escalation levels">
                  {incident.rule.definition.escalationLevels.map((level, index) => {
                    const activatedAt = incident.escalationActivations[index];
                    const active = index === incident.escalationActivations.length - 1;
                    return (
                      <li key={index}>
                        <p>
                          Level {index + 1}:{" "}
                          {activatedAt !== undefined
                            ? active && incident.status === "open"
                              ? "Active"
                              : "Published"
                            : incident.status === "open"
                              ? "Waiting"
                              : "Cancelled"}
                        </p>
                        <p className="break-all text-muted-foreground">
                          Recipients: {level.recipientIds.join(", ")}
                        </p>
                        {activatedAt !== undefined && (
                          <p>
                            Published <EventTime at={activatedAt} />. Display is not confirmed.
                          </p>
                        )}
                        {active &&
                          incident.status === "open" &&
                          incident.escalationDueAt !== null && (
                            <p>
                              Next level due <EventTime at={incident.escalationDueAt} />.
                              Acknowledge to stop escalation.
                            </p>
                          )}
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-2 text-sm text-muted-foreground">
                  {incident.status !== "open"
                    ? "Pending escalation cancelled by the incident response."
                    : incident.escalationDueAt === null
                      ? "No further escalation is scheduled. The incident remains open."
                      : "Escalation continues only while nobody acknowledges."}
                </p>
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
                              : entry.kind === "follow-up-attempted"
                                ? `Level ${entry.level ?? 2} escalation published by`
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
