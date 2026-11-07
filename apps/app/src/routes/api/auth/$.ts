import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { auth } = await import("@/server/auth");
        return auth().handler(request);
      },
      POST: async ({ request }) => {
        const { auth } = await import("@/server/auth");
        const { pairingCookie } = await import("@/server/access");
        const { setCookie } = await import("@/server/http");
        const response = await auth().handler(request);
        const path = new URL(request.url).pathname;
        if (response.ok && ["/api/auth/sign-in/email", "/api/auth/sign-up/email"].includes(path)) {
          response.headers.append("Set-Cookie", setCookie(pairingCookie, "", 0));
        }
        return response;
      },
    },
  },
});
