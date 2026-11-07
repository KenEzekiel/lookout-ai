import { readTeam } from "./workspaces";

export async function teamEvents(request: Request) {
  let snapshot = JSON.stringify(await readTeam(request));
  const encoder = new TextEncoder();
  let stopped = false;
  let polls = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  function stop() {
    stopped = true;
    clearTimeout(timer);
    wake?.();
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: 3000\ndata: ${snapshot}\n\n`));
    },
    async pull(controller) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, 5000);
      });
      if (stopped) return;
      try {
        const next = JSON.stringify(await readTeam(request));
        if (stopped) return;
        controller.enqueue(
          encoder.encode(next === snapshot ? ": heartbeat\n\n" : `data: ${next}\n\n`),
        );
        snapshot = next;
        if (++polls === 5) {
          stop();
          controller.close();
        }
      } catch {
        if (stopped) return;
        stop();
        controller.enqueue(encoder.encode("event: unavailable\ndata: {}\n\n"));
        controller.close();
      }
    },
    cancel: stop,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
