import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request", { mode: "number" }).notNull(),
});

export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  usedBy: text("used_by").references(() => user.id),
  revokedAt: integer("revoked_at"),
});
export const membership = sqliteTable(
  "membership",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "operator"] }).notNull(),
    invitationId: text("invitation_id")
      .unique()
      .references(() => invitation.id),
  },
  (table) => [
    check("membership_role", sql`${table.role} IN ('owner','operator')`),
    uniqueIndex("one_owner_per_workspace")
      .on(table.workspaceId)
      .where(sql`${table.role} = 'owner'`),
    index("workspace_members").on(table.workspaceId),
  ],
);
export const device = sqliteTable(
  "device",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("workspace_devices").on(table.workspaceId)],
);
export const pairingRequest = sqliteTable("pairing_request", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  claimHash: text("claim_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  deviceId: text("device_id").references(() => device.id),
});
export const attemptLimit = sqliteTable("attempt_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const source = sqliteTable(
  "source",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["camera", "replay"] }).notNull(),
  },
  (table) => [
    uniqueIndex("source_workspace_name").on(table.workspaceId, table.name),
    check("source_kind", sql`${table.kind} IN ('camera','replay')`),
  ],
);
export const monitoringRule = sqliteTable(
  "monitoring_rule",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id),
    definition: text("definition").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("workspace_rules").on(table.workspaceId),
    check("rule_version", sql`${table.version} > 0`),
    check("rule_enabled", sql`${table.enabled} IN (0,1)`),
    check("rule_definition", sql`json_valid(${table.definition})`),
  ],
);
