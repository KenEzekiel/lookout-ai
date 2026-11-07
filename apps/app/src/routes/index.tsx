import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AccessApp } from "@/components/access/app";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ view: z.enum(["devices", "team"]).optional().catch(undefined) }),
  component: Home,
});

function Home() {
  const { view } = Route.useSearch();
  return <AccessApp view={view} />;
}
