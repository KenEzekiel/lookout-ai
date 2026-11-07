import { createContext, useContext } from "react";
import type { Member } from "@/lib/access";
import { Workspace } from "./workspace";

export const WorkspaceContext = createContext<{
  actor: Member;
  onChanged: () => Promise<void>;
} | null>(null);

export function WorkspacePage({ view }: { view: "devices" | "team" }) {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace pages require member access");
  return (
    <>
      <p className="mt-5 break-words text-sm text-muted-foreground sm:hidden">
        {workspace.actor.workspaceName}
      </p>
      <Workspace actor={workspace.actor} view={view} onChanged={workspace.onChanged} />
    </>
  );
}
