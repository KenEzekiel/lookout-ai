CREATE TABLE `incident_evidence` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`object_key` text,
	`bytes` integer,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evidence_status" CHECK("incident_evidence"."status" IN ('preparing','uploading','ready','unavailable'))
);
