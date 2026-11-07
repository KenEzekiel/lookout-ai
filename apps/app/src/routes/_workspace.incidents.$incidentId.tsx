import { createFileRoute } from "@tanstack/react-router";
import { IncidentDetail } from "@/components/incidents/workspace";

export const Route = createFileRoute("/_workspace/incidents/$incidentId")({
  component: IncidentRoute,
});

function IncidentRoute() {
  const { incidentId } = Route.useParams();
  return (
    <section className="py-8 sm:py-12">
      <IncidentDetail key={incidentId} id={incidentId} />
    </section>
  );
}
