ALTER TABLE `participants` ADD `cleared_through` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `hidden` integer DEFAULT false NOT NULL;