import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
import { z } from "zod";
import { BoundaryError } from "../session/domain.js";
import { identitySchema } from "./slack.js";

export const oracleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configSchema = z.object({
  workspace: z.string().min(1),
  slack: z.object({
    botToken: z.string().regex(/^xoxb-/),
    appToken: z.string().regex(/^xapp-/),
  }),
  t3: z.object({
    endpoint: z.string().url(),
    token: z.string().min(1),
    projectId: z.string().min(1),
    instanceId: z.string().min(1),
    model: z.string().min(1),
  }),
});
export type Config = z.infer<typeof configSchema>;

export async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new BoundaryError("local_configuration_invalid");
  }
}

export async function loadConfig(): Promise<Config> {
  dotenv({ path: join(oracleRoot, ".env"), quiet: true });
  const candidate = {
    workspace: process.env.ORACLE_WORKSPACE,
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
    },
    t3: {
      endpoint: process.env.T3_MCP_ENDPOINT,
      token: process.env.T3_MCP_TOKEN,
      projectId: process.env.T3_PROJECT_ID,
      instanceId: process.env.T3_INSTANCE_ID,
      model: process.env.T3_MODEL,
    },
  };
  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) throw new BoundaryError("configuration_missing_or_invalid");
  parsed.data.workspace = await realpath(resolve(oracleRoot, parsed.data.workspace));
  if (parsed.data.workspace !== (await realpath(join(oracleRoot, ".."))))
    throw new BoundaryError("workspace_runtime_mismatch");
  return parsed.data;
}

export async function loadIdentity(): Promise<z.infer<typeof identitySchema> | undefined> {
  const saved = await readOptionalJson(join(oracleRoot, ".local", "identity.json"));
  if (saved === undefined) return;
  const parsed = identitySchema.safeParse(saved);
  if (!parsed.success) throw new BoundaryError("slack_identity_invalid");
  return parsed.data;
}
