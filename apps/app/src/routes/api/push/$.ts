import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request) {
  const { endpoint, json } = await import("@/server/http");
  const { pushSettings, savePushSubscription, removePushSubscription } =
    await import("@/server/push");
  return endpoint(request, async () => {
    const path = new URL(request.url).pathname.replace("/api/push/", "");
    if (request.method === "GET" && path === "settings") return pushSettings(request);
    if (request.method === "POST" && path === "subscribe") return savePushSubscription(request);
    if (request.method === "POST" && path === "unsubscribe") return removePushSubscription(request);
    return json({ message: "Not found." }, 404);
  });
}
export const Route = createFileRoute("/api/push/$")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
