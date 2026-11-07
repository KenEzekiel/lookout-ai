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

export const incidentCaptureSession = sqliteTable(
  "incident_capture_session",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id),
    startedAt: integer("started_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [uniqueIndex("current_device_source_session").on(table.deviceId, table.sourceId)],
);

export const incident = sqliteTable(
  "incident",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id),
    sessionId: text("session_id").notNull(),
    eventId: text("event_id").notNull(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => monitoringRule.id),
    eventTime: integer("event_time").notNull(),
    receivedAt: integer("received_at").notNull(),
    context: text("context").notNull(),
    status: text("status", { enum: ["open", "acknowledged", "dismissed", "resolved"] }).notNull(),
    version: integer("version").notNull(),
    owner: text("owner"),
    timeline: text("timeline").notNull(),
    escalationActivations: text("escalation_activations").notNull().default("[]"),
    followUpDueAt: integer("follow_up_due_at"),
    followUpAttemptedAt: integer("follow_up_attempted_at"),
  },
  (table) => [
    uniqueIndex("device_event_incident").on(
      table.deviceId,
      table.sessionId,
      table.eventId,
      table.ruleId,
    ),
    index("workspace_incidents").on(table.workspaceId, table.receivedAt),
    check(
      "incident_status",
      sql`${table.status} IN ('open','acknowledged','dismissed','resolved')`,
    ),
    check("incident_version", sql`${table.version} > 0`),
    check("incident_context", sql`json_valid(${table.context})`),
    check("incident_timeline", sql`json_valid(${table.timeline})`),
    check(
      "incident_owner",
      sql`(${table.status} = 'open' AND ${table.owner} IS NULL) OR (${table.status} = 'dismissed') OR (${table.status} IN ('acknowledged','resolved') AND ${table.owner} IS NOT NULL AND json_valid(${table.owner}))`,
    ),
  ],
);

export const incidentEvidence = sqliteTable(
  "incident_evidence",
  {
    incidentId: text("incident_id")
      .primaryKey()
      .references(() => incident.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["preparing", "uploading", "ready", "unavailable"] }).notNull(),
    reason: text("reason"),
    objectKey: text("object_key"),
    bytes: integer("bytes"),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [
    check(
      "evidence_status",
      sql`${table.status} IN ('preparing','uploading','ready','unavailable')`,
    ),
  ],
);

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
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [index("push_session").on(table.sessionId)],
);
export const pushDelivery = sqliteTable(
  "push_delivery",
  {
    incidentId: text("incident_id")
      .notNull()
      .references(() => incident.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").notNull(),
    status: text("status", { enum: ["attempting", "accepted", "failed", "expired"] }).notNull(),
    attemptedAt: integer("attempted_at").notNull(),
    responseStatus: integer("response_status"),
  },
  (table) => [uniqueIndex("one_initial_push").on(table.incidentId, table.subscriptionId)],
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
