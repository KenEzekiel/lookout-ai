import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { mutate } from "@/lib/api";
import { ActionForm, Field, Panel } from "./forms";

export function Onboarding({
  invitation,
  onJoined,
}: {
  invitation?: string;
  onJoined: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"create" | "code" | "invitation">(
    invitation ? "invitation" : "create",
  );
  const creating = mode === "create";
  return (
    <Panel title={creating ? "Set up your workspace" : "Join your team"}>
      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        {creating
          ? "Create a space for your team and devices."
          : mode === "invitation"
            ? "Your invitation is ready. Join to access your team’s workspace."
            : "Enter the six-digit invitation code shared by your workspace owner."}
      </p>
      <ActionForm
        key={mode}
        icon={creating ? Plus : Users}
        submit={creating ? "Create workspace" : "Join workspace"}
        pendingLabel={creating ? "Creating workspace…" : "Joining workspace…"}
        action={async (data) => {
          if (creating) await mutate("/api/access/workspace", { name: data.get("name") });
          else
            await mutate(
              "/api/access/join",
              mode === "invitation" ? { token: invitation } : { code: data.get("code") },
            );
          await onJoined();
        }}
      >
        {creating ? (
          <Field
            label="Workspace name"
            name="name"
            maxLength={80}
            placeholder="e.g. Westside studio"
          />
        ) : mode === "code" ? (
          <Field
            label="Invitation code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="6-digit code"
            hint="Invitations can be used once and expire after 15 minutes."
          />
        ) : null}
      </ActionForm>
      <div className="mt-8 grid gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
        {creating ? (
          <>
            <p>Invited by someone?</p>
            <Button
              variant="link"
              size="inline"
              icon={Users}
              className="justify-start text-signal"
              onClick={() => setMode("code")}
            >
              Join with an invitation code
            </Button>
          </>
        ) : (
          <>
            {mode === "invitation" && (
              <Button
                variant="link"
                size="inline"
                icon={Users}
                className="justify-start text-signal"
                onClick={() => setMode("code")}
              >
                Use an invitation code instead
              </Button>
            )}
            <Button
              variant="link"
              size="inline"
              icon={Plus}
              className="justify-start text-signal"
              onClick={() => setMode("create")}
            >
              Create a workspace instead
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}
