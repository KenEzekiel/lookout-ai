import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request) {
  const { endpoint, json } = await import("@/server/http");
  const { syncDevice, stopSource, openView, pollView, offerView, answerView, closeView } =
    await import("@/server/peer");
  const handlers: Record<string, (request: Request) => Promise<Response>> = {
    device: syncDevice,
    stop: stopSource,
    open: openView,
    poll: pollView,
    offer: offerView,
    answer: answerView,
    close: closeView,
  };
  return endpoint(request, async () => {
    const path = new URL(request.url).pathname.replace("/api/peer/", "");
    const handler = handlers[path];
    return handler ? handler(request) : json({ message: "Not found." }, 404);
  });
}
export const Route = createFileRoute("/api/peer/$")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
