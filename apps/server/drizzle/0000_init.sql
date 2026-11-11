CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`auth_json` text DEFAULT '{"type":"none"}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`openapi_spec_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collections_parent_idx` ON `collections` (`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `openapi_specs` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`current_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openapi_specs_collection_id_unique` ON `openapi_specs` (`collection_id`);--> statement-breakpoint
CREATE TABLE `openapi_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`spec_id` text NOT NULL,
	`label` text NOT NULL,
	`raw_text` text NOT NULL,
	`model_json` text NOT NULL,
	`hash` text NOT NULL,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`spec_id`) REFERENCES `openapi_specs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `openapi_versions_spec_idx` ON `openapi_versions` (`spec_id`,`imported_at`);--> statement-breakpoint
CREATE TABLE `request_history` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`environment_id` text,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`request_json` text NOT NULL,
	`status` integer,
	`status_text` text,
	`response_headers_json` text DEFAULT '{}' NOT NULL,
	`response_body` text,
	`truncated` integer DEFAULT false NOT NULL,
	`body_size` integer DEFAULT 0 NOT NULL,
	`content_type` text,
	`timing_json` text NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `history_request_idx` ON `request_history` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `history_created_idx` ON `request_history` (`created_at`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`method` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`params_json` text DEFAULT '[]' NOT NULL,
	`path_params_json` text DEFAULT '[]' NOT NULL,
	`headers_json` text DEFAULT '[]' NOT NULL,
	`auth_json` text DEFAULT '{"type":"inherit"}' NOT NULL,
	`body_json` text DEFAULT '{"mode":"none"}' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`openapi_operation_id` text,
	`openapi_fingerprint` text,
	`latest_success_snapshot_id` text,
	`pinned_snapshot_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `requests_collection_idx` ON `requests` (`collection_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `requests_operation_idx` ON `requests` (`openapi_operation_id`);--> statement-breakpoint
CREATE TABLE `response_schemas` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`schema_json` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `response_schemas_hash_unique` ON `response_schemas` (`hash`);--> statement-breakpoint
CREATE TABLE `response_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`history_id` text,
	`schema_id` text NOT NULL,
	`status` integer NOT NULL,
	`is_success` integer NOT NULL,
	`body_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`paths_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`history_id`) REFERENCES `request_history`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`schema_id`) REFERENCES `response_schemas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshots_request_idx` ON `response_snapshots` (`request_id`,`is_success`,`created_at`);--> statement-breakpoint
CREATE TABLE `variables` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`is_secret` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variables_owner_key_uq` ON `variables` (`scope`,`owner_id`,`key`);