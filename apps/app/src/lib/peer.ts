import { z } from "zod";

export const peerSourceSchema = z.object({
  runId: z.string().uuid(),
  kind: z.enum(["camera", "file"]),
});
export const peerSessionSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  kind: z.enum(["camera", "file"]),
  offer: z.string().nullable(),
  answer: z.string().nullable(),
});
export const peerSyncSchema = z.object({ session: peerSessionSchema.nullable() });
export const peerAcceptedSchema = z.object({ accepted: z.literal(true) });
export const peerOpenSchema = z.object({ deviceId: z.string().min(1).max(100) });
export const peerIdSchema = z.object({ id: z.string().uuid() });
export const peerDescriptionSchema = peerIdSchema.extend({ sdp: z.string().min(1).max(32_768) });
export type PeerSession = z.infer<typeof peerSessionSchema>;
export const peerPollMs = 3000;
export const peerLeaseMs = 15_000;
export const freeIceServers: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
export const peerNetworkMessage =
  "A direct connection could not be established. Try the same Wi-Fi or another network, then retry. Relay service is not configured.";
