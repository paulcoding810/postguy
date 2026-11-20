CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `environments` ADD `mcp_blocked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `environments` ADD `mcp_reveal_secrets` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `request_history` ADD `source` text;