import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const server = setupServer(
  http.get("/api/incidents/alerts", () => HttpResponse.json({ incidents: [] })),
);
