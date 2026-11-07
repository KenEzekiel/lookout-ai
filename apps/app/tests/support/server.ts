import { setupServer } from "msw/node";
import { http, HttpResponse, sse } from "msw";
import { EventSource } from "eventsource";

Object.assign(globalThis, { EventSource });

export const server = setupServer(
  http.get("/api/incidents/alerts", () => HttpResponse.json({ incidents: [] })),
  sse("/api/access/team/events", () => {}),
);
