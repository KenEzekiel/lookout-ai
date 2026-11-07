import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePage } from "@/components/access/workspace-context";

export const Route = createFileRoute("/_workspace/devices")({
  component: () => <WorkspacePage view="devices" />,
});
