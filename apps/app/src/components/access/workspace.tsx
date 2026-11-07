import { LoadingState } from "@/components/ui/loading";
import { useEffect, useState } from "react";
import { Monitor, Plus, RotateCw, Trash2, Users, Video } from "lucide-react";
import { type z } from "zod";
import { type Member, teamSchema } from "@/lib/access";
import { request, message } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ActionForm } from "./forms";
import { LiveView } from "@/components/live-view";
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
  const [action, setAction] = useState<WorkspaceAction | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const owner = actor.role === "owner";
  async function refresh(notice: string) {
    setTeam(await request("/api/access/team", teamSchema));
    setError("");
    setNotice(notice);
  }
  useEffect(() => {
    let active = true;
    void request("/api/access/team", teamSchema)
      .then((next) => {
        if (active) setTeam(next);
      })
      .catch((error) => {
        if (active) setError(message(error));
      });
    return () => {
      active = false;
    };
  }, [actor.workspaceId]);
  const devices = view === "devices";
  return (
    <section className="py-8 sm:py-12">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{devices ? "Devices" : "Team"}</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {devices
              ? "Manage the devices connected to your workspace."
              : "The people who have access to your workspace."}
          </p>
        </div>
        {owner && (
          <Button icon={Plus} onClick={() => setAction({ kind: devices ? "pair" : "invite" })}>
            {devices ? "Add device" : "Invite member"}
          </Button>
        )}
      </div>
      {viewing && devices && <LiveView device={viewing} onClose={() => setViewing(null)} />}
      {devices && (
        <p className="mb-6 rounded-lg bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          Paired devices can capture a camera or local video. Automatic AI detection and device
          reports are not available yet.
        </p>
      )}
      {!owner && (
        <p className="mb-6 text-sm text-muted-foreground">
          Only your workspace owner can{" "}
          {devices ? "add devices or remove their access" : "invite or remove team members"}.
        </p>
      )}
      {notice && <output className="block mb-5 text-sm text-resolved">{notice}</output>}
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
            <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
              <Monitor className="mx-auto mb-4 size-7 text-muted-foreground" />
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
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 bg-card px-5 py-3 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_90px_300px]">
                <span>Device</span>
                <span>Access</span>
                <span className="hidden sm:block" />
              </div>
              <ul className="divide-y divide-border">
                {team.devices.map((device) => (
                  <li
                    key={device.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_90px_300px]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Monitor className="hidden size-5 shrink-0 text-muted-foreground sm:block" />
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{device.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {device.revokedAt === null
                            ? "Authorized for this workspace"
                            : "Pair again to reconnect"}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {device.revokedAt === null ? "Paired" : "Access removed"}
                    </span>
                    <div className="col-span-2 flex flex-wrap justify-end gap-2 sm:col-span-1">
                      {device.revokedAt === null && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={Video}
                          aria-label={`Live view of ${device.name}`}
                          onClick={() => setViewing({ id: device.id, name: device.name })}
                        >
                          Live view
                        </Button>
                      )}
                      {owner && device.revokedAt === null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          className="col-span-2 justify-self-end text-muted-foreground sm:col-span-1"
                          aria-label={`Remove access for ${device.name}`}
                          onClick={() =>
                            setAction({ kind: "revoke-device", id: device.id, name: device.name })
                          }
                        >
                          Remove access
                        </Button>
                      ) : (
                        <span className="hidden sm:block" />
                      )}
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
      {devices && owner && (
        <div className="mt-8">
          <Button
            variant="link"
            size="inline"
            icon={Monitor}
            className="text-signal"
            onClick={() => setAction({ kind: "activate" })}
          >
            Use this device instead
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Switch this browser from workspace management to device mode.
          </p>
        </div>
      )}
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
