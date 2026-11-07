# F-SOURCE-PEER: Authorized live peer viewing

Status: partial

Depends on: F-AUTH-ACCESS, F-SOURCE-CAPTURE

## Behavior

Live view, Retry live view, and Close live view retain visible labels and add decorative video, reload, and close icons. Row actions share compact sizing; player actions use the shared default size.

An authorized owner or operator opens a paired device's active capture in Live view. One viewer may connect per device. This P2 capability remains outside the core demo. Closing the player closes the peer connection and its cloned outgoing tracks without stopping capture, its sampler, or the local evidence buffer.

Browser WebRTC uses Cloudflare's free public STUN service and direct connectivity only. No TURN, SFU, paid subscription, payment method, VPC, or VPN is configured. Restrictive NAT or firewall conditions can prevent viewing. Connection failure explains the missing relay and offers retry on the same Wi-Fi or another network. There is no automatic paid fallback.

Camera viewing reuses a clone of the existing capture stream. Local-file viewing uses the existing video element's captureStream when supported and is labeled Replay. Audio is never sent. Pausing, stopping, seeking, replacing the source, hiding the capture tab, or losing device access ends the current peer session. Restarting capture and Retry live view establish a new session.

The Devices layout gives each authorized device a primary **Live view** button with a video icon. Access badges remain **Paired** or **Access removed**, never a claim of active capture. Owners retain a secondary removal action; operators can view but cannot remove devices. Opening, retrying, and closing reuse the existing player and peer lifecycle.

## Entry points

On Devices, choose Live view beside an authorized device. The player supports Close live view and Retry live view. A stopped, offline, or busy device shows an actionable error. The capture station shows live-view availability and viewer connection status.

## Wiring and compatibility

The [peer route](../../../apps/app/src/routes/api/peer/$.ts) accepts same-origin POSTs through the existing endpoint boundary. The [signaling handlers](../../../apps/app/src/server/peer.ts) resolve current member or device principals on every request. Workspace and user identity come from that boundary. Only the initiating operator can poll, offer, or close a session. Only its target device can answer. A unique device constraint arbitrates competing viewers. Signaling payloads are schema-validated and size-bounded.

The existing D1 binding stores source presence and offer/answer metadata, never media. Three-second polling renews 15-second source and viewer leases. Expired or invalid sessions become inaccessible and are deleted lazily by subsequent signaling requests. Membership removal, device revocation, source-run replacement, and source expiry invalidate viewing. Clients close their connection on signaling failure, including an eight-second request timeout. Revocation is detected on the next successful poll or timeout, not synchronously at the click. This is an application-controlled browser client, not a guarantee against a modified endpoint retaining received frames.

F-SOURCE-CAPTURE owns source capture, monitoring resources, and memory buffers. [getPeerStream](../../../apps/app/src/lib/capture-session.ts) lends separate outgoing tracks to the peer lifecycle. Source identity is the paired device plus a fresh live-source run ID and camera/file kind. Peer run IDs remain separate from configured F-RULE-CONFIG source IDs and the incident sessions now connected by F-DETECT-REVIEW. Live viewing neither creates another capture loop nor changes saved incident reporting or replay.

## Implementation

[Shared signaling schemas and free ICE configuration](../../../apps/app/src/lib/peer.ts), [peer connection and ICE gathering](../../../apps/app/src/lib/peer-connection.ts), [device peer lifecycle](../../../apps/app/src/components/live-source.tsx), [operator player](../../../apps/app/src/components/live-view.tsx), [capture station](../../../apps/app/src/components/device-screen.tsx), [Devices entry](../../../apps/app/src/components/access/workspace.tsx), [server handlers](../../../apps/app/src/server/peer.ts), and [migration](../../../apps/app/migrations/0004_peer_view.sql) implement the local path. Apply the real migration through the normal application deployment process. No external service provisioning or deployment is included.

## Verification

[API integration tests](../../../apps/app/tests/api/access.test.ts) run built Worker handlers with isolated D1 and real migrations. They cover offer/answer delivery, close/reopen with source preservation, competing operators, wrong device/member/workspace denial, cross-origin denial, bounded descriptions, source replacement and expiry, lease expiry, revocation, and membership removal. [UI integration tests](../../../apps/app/tests/integration/access.test.tsx) cover operator entry, unsupported-browser errors, retry, close, and revoked-device controls. Existing [capture integration tests](../../../apps/app/tests/integration/device.test.tsx) retain stop, sampler, buffer-resource release, and source-error coverage.

The production-build Chromium run on source revision 08a803c used separate owner/device browser contexts, isolated D1, and a simulated camera with real peer connections. It received 640×480 video, confirmed capture and buffer continuity across close/reopen, resumed video after source restart and retry, ended viewing on revocation, and checked keyboard close and a 375-pixel layout without overflow. The selected ICE pair was host/host; same-machine RTT was reported as zero and does not establish cross-network or end-to-end video latency. Successful baseline requests and the browser console had no errors. `pnpm verify` passed with 38 UI and 23 API integration tests. [PR #67](https://github.com/KenEzekiel/lookout-ai/pull/67) contains the manual steps, screenshots, recording, and remaining verification gaps. Physical separate-device, desktop/mobile, and same-network/cross-network verification from issue #28 remain required before claiming the feature implemented. Local browser contexts do not establish cross-network connectivity. Record actual selected ICE candidate types and observed latency. No production TURN integration is claimed or required under the accepted free-only scope.

## Decisions and sources

The current PR implements Ken’s approved browser-card mockup and request to restore and emphasize connected-device Live view. Existing access and peer behavior is preserved. Complete-screen access integration tests cover activation confirmation/cancellation, role restrictions, viewing entry/retry/close, and removal of viewing access after revocation. Manual QA results belong in the PR.

Kenneth requested consistent button sizing and clearer action icons. [Device rows](../../../apps/app/src/components/access/workspace.tsx) and [player controls](../../../apps/app/src/components/live-view.tsx) use F-APP-SHELL Button variants. The wider desktop action column accommodates both labeled icons. Signaling, permissions, and media ownership remain unchanged.

[Implementation PR #67](https://github.com/KenEzekiel/lookout-ai/pull/67), [issue #28](https://github.com/KenEzekiel/lookout-ai/issues/28), [product direction](../../../PRD.md), [experience design](../../architecture/design.md), [visual design](../../../DESIGN.md), and [service roadmap](../../architecture/roadmap.md).

The user selected Cloudflare WebRTC and then required free-only operation without a credit card or balance in this conversation. [Cloudflare documents free unlimited STUN and metered TURN](https://developers.cloudflare.com/realtime/turn/faq/). This PR therefore omits TURN entirely. Synthesis decision: reuse the existing authenticated HTTP and D1 boundaries for bounded, short-lived signaling rather than add a WebSocket service or private network. Exchange complete SDP after ICE gathering instead of storing trickled candidates. [Media element capture has limited browser availability](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream). The existing Workers/D1 Free plan quotas still apply; quota exhaustion is a visible connection failure and must not trigger an upgrade. No cloud account plan was changed or provisioned.

## Open questions

Physical devices, supported mobile browsers, cross-network connections, and production origin remain unverified. Some networks require TURN and cannot connect in this free-only implementation. Local-file capture support varies by browser. Background capture is not guaranteed. Signaling metadata expires logically after 15 seconds but physical deletion requires another signaling request. Polling is scoped for a small demo and consumes the existing free request/database quotas.
