import { env } from "cloudflare:workers";
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { z } from "zod";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/lib/push";
import { member } from "./access";
import { auth } from "./auth";
import { AccessError, digest, json, limit } from "./http";

const configurationSchema = z.object({
  PUSH_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  PUSH_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  PUSH_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/),
});
const deliverySchema = z.object({
  id: z.string(),
  endpoint: pushEndpointSchema,
  p256dh: z.string(),
  auth: z.string(),
});
async function subscriber(request: Request) {
  const actor = await member(request);
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) throw new AccessError(401, "Sign in to enable background alerts.");
  return { actor, sessionId: session.session.id };
}
export async function pushSettings(request: Request) {
  const { actor, sessionId } = await subscriber(request);
  const config = configurationSchema.safeParse(env);
  const rows = await env.DB.prepare(
    "SELECT endpoint FROM push_subscription WHERE session_id=? AND user_id=? AND workspace_id=?",
  )
    .bind(sessionId, actor.userId, actor.workspaceId)
    .all<{ endpoint: string }>();
  return json({
    configured: config.success,
    publicKey: config.success ? config.data.PUSH_PUBLIC_KEY : null,
    endpoints: rows.results.map((row) => row.endpoint),
  });
}
export async function savePushSubscription(request: Request) {
  const { actor, sessionId } = await subscriber(request);
  if (!configurationSchema.safeParse(env).success)
    throw new AccessError(503, "Background alerts are not configured on this server yet.");
  const input = pushSubscriptionSchema.parse(await request.json());
  await limit(`push:${actor.userId}`, 20);
  try {
    const bytes = Uint8Array.from(
      atob(input.keys.p256dh.replace(/-/g, "+").replace(/_/g, "/")),
      (character) => character.charCodeAt(0),
    );
    await crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw new AccessError(400, "This browser subscription has an invalid encryption key.");
  }
  if (input.expirationTime !== null && input.expirationTime <= Date.now())
    throw new AccessError(400, "This subscription expired. Enable alerts again.");
  const row =
    await env.DB.prepare(`INSERT INTO push_subscription(id,workspace_id,user_id,session_id,endpoint,p256dh,auth,expires_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE
      ((SELECT count(*) FROM push_subscription WHERE user_id=?3)<10 OR EXISTS (SELECT 1 FROM push_subscription WHERE endpoint=?5 AND user_id=?3)) AND EXISTS
      (SELECT 1 FROM membership m JOIN session s ON s.user_id=m.user_id WHERE m.user_id=?3 AND m.workspace_id=?2 AND s.id=?4 AND s.expires_at>?9)
    ON CONFLICT(endpoint) DO UPDATE SET session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,expires_at=excluded.expires_at
      WHERE push_subscription.user_id=excluded.user_id AND push_subscription.workspace_id=excluded.workspace_id
    RETURNING id`)
      .bind(
        await digest(input.endpoint),
        actor.workspaceId,
        actor.userId,
        sessionId,
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        input.expirationTime,
        Date.now(),
      )
      .first();
  if (!row)
    throw new AccessError(
      409,
      "This subscription could not be saved. It may belong to another account, or your account has reached its 10-browser limit.",
    );
  return json({ subscribed: true });
}
export async function removePushSubscription(request: Request) {
  const { actor, sessionId } = await subscriber(request);
  const { endpoint } = z
    .object({ endpoint: pushEndpointSchema })
    .strict()
    .parse(await request.json());
  await env.DB.prepare(
    "DELETE FROM push_subscription WHERE endpoint=? AND user_id=? AND workspace_id=? AND session_id=?",
  )
    .bind(endpoint, actor.userId, actor.workspaceId, sessionId)
    .run();
  return json({ subscribed: false });
}
export async function deliverIncidentPush(incidentId: string) {
  const config = configurationSchema.safeParse(env);
  if (!config.success) return;
  await env.DB.prepare(`DELETE FROM push_subscription WHERE (expires_at IS NOT NULL AND expires_at<=?1)
    OR NOT EXISTS (SELECT 1 FROM session s WHERE s.id=push_subscription.session_id AND s.expires_at>?1)
    OR NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id=push_subscription.user_id AND m.workspace_id=push_subscription.workspace_id)`)
    .bind(Date.now())
    .run();
  const rows = await env.DB.prepare(`SELECT p.id,p.endpoint,p.p256dh,p.auth FROM push_subscription p
    JOIN incident i ON i.workspace_id=p.workspace_id
    WHERE i.id=?1 AND i.status='open' AND EXISTS
      (SELECT 1 FROM json_each(i.context,'$.rule.definition.escalationLevels[0].recipientIds') WHERE value=p.user_id)`)
    .bind(incidentId)
    .all();
  await Promise.all(
    rows.results.map(async (row) => {
      const subscription = deliverySchema.parse(row);
      const claim =
        await env.DB.prepare(`INSERT INTO push_delivery(incident_id,subscription_id,status,attempted_at)
      SELECT ?1,?2,'attempting',?3 WHERE EXISTS (SELECT 1 FROM push_subscription p
        JOIN session s ON s.id=p.session_id JOIN membership m ON m.user_id=p.user_id AND m.workspace_id=p.workspace_id
        JOIN incident i ON i.workspace_id=p.workspace_id WHERE p.id=?2 AND i.id=?1 AND i.status='open' AND s.expires_at>?3)
      ON CONFLICT(incident_id,subscription_id) DO NOTHING RETURNING incident_id`)
          .bind(incidentId, subscription.id, Date.now())
          .first();
      if (!claim) return;
      let status = "failed";
      let responseStatus: number | null = null;
      try {
        const payload = await buildPushPayload(
          { data: JSON.stringify({ incidentId }), options: { ttl: 60 } },
          {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          {
            subject: config.data.PUSH_SUBJECT,
            publicKey: config.data.PUSH_PUBLIC_KEY,
            privateKey: config.data.PUSH_PRIVATE_KEY,
          },
        );
        const response = await fetch(subscription.endpoint, {
          ...payload,
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        responseStatus = response.status;
        await response.body?.cancel();
        status = response.ok ? "accepted" : "failed";
        if (response.status === 404 || response.status === 410) {
          status = "expired";
          await env.DB.prepare("DELETE FROM push_subscription WHERE id=?")
            .bind(subscription.id)
            .run();
        }
      } catch {
        status = "failed";
      }
      await env.DB.prepare(
        "UPDATE push_delivery SET status=?,response_status=? WHERE incident_id=? AND subscription_id=?",
      )
        .bind(status, responseStatus, incidentId, subscription.id)
        .run();
    }),
  );
}
