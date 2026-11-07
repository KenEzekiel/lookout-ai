import { LoadingState } from "@/components/ui/loading";
import { useEffect, useRef, useState } from "react";
import { Monitor, Plus, RotateCw, Trash2, Users, Video } from "lucide-react";
import { type z } from "zod";
import { type Member, teamSchema } from "@/lib/access";
import { request, message } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ActionForm } from "./forms";
import { Badge } from "@/components/ui/badge";
import { LiveView } from "@/components/live-view";
import { DeviceHealthPanel } from "@/components/device-health";
import { DeviceModeAction } from "./device-mode-action";
import { WorkspaceActions, type WorkspaceAction } from "./workspace-actions";

export function Workspace({
  actor,
  view,
  onChanged,
}: {
  actor: Member;
  view: "devices" | "team";
  onChanged: () => Promise<void>;
}) {
  const [team, setTeam] = useState<z.infer<typeof teamSchema>>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const revision = useRef(0);
  const [action, setAction] = useState<WorkspaceAction | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const owner = actor.role === "owner";
  async function refresh(notice: string) {
    const version = ++revision.current;
    setRefreshing(true);
    setNotice("");
    try {
      const next = await request("/api/access/team", teamSchema);
      if (version === revision.current) {
        setTeam(next);
        setError("");
      }
      setNotice(notice);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    let active = true;
    const version = ++revision.current;
    void request("/api/access/team", teamSchema)
      .then((next) => {
        if (active && version === revision.current) setTeam(next);
      })
      .catch((error) => {
        if (active && version === revision.current) setError(message(error));
      });
    const events = new EventSource(new URL("/api/access/team/events", window.location.origin));
    events.onmessage = (event) => {
      try {
        const next = teamSchema.parse(JSON.parse(event.data));
        ++revision.current;
        setTeam(next);
        setError("");
        setLiveError(false);
        setViewing((current) =>
          current &&
          next.devices.some((device) => device.id === current.id && device.revokedAt === null)
            ? current
            : null,
        );
      } catch {
        setLiveError(true);
      }
    };
    events.onopen = () => setLiveError(false);
    events.onerror = () => setLiveError(true);
    events.addEventListener("unavailable", () => {
      setLiveError(true);
      setTeam(undefined);
      setError("Could not update workspace access. Refresh to try again.");
      events.close();
    });
    return () => {
      active = false;
      events.close();
    };
  }, [actor.workspaceId]);
  const devices = view === "devices";
  return (
    <section className={devices ? "py-6 sm:py-8" : "py-8 sm:py-12"}>
      <div
        className={`${devices ? "mb-6" : "mb-8"} flex flex-wrap items-start justify-between gap-5`}
      >
        <div>
          <h1 className="text-page-title">{devices ? "Devices" : "Team"}</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {devices
              ? "Connect a capture device or open a live view of your space."
              : "The people who have access to your workspace."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={RotateCw}
            loading={refreshing}
            disabled={refreshing}
            onClick={() => {
              void refresh(devices ? "Devices refreshed." : "Team refreshed.").catch((error) =>
                setError(message(error)),
              );
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          {owner && (
            <Button icon={Plus} onClick={() => setAction({ kind: devices ? "pair" : "invite" })}>
              {devices ? "Add device" : "Invite member"}
            </Button>
          )}
        </div>
      </div>
      {devices && <DeviceHealthPanel />}
      <div className={devices && owner ? "grid items-start gap-8" : ""}>
        <section aria-label={devices ? "Paired devices" : "Team members"} className="min-w-0">
          {devices && (
            <div className="mb-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold tracking-tight">Paired devices</h2>
                {team && (
                  <Badge
                    variant="secondary"
                    aria-label={`${team.devices.length} ${team.devices.length === 1 ? "device" : "devices"}`}
                  >
                    {team.devices.length}
                  </Badge>
                )}
              </div>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Pairing grants workspace access. Start capture on a device before opening Live view.
              </p>
            </div>
          )}
          {viewing && devices && <LiveView device={viewing} onClose={() => setViewing(null)} />}
          {!owner && (
            <p className="mb-6 text-sm text-muted-foreground">
              Only your workspace owner can{" "}
              {devices ? "add devices or remove their access" : "invite or remove team members"}.
            </p>
          )}
          {notice && <output className="block mb-5 text-sm text-resolved">{notice}</output>}
          {liveError && (
            <output className="mb-5 block text-sm text-muted-foreground">
              Live updates interrupted. Use Refresh to load the latest list.
            </output>
          )}
          {error && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <ActionForm
                submit="Try again"
                pendingLabel="Trying again…"
                variant="secondary"
                icon={RotateCw}
                action={async () => {
                  await refresh("");
                }}
              />
            </div>
          )}
          {!team && !error && <LoadingState label={`Loading ${devices ? "devices" : "team"}…`} />}
          {team &&
            (devices ? (
              team.devices.length === 0 ? (
                <div className="rounded-2xl bg-card px-6 py-14 text-center">
                  <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                    <Monitor aria-hidden="true" className="size-6" />
                  </span>
                  <h2 className="font-medium">No devices connected</h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {owner
                      ? "Add a device to give it access to this workspace. You’ll connect it using a short pairing code."
                      : "Ask your workspace owner to connect a device."}
                  </p>
                  {owner && (
                    <Button
                      variant="secondary"
                      className="mt-6"
                      icon={Plus}
                      onClick={() => setAction({ kind: "pair" })}
                    >
                      Connect your first device
                    </Button>
                  )}
                </div>
              ) : (
                <div className="border-y border-border">
                  <ul className="divide-y divide-border">
                    {team.devices.map((device) => (
                      <li
                        key={device.id}
                        className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                            <Monitor aria-hidden="true" className="size-5" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-medium [overflow-wrap:anywhere]">
                                {device.name}
                              </p>
                              <Badge
                                variant="secondary"
                                className={
                                  device.revokedAt === null
                                    ? "bg-signal/10 text-signal"
                                    : "text-muted-foreground"
                                }
                              >
                                {device.revokedAt === null ? "Paired" : "Access removed"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {device.revokedAt === null
                                ? "Authorized for this workspace"
                                : "Pair again to reconnect"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ps-0">
                          {device.revokedAt === null && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={Video}
                              aria-label={`Live view of ${device.name}`}
                              onClick={() => setViewing({ id: device.id, name: device.name })}
                            >
                              Live view
                            </Button>
                          )}
                          {owner && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={RotateCw}
                              aria-label={`Reconnect ${device.name}`}
                              onClick={() =>
                                setAction({ kind: "reconnect", id: device.id, name: device.name })
                              }
                            >
                              Reconnect
                            </Button>
                          )}
                          {owner && device.revokedAt === null ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Trash2}
                              className="text-muted-foreground"
                              aria-label={`Remove access for ${device.name}`}
                              onClick={() =>
                                setAction({
                                  kind: "revoke-device",
                                  id: device.id,
                                  name: device.name,
                                })
                              }
                            >
                              Remove access
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {team.members.map((person) => (
                  <li
                    key={person.userId}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
                        <Users className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">
                          {person.name}
                          {person.userId === actor.userId && (
                            <span className="ml-2 text-xs text-muted-foreground">You</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {person.role === "owner" ? "Owner" : "Operator"}
                        </p>
                      </div>
                    </div>
                    {owner && person.role === "operator" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        className="text-muted-foreground"
                        aria-label={`Remove ${person.name}`}
                        onClick={() =>
                          setAction({ kind: "remove-member", id: person.userId, name: person.name })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </section>
        {devices && owner && (
          <section
            aria-labelledby="this-browser-title"
            className="min-w-0 border-t border-border pt-6"
          >
            <h2 id="this-browser-title" className="text-lg font-semibold tracking-tight">
              This browser
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Workspace management</p>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              Use this browser’s camera or a local video as a capture source.
            </p>
            <div className="mt-4">
              <DeviceModeAction
                actor={actor}
                onActivated={onChanged}
                compact={false}
                label="Use this device instead"
              />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Your workspace login stays signed in. Returning here keeps this device paired.
            </p>
          </section>
        )}
      </div>
      {action && owner && (
        <WorkspaceActions
          action={action}
          onClose={() => setAction(null)}
          onChanged={refresh}
          onActivated={onChanged}
        />
      )}
    </section>
  );
}
