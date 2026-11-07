import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request) {
  const { endpoint, json } = await import("@/server/http");
  const {
    operatorConfiguration,
    deviceConfiguration,
    createSource,
    createRule,
    updateRule,
    disableRule,
  } = await import("@/server/rules");
  const handlers: Record<string, (request: Request) => Promise<Response>> = {
    "GET operator": operatorConfiguration,
    "GET device": deviceConfiguration,
    "POST sources": createSource,
    "POST rules/create": createRule,
    "POST rules/update": updateRule,
    "POST rules/disable": disableRule,
  };
  return endpoint(request, async () => {
    const path = new URL(request.url).pathname.replace("/api/config/", "");
    const handler = handlers[`${request.method} ${path}`];
    return handler ? handler(request) : json({ message: "Not found." }, 404);
  });
}
export const Route = createFileRoute("/api/config/$")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
