import { AccordionPanel } from "@/components/ui/accordion-panel";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { message, mutate, request } from "@/lib/api";
import { pushSettingsSchema } from "@/lib/push";

type Setup =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; publicKey: string; enabled: boolean };

export function PushSetup() {
  const [setup, setSetup] = useState<Setup>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function check() {
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && !window.matchMedia("(display-mode: standalone)").matches) {
        if (active)
          setSetup({
            kind: "unavailable",
            message:
              "On iPhone or iPad, use Safari to add Lookout to your Home Screen, open it there, then enable alerts. A supported iOS version is required.",
          });
        return;
      }
      if (
        !window.isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (active)
          setSetup({
            kind: "unavailable",
            message:
              "Background alerts are unavailable in this browser. Use a supported browser over HTTPS. Incoming alerts still work while Lookout is open.",
          });
        return;
      }
      if (Notification.permission === "denied") {
        if (active)
          setSetup({
            kind: "unavailable",
            message:
              "Notifications are blocked. Allow notifications in your browser or device settings, then reload Lookout.",
          });
        return;
      }
      const settings = await request("/api/push/settings", pushSettingsSchema);
      if (!settings.configured || !settings.publicKey) {
        if (active)
          setSetup({
            kind: "unavailable",
            message:
              "Background alerts are not configured on this server yet. Incoming alerts still work while Lookout is open.",
          });
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (active)
        setSetup({
          kind: "ready",
          publicKey: settings.publicKey,
          enabled: !!subscription && settings.endpoints.includes(subscription.endpoint),
        });
    }
    void check().catch((error) => {
      if (active) setSetup({ kind: "unavailable", message: message(error) });
    });
    return () => {
      active = false;
    };
  }, []);
  async function toggle() {
    if (setup.kind !== "ready") return;
    setPending(true);
    setError("");
    try {
      if (setup.enabled) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await mutate("/api/push/unsubscribe", { endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
        setSetup({ ...setup, enabled: false });
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError(
            permission === "denied"
              ? "Notifications are blocked. Allow them in browser settings, then reload Lookout."
              : "Permission was not granted. Choose Enable alerts to try again.",
          );
          return;
        }
        await navigator.serviceWorker.register("/push-worker.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const registration = await navigator.serviceWorker.ready;
        const bytes = Uint8Array.from(
          atob(setup.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
          (character) => character.charCodeAt(0),
        );
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: bytes,
          }));
        await mutate("/api/push/subscribe", subscription.toJSON());
        setSetup({ ...setup, enabled: true });
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="my-5 text-sm">
      <AccordionPanel title="Background alerts">
        <div className="mt-3 grid gap-3">
          <p className="max-w-2xl leading-relaxed text-muted-foreground">
            Enable notifications for this signed-in browser. Notifications show no incident details.
            Opening one does not acknowledge it. Delivery depends on your browser and device
            settings.
          </p>
          {setup.kind === "loading" ? (
            <output>Checking background alerts…</output>
          ) : setup.kind === "unavailable" ? (
            <output>{setup.message}</output>
          ) : (
            <>
              <output>
                {setup.enabled
                  ? "Background alerts are enabled for this browser session."
                  : "Background alerts are off for this browser session."}
              </output>
              <Button
                className="w-fit"
                variant="outline"
                disabled={pending}
                onClick={() => void toggle()}
              >
                {pending
                  ? "Updating alerts…"
                  : setup.enabled
                    ? "Turn off background alerts"
                    : "Enable alerts"}
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      </AccordionPanel>
    </div>
  );
}
