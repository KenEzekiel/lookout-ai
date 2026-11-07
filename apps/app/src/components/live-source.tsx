import { useEffect, useState, type RefObject } from "react";
import { mutate, request, message } from "@/lib/api";
import { peerSyncSchema, peerPollMs, peerNetworkMessage, peerAcceptedSchema } from "@/lib/peer";
import { createPeer, localDescription } from "@/lib/peer-connection";
import { type CaptureSession, type CaptureSnapshot } from "@/lib/capture-session";

export function LiveSource({
  session,
  snapshot,
}: {
  session: RefObject<CaptureSession | null>;
  snapshot: CaptureSnapshot;
}) {
  const [notice, setNotice] = useState("");
  const active = snapshot.state === "running";
  useEffect(() => {
    const capture = session.current;
    if (!active || !capture || !snapshot.source || typeof RTCPeerConnection === "undefined") return;
    const source = { runId: crypto.randomUUID(), kind: snapshot.source };
    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;
    let sessionId: string | null = null;
    let answeredId: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const releasePeer = () => {
      peer?.close();
      peer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };
    async function sync() {
      try {
        const result = await request(
          "/api/peer/device",
          peerSyncSchema,
          source,
          AbortSignal.timeout(8000),
        );
        if (disposed) return;
        if (result.session?.id !== sessionId) {
          releasePeer();
          sessionId = result.session?.id ?? null;
        }
        if (result.session?.offer && !peer && result.session.id !== answeredId) {
          stream = capture?.getPeerStream() ?? null;
          if (!stream)
            throw new Error(
              "This browser cannot share the current source. Use a camera or a browser with video capture support.",
            );
          const connection = createPeer((state) => {
            if (disposed) return;
            if (state === "connected") setNotice("An authorized operator is viewing this source.");
            if (state === "failed" || state === "disconnected") {
              releasePeer();
              setNotice(peerNetworkMessage);
            }
          });
          peer = connection;
          const outgoing = stream;
          outgoing.getVideoTracks().forEach((track) => connection.addTrack(track, outgoing));
          await connection.setRemoteDescription({ type: "offer", sdp: result.session.offer });
          const sdp = await localDescription(connection, await connection.createAnswer());
          if (disposed || peer !== connection) return;
          answeredId = result.session.id;
          await request(
            "/api/peer/answer",
            peerAcceptedSchema,
            { id: result.session.id, sdp },
            AbortSignal.timeout(8000),
          );
          setNotice("Connecting an authorized viewer…");
        } else if (!result.session) {
          setNotice("Available for live viewing. No video is stored on the server.");
        }
      } catch (error) {
        releasePeer();
        if (!disposed) setNotice(`Live viewing unavailable. ${message(error)}`);
      } finally {
        if (!disposed) timer = setTimeout(sync, peerPollMs);
      }
    }
    void sync();
    return () => {
      disposed = true;
      clearTimeout(timer);
      releasePeer();
      void mutate("/api/peer/stop", source).catch(() => {});
    };
  }, [active, session, snapshot.epoch, snapshot.source]);
  return (
    <output className="mt-3 text-xs leading-relaxed text-muted-foreground">
      {active
        ? typeof RTCPeerConnection === "undefined"
          ? "Live viewing is unavailable in this browser."
          : notice
        : "Live viewing is unavailable while capture is stopped or paused."}
    </output>
  );
}
