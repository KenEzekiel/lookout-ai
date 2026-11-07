import { createFileRoute } from "@tanstack/react-router";
import { AccessApp } from "@/components/access/app";

export const Route = createFileRoute("/incidents/$incidentId")({ component: IncidentRoute });
function IncidentRoute() {
  const { incidentId } = Route.useParams();
  return <AccessApp incidents incidentId={incidentId} />;
}
