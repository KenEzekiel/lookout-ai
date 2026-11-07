CREATE TABLE `attempt_limit` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_token_hash_unique` ON `device` (`token_hash`);--> statement-breakpoint
CREATE INDEX `workspace_devices` ON `device` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by` text,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_unique` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_code_hash_unique` ON `invitation` (`code_hash`);--> statement-breakpoint
CREATE TABLE `membership` (
	`user_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`invitation_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_role" CHECK("membership"."role" IN ('owner','operator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_invitation_id_unique` ON `membership` (`invitation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_owner_per_workspace` ON `membership` (`workspace_id`) WHERE "membership"."role" = 'owner';--> statement-breakpoint
CREATE INDEX `workspace_members` ON `membership` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `pairing_request` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`claim_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`device_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_request_code_hash_unique` ON `pairing_request` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_request_claim_hash_unique` ON `pairing_request` (`claim_hash`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
