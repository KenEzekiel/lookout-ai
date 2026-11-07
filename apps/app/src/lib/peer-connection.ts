import { freeIceServers, peerNetworkMessage } from "./peer";

export function createPeer(onState: (state: RTCPeerConnectionState) => void) {
  const peer = new RTCPeerConnection({ iceServers: freeIceServers });
  peer.onconnectionstatechange = () => onState(peer.connectionState);
  return peer;
}
export async function localDescription(
  peer: RTCPeerConnection,
  description: RTCSessionDescriptionInit,
) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== "complete") {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", changed);
        peer.removeEventListener("connectionstatechange", changed);
        if (peer.signalingState === "closed") reject(new Error("Live view closed."));
        else resolve();
      };
      const changed = () => {
        if (peer.iceGatheringState === "complete" || peer.signalingState === "closed") finish();
      };
      const timer = setTimeout(finish, 6000);
      peer.addEventListener("icegatheringstatechange", changed);
      peer.addEventListener("connectionstatechange", changed);
      changed();
    });
  }
  const sdp = peer.localDescription?.sdp;
  if (!sdp) throw new Error(peerNetworkMessage);
  return sdp;
}
