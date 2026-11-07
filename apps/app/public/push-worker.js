self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let incidentId;
  try {
    incidentId = event.data?.json()?.incidentId;
  } catch {
    return;
  }
  if (typeof incidentId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(incidentId)) return;
  event.waitUntil(
    self.registration.showNotification("Lookout needs your attention", {
      body: "Open Lookout to review an incident. Sign in may be required.",
      tag: `lookout-${incidentId}`,
      icon: "/icon-192.png",
      data: { incidentId },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const incidentId = event.notification.data?.incidentId;
  if (typeof incidentId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(incidentId)) return;
  const url = new URL(`/incidents/${encodeURIComponent(incidentId)}`, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
          const navigated = await client.navigate(url);
          if (navigated) return navigated.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
