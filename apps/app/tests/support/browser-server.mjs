import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createTestHarness } from "wrangler";

const origin = "http://127.0.0.1:4173";
const harness = createTestHarness({
  workers: [
    {
      configPath: "./dist/server/wrangler.json",
      vars: { APP_URL: origin },
      secrets: { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") },
    },
  ],
});
await harness.listen();
await harness.getWorker().applyD1Migrations("DB");
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const response = await harness.fetch(new URL(incoming.url ?? "/", origin).href, {
      method: incoming.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
    });
    outgoing.writeHead(response.status, {
      ...Object.fromEntries([...response.headers].filter(([name]) => name !== "set-cookie")),
      "set-cookie": response.headers.getSetCookie(),
    });
    outgoing.flushHeaders();
    const reader = response.body?.getReader();
    outgoing.on("close", () => void reader?.cancel().catch(() => {}));
    if (reader) {
      while (!outgoing.destroyed) {
        const { done, value } = await reader.read();
        if (done) break;
        outgoing.write(value);
      }
    }
    outgoing.end();
  } catch {
    outgoing.writeHead(500);
    outgoing.end("Browser test server failed.");
  }
});
server.listen(4173, "127.0.0.1");
async function close() {
  server.close();
  await harness.close();
}
process.once("SIGTERM", close);
process.once("SIGINT", close);
