import { useEffect, useState } from "react";
import { z } from "zod";
import { type Member, teamSchema, inviteSchema } from "@/lib/access";
import { mutate, request, message } from "@/lib/api";
import { ActionForm, Field, Panel } from "./forms";

export function Workspace({ actor, onChanged }: { actor: Member; onChanged: () => Promise<void> }) {
  const [team, setTeam] = useState<z.infer<typeof teamSchema>>();
  const [invite, setInvite] = useState<z.infer<typeof inviteSchema>>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const owner = actor.role === "owner";
  async function refresh() {
    const next = await request("/api/access/team", teamSchema);
    setTeam(next);
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
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Panel title="Team">
        <p className="mb-4 text-sm text-muted-foreground">
          Signed in as {actor.name}. Your role is {actor.role}.
        </p>
        {error && <p role="alert">{error}</p>}
        {!team && !error && <output>Loading team…</output>}
        <ul className="grid gap-3">
          {team?.members.map((person) => (
            <li
              key={person.userId}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"
            >
              <span>
                {person.name}
                <span className="ml-2 text-xs text-muted-foreground">{person.role}</span>
              </span>
              {owner && person.role === "operator" && (
                <ActionForm
                  submit={`Remove ${person.name}`}
                  action={async () => {
                    await mutate("/api/access/remove-member", { id: person.userId });
                    await refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Monitoring devices">
        <p className="mb-4 text-sm text-muted-foreground">
          Paired devices can monitor all sources in this workspace.
        </p>
        {team?.devices.length === 0 && <p className="text-sm">No devices paired yet.</p>}
        <ul className="grid gap-3">
          {team?.devices.map((device) => (
            <li key={device.id} className="grid gap-2 border-b border-border pb-3">
              <span>
                {device.name}{" "}
                <span className="text-xs text-muted-foreground">
                  {device.revokedAt === null ? "Paired" : "Revoked"}
                </span>
              </span>
              {owner && device.revokedAt === null && (
                <ActionForm
                  submit={`Revoke ${device.name}`}
                  action={async () => {
                    await mutate("/api/access/devices/revoke", { id: device.id });
                    await refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
      {owner && (
        <Panel title="Invite an operator">
          <p className="mb-4 text-sm text-muted-foreground">
            Share a link or six-digit code. Either can be used once, within 15 minutes.
          </p>
          <ActionForm
            submit="Create invitation"
            action={async () => {
              setInvite(await request("/api/access/invitations", inviteSchema, {}));
            }}
          />
          {invite && (
            <output className="mt-5 grid gap-3">
              <p className="text-3xl font-semibold tracking-widest">{invite.code}</p>
              <label className="grid gap-2 text-sm">
                Invitation link
                <input
                  aria-label="Invitation link"
                  readOnly
                  value={`${window.location.origin}/join?token=${invite.token}`}
                  onFocus={(event) => event.target.select()}
                  className="w-full rounded border border-input bg-background p-2"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Expires {new Date(invite.expiresAt).toLocaleTimeString()}.
              </p>
            </output>
          )}
        </Panel>
      )}
      {owner && (
        <Panel title="Pair another browser">
          <p className="mb-4 text-sm text-muted-foreground">
            Open “Pair a monitoring browser” on the device, then enter its code here.
          </p>
          <ActionForm
            submit="Approve device"
            action={async (data) => {
              await mutate("/api/access/pairing/approve", {
                code: data.get("code"),
                name: data.get("name"),
              });
              setNotice("Device approved. It can now connect.");
              await refresh();
            }}
          >
            <Field label="Device name" name="name" maxLength={80} />
            <Field label="Device pairing code" name="code" pattern="[0-9]{6}" maxLength={6} />
          </ActionForm>
          {notice && <output className="mt-3 text-sm">{notice}</output>}
        </Panel>
      )}
      {owner && (
        <Panel title="Use this browser to monitor">
          <p className="mb-4 text-sm text-muted-foreground">
            This signs you out across this browser’s tabs and switches to restricted device access.
            Keep the monitoring tab active. Sign in again to return to owner controls.
          </p>
          <ActionForm
            submit="Switch to monitoring mode"
            action={async (data) => {
              await mutate("/api/access/devices/activate", { name: data.get("name") });
              await onChanged();
            }}
          >
            <Field label="This device’s name" name="name" maxLength={80} />
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}
