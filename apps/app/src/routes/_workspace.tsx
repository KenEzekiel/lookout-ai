import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccessApp } from "@/components/access/app";

export const Route = createFileRoute("/_workspace")({ component: WorkspaceLayout });

function WorkspaceLayout() {
  return (
    <AccessApp>
      <Outlet />
    </AccessApp>
  );
}
