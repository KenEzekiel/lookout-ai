import { z } from "zod";

export async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ message: z.string() }).safeParse(data);
    throw new Error(error.success ? error.data.message : "Request failed. Try again.");
  }
  return schema.parse(data);
}
export function mutate(path: string, body: unknown = {}) {
  return request(path, z.unknown(), body);
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
