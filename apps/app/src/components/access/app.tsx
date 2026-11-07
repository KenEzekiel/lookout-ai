import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { type Principal, principalSchema } from "@/lib/access";
import { mutate, request, message } from "@/lib/api";
import { Account } from "./account";
import { DeviceScreen } from "@/components/device-screen";
import { Onboarding } from "./onboarding";
import { Workspace } from "./workspace";
import { Monitor, PairBrowser } from "./monitor";
import { ActionForm } from "./forms";
import { RuleWorkspace } from "@/components/rules/workspace";
import { IncidentDetail, IncidentInbox } from "@/components/incidents/workspace";

export function AccessApp({
  pairing = false,
  capture = false,
  invitation,
  triggers = false,
  incidents = false,
  incidentId,
}: {
  pairing?: boolean;
  capture?: boolean;
  invitation?: string;
  triggers?: boolean;
  incidents?: boolean;
  incidentId?: string;
}) {
  const [actor, setActor] = useState<Principal>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setActor(await request("/api/access/principal", principalSchema));
    setError("");
  }, []);
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const next = await request("/api/access/principal", principalSchema);
        if (active) {
          setActor(next);
          setError("");
        }
      } catch (error) {
        if (active) {
          setActor(undefined);
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
  if (capture && actor?.kind === "device" && !error) {
    return <DeviceScreen deviceId={actor.deviceId} workspaceId={actor.workspaceId} />;
  }
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 md:px-8 md:py-12">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lookout AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {actor?.kind === "member" ? actor.workspaceName : "Workspace & device access"}
          </p>
        </div>
        <nav aria-label="Account" className="flex flex-wrap items-center gap-4 text-sm">
          <Link to="/" className="underline underline-offset-4">
            Workspace
          </Link>
          {actor?.kind === "member" && (
            <Link to="/incidents" className="underline underline-offset-4">
              Incidents
            </Link>
          )}
          {actor?.kind === "member" && (
            <Link to="/triggers" className="underline underline-offset-4">
              Triggers
            </Link>
          )}
          <Link to="/monitor" className="underline underline-offset-4">
            Pair a monitoring browser
          </Link>
          {actor?.kind === "device" && (
            <Link to="/device" className="underline underline-offset-4">
              Capture station
            </Link>
          )}
          {actor && (actor.kind === "member" || actor.kind === "unassigned-user") && (
            <ActionForm
              submit="Sign out"
              action={async () => {
                await mutate("/api/auth/sign-out");
                await refresh();
              }}
            />
          )}
        </nav>
      </header>
      {error ? (
        <div className="mx-auto grid max-w-lg gap-5">
          <p role="alert">{error}</p>
          <ActionForm
            submit="Return to sign in"
            action={async () => {
              await mutate("/api/access/devices/leave");
              window.location.assign("/");
            }}
          />
        </div>
      ) : !actor ? (
        <output>Loading workspace…</output>
      ) : actor.kind === "device" ? (
        <Monitor actor={actor} />
      ) : pairing ? (
        <PairBrowser onPaired={refresh} />
      ) : actor.kind === "visitor" ? (
        <Account onSignedIn={refresh} />
      ) : actor.kind === "unassigned-user" ? (
        <Onboarding invitation={invitation} onJoined={refresh} />
      ) : incidents ? (
        incidentId ? (
          <IncidentDetail key={actor.workspaceId + incidentId} id={incidentId} />
        ) : (
          <IncidentInbox key={actor.workspaceId} />
        )
      ) : triggers ? (
        <RuleWorkspace key={actor.workspaceId} />
      ) : (
        <Workspace key={actor.workspaceId + actor.role} actor={actor} onChanged={refresh} />
      )}
    </main>
  );
}
