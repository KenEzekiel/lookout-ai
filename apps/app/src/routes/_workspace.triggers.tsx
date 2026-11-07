import { createFileRoute } from "@tanstack/react-router";
import { RuleWorkspace } from "@/components/rules/workspace";

export const Route = createFileRoute("/_workspace/triggers")({
  component: () => (
    <section className="py-8 sm:py-12">
      <RuleWorkspace />
    </section>
  ),
});
