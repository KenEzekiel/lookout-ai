import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Monitor as MonitorIcon } from "lucide-react";
import { type z } from "zod";
import { type DevicePrincipal, pairingSchema, pairingStatusSchema } from "@/lib/access";
import { type DeviceConfiguration, deviceConfigurationSchema } from "@/lib/rules";
import { mutate, request, message } from "@/lib/api";
import { ActionForm, Panel } from "./forms";

export function PairBrowser({
  signedIn,
  onPaired,
}: {
  signedIn: boolean;
  onPaired: () => Promise<void>;
}) {
  const [pairing, setPairing] = useState<z.infer<typeof pairingSchema>>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!pairing) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const status = await request("/api/access/pairing/claim", pairingStatusSchema, {});
        if (stopped) return;
        if (status.status === "paired") {
          await onPaired();
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch (error) {
        if (!stopped) setError(message(error));
      }
    }
    timer = setTimeout(poll, 2500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pairing, onPaired]);
  return (
    <Panel title="Set up this device">
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        Connect this device to your team’s workspace. You don’t need the owner’s password.
      </p>
      {signedIn && (
        <p className="mb-6 rounded-lg bg-card p-4 text-sm leading-relaxed text-muted-foreground">
          Once approved, this signs you out of workspace management in every tab of this browser.
          You can sign in again to return.
        </p>
      )}
      {pairing && !error && (
        <div className="mb-6 rounded-xl bg-card p-6 text-center">
          <p className="mb-3 text-xs text-muted-foreground">Pairing code</p>
          <output
            aria-label="Pairing code"
            className="block text-4xl font-semibold tabular-nums tracking-[0.15em]"
          >
            {pairing.code}
          </output>
          <p className="mt-4 text-sm">Waiting for your workspace owner</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Expires at{" "}
            {new Date(pairing.expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      )}
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        Ask your workspace owner to open{" "}
        <span className="text-foreground">Devices → Add device</span> on their own device and enter
        your code. Keep this page open while they connect it.
      </p>
      {error && (
        <p role="alert" className="mb-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <ActionForm
        submit={pairing ? "Get a new code" : "Get pairing code"}
        pendingLabel="Getting code…"
        variant={pairing && !error ? "secondary" : "default"}
        action={async () => {
          const next = await request("/api/access/pairing/start", pairingSchema, {});
          setError("");
          setPairing(next);
        }}
      />
    </Panel>
  );
}
export function Monitor({ actor }: { actor: DevicePrincipal }) {
  const [error, setError] = useState("");
  const [configuration, setConfiguration] = useState<DeviceConfiguration>();
  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const next = await request("/api/config/device", deviceConfigurationSchema);
        if (!stopped) {
          setConfiguration(next);
          setError("");
        }
      } catch (error) {
        if (!stopped) {
          setConfiguration(undefined);
          setError(message(error));
        }
      }
    }
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return (
    <Panel title={error ? "Device access unavailable" : "Device connected"}>
      <div className="my-6 flex items-center gap-4 rounded-xl bg-card p-5">
        <MonitorIcon className="size-6 shrink-0 text-signal" />
        <div className="min-w-0">
          <p className="break-words font-medium">{actor.name}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{actor.workspaceName}</p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {error}
        </p>
      ) : (
        <output className="block mb-6 text-sm leading-relaxed text-muted-foreground">
          This device is connected. Open the capture station to choose a camera or local video. AI
          detection and automatic device reports are not available yet.
        </output>
      )}
      {!error && (
        <Link
          to="/device"
          className="mb-3 flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Open capture station
        </Link>
      )}
      {!error && (
        <section aria-label="Device configuration" className="mb-6 grid gap-4">
          <h3 className="font-semibold">Sources and trigger versions</h3>
          {!configuration ? (
            <output>Loading configuration…</output>
          ) : configuration.sources.length === 0 ? (
            <p className="text-sm">No sources configured yet.</p>
          ) : (
            configuration.sources.map((source) => (
              <article key={source.id} className="rounded-lg border border-border p-4">
                <h4 className="font-medium">{source.name}</h4>
                <p className="mb-3 text-sm text-muted-foreground">
                  {source.kind === "camera" ? "Live camera" : "Replayed footage"}
                </p>
                {configuration.rules.filter((rule) => rule.sourceId === source.id).length === 0 && (
                  <p className="text-sm">No triggers assigned.</p>
                )}
                <ul className="grid gap-3 text-sm">
                  {configuration.rules
                    .filter((rule) => rule.sourceId === source.id)
                    .map((rule) => (
                      <li key={rule.id}>
                        {rule.definition.name} · {rule.enabled ? "Enabled" : "Disabled"} · Version{" "}
                        {rule.version}
                      </li>
                    ))}
                </ul>
              </article>
            ))
          )}
          <p className="text-sm text-muted-foreground">
            Configuration refreshes every five seconds. These are received settings, not
            confirmation of active monitoring.
          </p>
          <ActionForm
            submit="Refresh configuration"
            pendingLabel="Refreshing configuration…"
            variant="secondary"
            action={async () => {
              try {
                setConfiguration(await request("/api/config/device", deviceConfigurationSchema));
                setError("");
              } catch (error) {
                setConfiguration(undefined);
                setError(message(error));
                throw error;
              }
            }}
          />
        </section>
      )}
      <ActionForm
        submit="Return to sign in"
        pendingLabel="Returning to sign in…"
        variant="secondary"
        action={async () => {
          await mutate("/api/access/devices/leave");
          window.location.assign("/");
        }}
      />
    </Panel>
  );
}
