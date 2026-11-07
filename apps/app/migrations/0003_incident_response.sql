CREATE TABLE `incident` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`device_id` text NOT NULL,
	`session_id` text NOT NULL,
	`event_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`event_time` integer NOT NULL,
	`received_at` integer NOT NULL,
	`context` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`owner` text,
	`timeline` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `monitoring_rule`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incident_status" CHECK("incident"."status" IN ('open','acknowledged','dismissed','resolved')),
	CONSTRAINT "incident_version" CHECK("incident"."version" > 0),
	CONSTRAINT "incident_context" CHECK(json_valid("incident"."context")),
	CONSTRAINT "incident_timeline" CHECK(json_valid("incident"."timeline")),
	CONSTRAINT "incident_owner" CHECK(("incident"."status" = 'open' AND "incident"."owner" IS NULL) OR ("incident"."status" = 'dismissed') OR ("incident"."status" IN ('acknowledged','resolved') AND "incident"."owner" IS NOT NULL AND json_valid("incident"."owner")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_event_incident` ON `incident` (`device_id`,`session_id`,`event_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `workspace_incidents` ON `incident` (`workspace_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `incident_capture_session` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`device_id` text NOT NULL,
	`source_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `current_device_source_session` ON `incident_capture_session` (`device_id`,`source_id`);