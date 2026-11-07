import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request) {
  const { endpoint, json } = await import("@/server/http");
  const { reportHealth, operatorHealth } = await import("@/server/device-health");
  return endpoint(request, async () => {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/api/health/report") return reportHealth(request);
    if (request.method === "GET" && path === "/api/health/operator") return operatorHealth(request);
    return json({ message: "Not found." }, 404);
  });
}

export const Route = createFileRoute("/api/health/$")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
