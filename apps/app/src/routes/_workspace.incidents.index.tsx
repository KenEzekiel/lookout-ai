import { createFileRoute } from "@tanstack/react-router";
import { IncidentInbox } from "@/components/incidents/workspace";

export const Route = createFileRoute("/_workspace/incidents/")({
  component: () => (
    <section className="py-8 sm:py-12">
      <IncidentInbox />
    </section>
  ),
});
