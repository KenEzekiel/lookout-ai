import { mutate } from "@/lib/api";
import { ActionForm, Field, Panel } from "./forms";

export function Onboarding({
  invitation,
  onJoined,
}: {
  invitation?: string;
  onJoined: () => Promise<void>;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Panel title="Create a workspace">
        <p className="mb-5 text-sm text-muted-foreground">
          You will own this workspace and manage access for your team.
        </p>
        <ActionForm
          submit="Create workspace"
          action={async (data) => {
            await mutate("/api/access/workspace", { name: data.get("name") });
            await onJoined();
          }}
        >
          <Field label="Workspace name" name="name" maxLength={80} />
        </ActionForm>
      </Panel>
      <Panel title="Join your team">
        <p className="mb-5 text-sm text-muted-foreground">
          Each account belongs to one workspace. Joining gives you operator access.
        </p>
        <ActionForm
          submit={invitation ? "Accept invitation" : "Join workspace"}
          action={async (data) => {
            await mutate(
              "/api/access/join",
              invitation ? { token: invitation } : { code: data.get("code") },
            );
            await onJoined();
          }}
        >
          {invitation ? (
            <p className="text-sm">An invitation link is ready to redeem.</p>
          ) : (
            <Field label="Invitation code" name="code" pattern="[0-9]{6}" maxLength={6} />
          )}
        </ActionForm>
      </Panel>
    </div>
  );
}
