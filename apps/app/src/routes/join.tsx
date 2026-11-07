import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AccessApp } from "@/components/access/app";

export const Route = createFileRoute("/join")({
  validateSearch: z.object({
    token: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .catch(undefined),
  }),
  component: Join,
});
function Join() {
  const { token } = Route.useSearch();
  return <AccessApp invitation={token} />;
}
