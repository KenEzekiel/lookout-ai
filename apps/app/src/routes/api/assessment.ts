import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/assessment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { endpoint } = await import("@/server/http");
        const { assessment } = await import("@/server/assessment");
        return endpoint(request, () => assessment(request));
      },
    },
  },
});
