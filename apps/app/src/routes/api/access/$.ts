import { createFileRoute } from "@tanstack/react-router";
async function handle(request: Request) {
  const { principal } = await import("@/server/access");
  const { endpoint, json } = await import("@/server/http");
  const { teamEvents } = await import("@/server/team-events");
  const { createWorkspace, team, createInvitation, joinWorkspace, removeMember } =
    await import("@/server/workspaces");
  const {
    startPairing,
    approvePairing,
    claimPairing,
    activateThisBrowser,
    revokeDevice,
    deviceStatus,
    leaveDevice,
    forgetDevice,
    rememberedDeviceStatus,
  } = await import("@/server/devices");
  const handlers: Record<string, (request: Request) => Promise<Response>> = {
    "GET principal": async (request) =>
      new URL(request.url).searchParams.get("mode") === "device"
        ? deviceStatus(request)
        : json(await principal(request)),
    "GET team": team,
    "GET team/events": teamEvents,
    "POST workspace": createWorkspace,
    "POST invitations": createInvitation,
    "POST join": joinWorkspace,
    "POST remove-member": removeMember,
    "POST pairing/start": startPairing,
    "POST pairing/approve": approvePairing,
    "POST pairing/claim": claimPairing,
    "POST devices/activate": activateThisBrowser,
    "POST devices/revoke": revokeDevice,
    "GET devices/status": deviceStatus,
    "POST devices/leave": leaveDevice,
    "POST devices/forget": forgetDevice,
    "GET devices/remembered": rememberedDeviceStatus,
  };

  return endpoint(request, async () => {
    const path = new URL(request.url).pathname.replace("/api/access/", "");
    const handler = handlers[`${request.method} ${path}`];
    return handler ? handler(request) : json({ message: "Not found." }, 404);
  });
}
export const Route = createFileRoute("/api/access/$")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
