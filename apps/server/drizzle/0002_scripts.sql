CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`phase` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_owner_phase_uq` ON `scripts` (`owner_type`,`owner_id`,`phase`);--> statement-breakpoint
ALTER TABLE `flow_execution_steps` ADD `scripts_json` text;--> statement-breakpoint
ALTER TABLE `flow_executions` ADD `runtime_json` text DEFAULT '{}' NOT NULL;