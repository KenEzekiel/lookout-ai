import { randomInt } from "node:crypto";
import { env } from "cloudflare:workers";
import { z } from "zod";

export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function cookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function setCookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.APP_URL.startsWith("https:") ? "; Secure" : ""}`;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export async function endpoint(request: Request, run: () => Promise<Response>) {
  try {
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(env.APP_URL).origin) {
      throw new AccessError(403, "This request must come from the app.");
    }
    return await run();
  } catch (error) {
    if (error instanceof AccessError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ message: "Check the submitted fields." }, 400);
    throw error;
  }
}
export function secret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function shortCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
export async function digest(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function codeDigest(kind: "invitation" | "pairing", code: string) {
  return digest(`${env.BETTER_AUTH_SECRET}:${kind}:${code}`);
}
export async function limit(key: string, maximum = 10) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM attempt_limit WHERE expires_at < ?").bind(now).run();
  const row = await env.DB.prepare(
    "INSERT INTO attempt_limit(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, now + 60_000)
    .first<{ count: number }>();
  if (!row || row.count > maximum)
    throw new AccessError(429, "Too many attempts. Try again in a minute.");
}
