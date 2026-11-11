CREATE TABLE `flow_connections` (
	`id` text NOT NULL,
	`flow_id` text NOT NULL,
	`source_step_id` text NOT NULL,
	`target_step_id` text NOT NULL,
	`handle` text DEFAULT 'out' NOT NULL,
	PRIMARY KEY(`flow_id`, `id`),
	FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flow_execution_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`step_id` text NOT NULL,
	`step_name` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`handle` text,
	`request_json` text,
	`response_json` text,
	`validation_json` text,
	`history_id` text,
	`logs_json` text DEFAULT '[]' NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`execution_id`) REFERENCES `flow_executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`history_id`) REFERENCES `request_history`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `flow_exec_steps_exec_idx` ON `flow_execution_steps` (`execution_id`,`step_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `flow_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`environment_id` text,
	`status` text NOT NULL,
	`trigger` text DEFAULT 'run' NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `flow_executions_flow_idx` ON `flow_executions` (`flow_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `flow_steps` (
	`id` text NOT NULL,
	`flow_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`overrides_json` text DEFAULT '{}' NOT NULL,
	`expression` text DEFAULT '' NOT NULL,
	`fail_on_http_error` integer DEFAULT true NOT NULL,
	`position_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`flow_id`, `id`),
	FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `flow_steps_request_idx` ON `flow_steps` (`request_id`);--> statement-breakpoint
CREATE TABLE `flows` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text,
	`name` text NOT NULL,
	`description` text,
	`settings_json` text DEFAULT '{"stopOnError":true}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE set null
);
