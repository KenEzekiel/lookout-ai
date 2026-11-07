import { LogIn, LogOut, RotateCw } from "lucide-react";
import { LoadingState } from "@/components/ui/loading";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { type Principal, principalSchema } from "@/lib/access";
import { mutate, request, message } from "@/lib/api";
import { IncomingAlerts } from "@/components/incidents/incoming-alerts";
import { PushSetup } from "@/components/incidents/push-setup";
import { DeviceScreen } from "@/components/device-screen";
import { Account } from "./account";
import { Brand } from "./brand";
import { DeviceModeAction } from "./device-mode-action";
import { Onboarding } from "./onboarding";
import { WorkspaceContext } from "./workspace-context";
import { Monitor, PairBrowser } from "./monitor";
import { ActionForm, Panel } from "./forms";

import { WorkspaceNavigation } from "./workspace-navigation";

export function AccessApp({
  pairing = false,
  capture = false,
  invitation,
  children,
}: {
  pairing?: boolean;
  capture?: boolean;
  invitation?: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const [actor, setActor] = useState<Principal>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setActor(
      await request(
        capture ? "/api/access/principal?mode=device" : "/api/access/principal",
        principalSchema,
      ),
    );
    setError("");
  }, [capture]);
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const next = await request(
          capture ? "/api/access/principal?mode=device" : "/api/access/principal",
          principalSchema,
        );
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
  }, [capture]);
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
          {actor?.kind === "member" && !pairing && <WorkspaceNavigation />}
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3">
            {actor?.kind === "member" && !pairing && (
              <DeviceModeAction actor={actor} onActivated={refresh} />
            )}
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
                    await mutate("/api/access/devices/leave");
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
          <>
            <IncomingAlerts key={actor.workspaceId + actor.userId} actor={actor} />
            <PushSetup key={`push-${actor.workspaceId}-${actor.userId}`} />
          </>
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
                  window.location.assign("/devices");
                }}
              />
            </div>
          </Panel>
        ) : !actor ? (
          <LoadingState label="Opening your workspace…" layout="screen" />
        ) : actor.kind === "device" ? (
          <Monitor actor={actor} />
        ) : pairing ? (
          <PairBrowser
            signedIn={signedIn}
            onPaired={async () => {
              await navigate({ to: "/device" });
            }}
          />
        ) : actor.kind === "visitor" ? (
          <Account invitation={invitation} onSignedIn={refresh} />
        ) : actor.kind === "unassigned-user" ? (
          <Onboarding
            invitation={invitation}
            onJoined={async () => {
              await refresh();
              await navigate({ to: "/devices", replace: true });
            }}
          />
        ) : (
          <WorkspaceContext
            key={actor.workspaceId + actor.userId + actor.role}
            value={{ actor, onChanged: refresh }}
          >
            {children ?? <Navigate to="/devices" replace />}
          </WorkspaceContext>
        )}
      </main>
    </div>
  );
}
