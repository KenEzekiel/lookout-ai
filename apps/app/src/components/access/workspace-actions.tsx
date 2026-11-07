import { useState } from "react";
import { type z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { inviteSchema } from "@/lib/access";
import { mutate, request } from "@/lib/api";
import { ActionForm, Field } from "./forms";

export type WorkspaceAction =
  | { kind: "invite" }
  | { kind: "pair" }
  | { kind: "activate" }
  | { kind: "remove-member"; id: string; name: string }
  | { kind: "revoke-device"; id: string; name: string };

export function WorkspaceActions({
  action,
  onClose,
  onChanged,
  onActivated,
}: {
  action: WorkspaceAction;
  onClose: () => void;
  onChanged: (notice: string) => Promise<void>;
  onActivated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [invite, setInvite] = useState<z.infer<typeof inviteSchema>>();
  const [copyNotice, setCopyNotice] = useState("");
  const content = {
    invite: {
      title: "Invite a team member",
      description:
        "Share an invitation with someone you trust. They can access your workspace, but only you can manage people and devices.",
    },
    pair: {
      title: "Connect another device",
      description:
        "On the other device, open Lookout and choose “Set up this device”. Enter the code shown there.",
    },
    activate: {
      title: "Use this device",
      description:
        "This signs you out of workspace management in every tab of this browser and switches to device mode. You can sign in again to return.",
    },
    "remove-member": {
      title: "Remove team member?",
      description: "They will lose access to this workspace. You can invite them again later.",
    },
    "revoke-device": {
      title: "Remove device access?",
      description:
        "This device will lose access to the workspace. To reconnect it, you’ll need to pair it again.",
    },
  }[action.kind];
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-md">
        <DialogTitle className="pr-6 text-xl font-semibold tracking-tight">
          {content.title}
        </DialogTitle>
        <DialogDescription className="mb-2 leading-relaxed">
          {content.description}
        </DialogDescription>
        {action.kind === "invite" ? (
          invite ? (
            <div className="grid gap-5">
              <Field
                label="Invitation link"
                readOnly
                value={`${window.location.origin}/join?token=${invite.token}`}
                onFocus={(event) => event.target.select()}
              />
              <Button
                className="h-11"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${window.location.origin}/join?token=${invite.token}`,
                    );
                    setCopyNotice("Invitation link copied.");
                  } catch {
                    setCopyNotice("Select the invitation link above to copy it manually.");
                  }
                }}
              >
                Copy invitation link
              </Button>
              {copyNotice && (
                <output className="block text-sm text-muted-foreground">{copyNotice}</output>
              )}
              <div className="rounded-lg bg-background p-4">
                <p className="text-xs text-muted-foreground">Or share this invitation code</p>
                <p className="mt-2 text-3xl font-semibold tracking-[0.18em]">{invite.code}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Can be used once. Expires at{" "}
                {new Date(invite.expiresAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                .
              </p>
            </div>
          ) : (
            <ActionForm
              submit="Create invitation"
              pendingLabel="Creating invitation…"
              action={async () =>
                setInvite(await request("/api/access/invitations", inviteSchema, {}))
              }
            >
              <p className="text-sm text-muted-foreground">
                The invitation link or code can be used once, within 15 minutes.
              </p>
            </ActionForm>
          )
        ) : action.kind === "pair" ? (
          <ActionForm
            submit="Connect device"
            pendingLabel="Connecting device…"
            action={async (data) => {
              await mutate("/api/access/pairing/approve", {
                name: data.get("name"),
                code: data.get("code"),
              });
              await onChanged(
                "Device approved. Keep Lookout open on the other device to finish connecting.",
              );
              setOpen(false);
            }}
          >
            <Field
              label="Device name"
              name="name"
              maxLength={80}
              placeholder="e.g. Front desk iPad"
            />
            <Field
              label="Pairing code"
              name="code"
              pattern="[0-9]{6}"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              hint="Codes expire after 5 minutes."
            />
          </ActionForm>
        ) : action.kind === "activate" ? (
          <ActionForm
            submit="Sign out and set up device"
            pendingLabel="Setting up device…"
            action={async (data) => {
              await mutate("/api/access/devices/activate", { name: data.get("name") });
              await onActivated();
            }}
          >
            <Field
              label="Device name"
              name="name"
              maxLength={80}
              placeholder="e.g. Reception laptop"
            />
          </ActionForm>
        ) : (
          <ActionForm
            submit={action.kind === "remove-member" ? "Remove member" : "Remove access"}
            pendingLabel="Removing access…"
            variant="destructive"
            action={async () => {
              await mutate(
                action.kind === "remove-member"
                  ? "/api/access/remove-member"
                  : "/api/access/devices/revoke",
                { id: action.id },
              );
              await onChanged(
                action.kind === "remove-member"
                  ? `${action.name} was removed from the team.`
                  : `Access removed for ${action.name}.`,
              );
              setOpen(false);
            }}
          >
            <p className="font-medium">{action.name}</p>
          </ActionForm>
        )}
        <DialogClose render={<Button variant="ghost" className="h-10" />}>
          {invite ? "Done" : "Cancel"}
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
