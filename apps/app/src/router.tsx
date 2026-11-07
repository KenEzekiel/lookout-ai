import type {} from "@tanstack/react-start";
import { createRouter } from "@tanstack/react-router";
import { PageLoading } from "./components/ui/loading";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: ({ location }) => location.pathname !== "/" || !location.hash,
    defaultPendingComponent: PageLoading,
    defaultPendingMs: 200,
    defaultPendingMinMs: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
