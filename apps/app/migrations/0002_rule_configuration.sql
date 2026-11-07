CREATE TABLE `monitoring_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_id` text NOT NULL,
	`definition` text NOT NULL,
	`enabled` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_version" CHECK("monitoring_rule"."version" > 0),
	CONSTRAINT "rule_enabled" CHECK("monitoring_rule"."enabled" IN (0,1)),
	CONSTRAINT "rule_definition" CHECK(json_valid("monitoring_rule"."definition"))
);
--> statement-breakpoint
CREATE INDEX `workspace_rules` ON `monitoring_rule` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_kind" CHECK("source"."kind" IN ('camera','replay'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_workspace_name` ON `source` (`workspace_id`,`name`);