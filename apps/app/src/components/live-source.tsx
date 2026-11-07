import { useEffect, useState, type RefObject } from "react";
import { mutate, request, message } from "@/lib/api";
import {
  peerSyncSchema,
  peerPollMs,
  peerNetworkMessage,
  peerAcceptedSchema,
  type PeerSession,
} from "@/lib/peer";
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
    type Viewer =
      | { kind: "connecting" | "connected"; peer: RTCPeerConnection; stream: MediaStream }
      | { kind: "failed"; message: string };
    const viewers = new Map<string, Viewer>();
    let timer: ReturnType<typeof setTimeout>;
    const releaseViewer = (id: string) => {
      const viewer = viewers.get(id);
      viewers.delete(id);
      if (viewer && viewer.kind !== "failed") {
        viewer.peer.close();
        viewer.stream.getTracks().forEach((track) => track.stop());
      }
    };
    const releaseAll = () => {
      for (const id of viewers.keys()) releaseViewer(id);
    };
    const updateNotice = () => {
      if (disposed) return;
      const connected = [...viewers.values()].filter(
        (viewer) => viewer.kind === "connected",
      ).length;
      const connecting = [...viewers.values()].filter(
        (viewer) => viewer.kind === "connecting",
      ).length;
      const failed = [...viewers.values()].filter((viewer) => viewer.kind === "failed").length;
      const parts = [];
      if (connected)
        parts.push(
          `${connected} authorized viewer${connected === 1 ? " is" : "s are"} viewing this source.`,
        );
      if (connecting)
        parts.push(`Connecting ${connecting} authorized viewer${connecting === 1 ? "" : "s"}…`);
      if (failed) parts.push(`${failed} viewer connection${failed === 1 ? "" : "s"} failed.`);
      for (const viewer of viewers.values()) {
        if (viewer.kind === "failed" && !parts.includes(viewer.message)) parts.push(viewer.message);
      }
      setNotice(parts.join(" ") || "Available for live viewing. No video is stored on the server.");
    };
    async function connect(view: PeerSession) {
      if (!view.offer) return;
      let outgoing: MediaStream | null = null;
      let pending: Viewer | undefined;
      try {
        outgoing = capture?.getPeerStream() ?? null;
        const stream = outgoing;
        if (!stream)
          throw new Error(
            "This browser cannot share the current source. Use a camera or a browser with video capture support.",
          );
        const connection = createPeer((state) => {
          if (disposed) return;
          const viewer = viewers.get(view.id);
          if (!viewer || viewer.kind === "failed" || viewer.peer !== connection) return;
          if (state === "connected") {
            viewer.kind = "connected";
            updateNotice();
          }
          if (state === "failed" || state === "disconnected") {
            releaseViewer(view.id);
            viewers.set(view.id, { kind: "failed", message: peerNetworkMessage });
            updateNotice();
          }
        });
        pending = { kind: "connecting", peer: connection, stream };
        viewers.set(view.id, pending);
        updateNotice();
        stream.getVideoTracks().forEach((track) => connection.addTrack(track, stream));
        await connection.setRemoteDescription({ type: "offer", sdp: view.offer });
        const sdp = await localDescription(connection, await connection.createAnswer());
        const viewer = viewers.get(view.id);
        if (disposed || !viewer || viewer.kind === "failed" || viewer.peer !== connection) return;
        await request(
          "/api/peer/answer",
          peerAcceptedSchema,
          { id: view.id, sdp },
          AbortSignal.timeout(8000),
        );
      } catch (error) {
        if (disposed || (pending && viewers.get(view.id) !== pending)) return;
        if (pending) releaseViewer(view.id);
        else outgoing?.getTracks().forEach((track) => track.stop());
        viewers.set(view.id, { kind: "failed", message: message(error) });
        updateNotice();
      }
    }
    async function sync() {
      try {
        const result = await request(
          "/api/peer/device",
          peerSyncSchema,
          source,
          AbortSignal.timeout(8000),
        );
        if (disposed) return;
        const currentIds = new Set(result.sessions.map((view) => view.id));
        for (const id of viewers.keys()) {
          if (!currentIds.has(id)) releaseViewer(id);
        }
        for (const view of result.sessions) {
          if (view.offer && !view.answer && !viewers.has(view.id)) void connect(view);
        }
        updateNotice();
      } catch (error) {
        releaseAll();
        if (!disposed) setNotice(`Live viewing unavailable. ${message(error)}`);
      } finally {
        if (!disposed) timer = setTimeout(sync, peerPollMs);
      }
    }
    void sync();
    return () => {
      disposed = true;
      clearTimeout(timer);
      releaseAll();
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
