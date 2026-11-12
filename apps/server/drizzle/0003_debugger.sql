ALTER TABLE `flow_executions` ADD `paused_step_id` text;--> statement-breakpoint
ALTER TABLE `flow_steps` ADD `breakpoint` integer DEFAULT false NOT NULL;