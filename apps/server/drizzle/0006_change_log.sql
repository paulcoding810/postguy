CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`label` text NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_root_idx` ON `change_log` (`root_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `change_log_entity_idx` ON `change_log` (`entity_id`,`updated_at`);