import { RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { mutate, request, message } from "@/lib/api";
import { peerSessionSchema, peerPollMs, peerNetworkMessage, peerAcceptedSchema } from "@/lib/peer";
import { createPeer, localDescription } from "@/lib/peer-connection";

type ViewState = { kind: "connecting" } | { kind: "live" } | { kind: "error"; message: string };

export function LiveView({
  device,
  onClose,
}: {
  device: { id: string; name: string };
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewState>({ kind: "connecting" });
  const [sourceKind, setSourceKind] = useState("camera");
  useEffect(() => {
    let disposed = false;
    let id: string | null = null;
    let peer: RTCPeerConnection | null = null;
    let pollTimer: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;
    const close = () => {
      clearTimeout(pollTimer);
      clearTimeout(deadline);
      peer?.close();
      peer = null;
      if (video.current) video.current.srcObject = null;
      if (id) {
        void mutate("/api/peer/close", { id }).catch(() => {});
        id = null;
      }
    };
    const fail = (error: unknown) => {
      if (disposed) return;
      disposed = true;
      close();
      setState({ kind: "error", message: message(error) });
    };
    async function poll() {
      try {
        const session = await request(
          "/api/peer/poll",
          peerSessionSchema,
          { id },
          AbortSignal.timeout(8000),
        );
        if (disposed || !peer) return;
        if (session.answer && !peer.remoteDescription) {
          await peer.setRemoteDescription({ type: "answer", sdp: session.answer });
        }
        if (!disposed) pollTimer = setTimeout(poll, peerPollMs);
      } catch (error) {
        fail(error);
      }
    }
    async function start() {
      setState({ kind: "connecting" });
      try {
        if (typeof RTCPeerConnection === "undefined")
          throw new Error("Live viewing is unavailable in this browser.");
        const session = await request(
          "/api/peer/open",
          peerSessionSchema,
          { deviceId: device.id },
          AbortSignal.timeout(8000),
        );
        if (disposed) {
          void mutate("/api/peer/close", { id: session.id }).catch(() => {});
          return;
        }
        id = session.id;
        setSourceKind(session.kind);
        const connection = createPeer((next) => {
          if (disposed) return;
          if (next === "connected") {
            clearTimeout(deadline);
            setState({ kind: "live" });
          }
          if (next === "failed" || next === "disconnected") fail(new Error(peerNetworkMessage));
        });
        peer = connection;
        connection.ontrack = (event) => {
          if (disposed || !video.current) return;
          video.current.srcObject = new MediaStream([event.track]);
          void video.current.play().catch(() => {});
        };
        connection.addTransceiver("video", { direction: "recvonly" });
        deadline = setTimeout(() => fail(new Error(peerNetworkMessage)), 30_000);
        void poll();
        const sdp = await localDescription(connection, await connection.createOffer());
        if (!disposed)
          await request(
            "/api/peer/offer",
            peerAcceptedSchema,
            { id: session.id, sdp },
            AbortSignal.timeout(8000),
          );
      } catch (error) {
        fail(error);
      }
    }
    void start();
    return () => {
      disposed = true;
      close();
    };
  }, [device.id, attempt]);
  return (
    <section
      aria-label={`Live view of ${device.name}`}
      className="mb-6 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-panel-title">Live view · {device.name}</h2>
        <Button icon={X} variant="secondary" onClick={onClose}>
          Close live view
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {sourceKind === "file" ? "Replay · local video" : "Live camera"}. Direct connection. No
        server recording.
      </p>
      <video
        ref={video}
        aria-label="Live device video"
        autoPlay
        muted
        playsInline
        controls
        className="mt-4 aspect-video w-full rounded-lg bg-black"
      />
      {state.kind === "error" ? (
        <div className="mt-4">
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
          <Button icon={RotateCw} className="mt-3" onClick={() => setAttempt((value) => value + 1)}>
            Retry live view
          </Button>
        </div>
      ) : (
        <output className="mt-3 text-sm text-muted-foreground">
          {state.kind === "live" ? "Connected directly to the device" : "Connecting to the device…"}
        </output>
      )}
    </section>
  );
}
