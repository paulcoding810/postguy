CREATE TABLE `response_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`status` integer,
	`status_text` text,
	`headers_json` text NOT NULL,
	`content_type` text,
	`body` text NOT NULL,
	`body_encoding` text NOT NULL,
	`request_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `examples_request_idx` ON `response_examples` (`request_id`,`sort_order`);