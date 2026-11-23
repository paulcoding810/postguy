CREATE TABLE `graphql_schemas` (
	`request_id` text PRIMARY KEY NOT NULL,
	`schema_json` text NOT NULL,
	`url` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
