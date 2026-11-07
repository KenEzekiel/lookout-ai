import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request) {
  const { endpoint, json } = await import("@/server/http");
  const {
    startIncidentSession,
    endIncidentSession,
    reportIncident,
    incidentInbox,
    incomingIncidents,
    incidentDetail,
    commandIncident,
  } = await import("@/server/incidents");
  return endpoint(request, async () => {
    const path = new URL(request.url).pathname.replace("/api/incidents/", "");
    if (request.method === "POST" && path === "sessions") return startIncidentSession(request);
    if (request.method === "POST" && path === "sessions/end") return endIncidentSession(request);
    if (request.method === "POST" && path === "reports") return reportIncident(request);
    if (request.method === "GET" && path === "inbox") return incidentInbox(request);
    if (request.method === "GET" && path === "alerts") return incomingIncidents(request);
    const [area, id, ...rest] = path.split("/");
    if (id && rest.length === 0) {
      if (request.method === "GET" && area === "detail") return incidentDetail(request, id);
      if (request.method === "POST" && area === "commands") return commandIncident(request, id);
    }
    return json({ message: "Not found." }, 404);
  });
}
export const Route = createFileRoute("/api/incidents/$")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
