import { LogIn, LogOut, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type Principal, principalSchema } from "@/lib/access";
import { mutate, request, message } from "@/lib/api";
import { RuleWorkspace } from "@/components/rules/workspace";
import { IncidentDetail, IncidentInbox } from "@/components/incidents/workspace";
import { IncomingAlerts } from "@/components/incidents/incoming-alerts";
import { DeviceScreen } from "@/components/device-screen";
import { Account } from "./account";
import { Brand } from "./brand";
import { Onboarding } from "./onboarding";
import { Workspace } from "./workspace";
import { Monitor, PairBrowser } from "./monitor";
import { ActionForm, Panel } from "./forms";

export function AccessApp({
  pairing = false,
  capture = false,
  triggers = false,
  incidents = false,
  incidentId,
  invitation,
  view = "devices",
}: {
  pairing?: boolean;
  capture?: boolean;
  triggers?: boolean;
  incidents?: boolean;
  incidentId?: string;
  invitation?: string;
  view?: "devices" | "team";
}) {
  const navigate = useNavigate();
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
  const signedIn = actor?.kind === "member" || actor?.kind === "unassigned-user";
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-50 rounded bg-background px-4 py-2 focus:not-sr-only"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-8 sm:py-0">
          <Link
            to="/"
            aria-label="Lookout home"
            className="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Brand />
          </Link>
          {actor?.kind === "member" && (
            <span
              className="hidden max-w-48 truncate border-l border-border pl-6 text-sm text-muted-foreground sm:block"
              title={actor.workspaceName}
            >
              {actor.workspaceName}
            </span>
          )}
          {actor?.kind === "member" && !pairing && (
            <nav
              aria-label="Workspace"
              className="order-last flex w-full gap-6 sm:order-none sm:ml-2 sm:w-auto sm:self-stretch"
            >
              <Link
                to="/"
                search={{ view: "devices" }}
                aria-current={!triggers && !incidents && view === "devices" ? "page" : undefined}
                className={`inline-flex h-11 items-center border-b-2 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-full ${!triggers && !incidents && view === "devices" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                Devices
              </Link>
              <Link
                to="/"
                search={{ view: "team" }}
                aria-current={!triggers && !incidents && view === "team" ? "page" : undefined}
                className={`inline-flex h-11 items-center border-b-2 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-full ${!triggers && !incidents && view === "team" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                Team
              </Link>
              <Link
                to="/incidents"
                aria-current={incidents ? "page" : undefined}
                className={`inline-flex h-11 items-center border-b-2 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-full ${incidents ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                Incidents
              </Link>
              <Link
                to="/triggers"
                aria-current={triggers ? "page" : undefined}
                className={`inline-flex h-11 items-center border-b-2 text-sm font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-full ${triggers ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                Triggers
              </Link>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {actor?.kind === "device" && (
              <Link to="/device" className="text-sm text-signal">
                Capture station
              </Link>
            )}
            {signedIn && (
              <>
                <span
                  className="hidden size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground sm:flex"
                  aria-label={`Signed in as ${actor.name}`}
                  title={actor.name}
                >
                  {actor.name.slice(0, 2).toUpperCase()}
                </span>
                <ActionForm
                  icon={LogOut}
                  submit="Sign out"
                  pendingLabel="Signing out…"
                  size="sm"
                  variant="ghost"
                  action={async () => {
                    await mutate("/api/auth/sign-out");
                    await refresh();
                  }}
                />
              </>
            )}
            {pairing && !signedIn && actor?.kind !== "device" && (
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
                Sign in instead
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-5 sm:px-8">
        {!error && actor?.kind === "member" && !pairing && (
          <IncomingAlerts key={actor.workspaceId + actor.userId} actor={actor} />
        )}
        {error ? (
          <Panel title="We couldn’t open your workspace">
            <p role="alert" className="mb-6 text-sm leading-relaxed text-destructive">
              {error}
            </p>
            <div className="grid gap-3">
              <ActionForm
                icon={RotateCw}
                submit="Try again"
                pendingLabel="Trying again…"
                action={refresh}
              />
              <ActionForm
                icon={LogIn}
                submit="Return to sign in"
                pendingLabel="Returning to sign in…"
                variant="secondary"
                action={async () => {
                  await mutate("/api/access/devices/leave");
                  window.location.assign("/");
                }}
              />
            </div>
          </Panel>
        ) : !actor ? (
          <output className="block py-16 text-center text-sm text-muted-foreground">
            Opening your workspace…
          </output>
        ) : actor.kind === "device" ? (
          <Monitor actor={actor} />
        ) : pairing ? (
          <PairBrowser signedIn={signedIn} onPaired={refresh} />
        ) : actor.kind === "visitor" ? (
          <Account invitation={invitation} onSignedIn={refresh} />
        ) : actor.kind === "unassigned-user" ? (
          <Onboarding
            invitation={invitation}
            onJoined={async () => {
              await refresh();
              await navigate({ to: "/", search: { view: "devices" }, replace: true });
            }}
          />
        ) : incidents ? (
          <section className="py-8 sm:py-12">
            {incidentId ? (
              <IncidentDetail key={actor.workspaceId + incidentId} id={incidentId} />
            ) : (
              <IncidentInbox key={actor.workspaceId} />
            )}
          </section>
        ) : triggers ? (
          <section className="py-8 sm:py-12">
            <RuleWorkspace key={actor.workspaceId} />
          </section>
        ) : (
          <>
            <p className="mt-5 break-words text-sm text-muted-foreground sm:hidden">
              {actor.workspaceName}
            </p>
            <Workspace
              key={actor.workspaceId + actor.role}
              actor={actor}
              view={view}
              onChanged={refresh}
            />
          </>
        )}
      </main>
    </div>
  );
}
