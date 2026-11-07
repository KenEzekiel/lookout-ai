import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const server = setupServer(
  http.get("/api/health/operator", () =>
    HttpResponse.json({ serverTime: Date.now(), devices: [] }),
  ),
  http.post("/api/health/report", () => HttpResponse.json({ receivedAt: Date.now() })),
  http.get("/api/incidents/alerts", () => HttpResponse.json({ incidents: [] })),
);
