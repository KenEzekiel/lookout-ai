import { useEffect, useState } from "react";
import { z } from "zod";
import {
  type DevicePrincipal,
  devicePrincipalSchema,
  pairingSchema,
  pairingStatusSchema,
} from "@/lib/access";
import { mutate, request, message } from "@/lib/api";
import { ActionForm, Panel } from "./forms";

export function PairBrowser({ onPaired }: { onPaired: () => Promise<void> }) {
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
    <div className="mx-auto max-w-lg">
      <Panel title="Pair this monitoring browser">
        <p className="mb-5 text-sm text-muted-foreground">
          The workspace owner enters this code on their own device and gives this browser a name.
          You do not need the owner’s password here.
        </p>
        <ActionForm
          submit={pairing ? "Generate a new code" : "Generate pairing code"}
          action={async () => {
            setError("");
            setPairing(await request("/api/access/pairing/start", pairingSchema, {}));
          }}
        />
        {pairing && (
          <output className="mt-6 text-center">
            <p className="text-4xl font-semibold tracking-widest">{pairing.code}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Waiting for owner approval. Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
              .
            </p>
          </output>
        )}
        {error && (
          <p role="alert" className="mt-4 text-destructive">
            {error}
          </p>
        )}
      </Panel>
    </div>
  );
}
export function Monitor({ actor }: { actor: DevicePrincipal }) {
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        await request("/api/access/devices/status", devicePrincipalSchema);
        if (!stopped) setError("");
      } catch (error) {
        if (!stopped) setError(message(error));
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
    <div className="mx-auto max-w-lg">
      <Panel title={error ? "Device access unavailable" : "Monitoring device paired"}>
        <p className="mb-4 text-lg">{actor.name}</p>
        <p className="mb-5 text-sm text-muted-foreground">{actor.workspaceName}</p>
        {error ? (
          <p role="alert" className="mb-5 text-destructive">
            {error}
          </p>
        ) : (
          <output className="mb-5 text-sm">
            Authorized for this workspace’s sources. Source capture is not connected yet. Keep this
            browser active when monitoring is available.
          </output>
        )}
        <ActionForm
          submit="Return to sign in"
          action={async () => {
            await mutate("/api/access/devices/leave");
            window.location.assign("/");
          }}
        />
      </Panel>
    </div>
  );
}
