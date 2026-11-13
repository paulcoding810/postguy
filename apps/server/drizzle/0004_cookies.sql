CREATE TABLE `cookies` (
	`id` text PRIMARY KEY NOT NULL,
	`jar` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`domain` text NOT NULL,
	`path` text NOT NULL,
	`host_only` integer DEFAULT true NOT NULL,
	`secure` integer DEFAULT false NOT NULL,
	`http_only` integer DEFAULT false NOT NULL,
	`same_site` text,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cookies_jar_key_uq` ON `cookies` (`jar`,`domain`,`path`,`name`);