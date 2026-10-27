CREATE TABLE `attachment_chunks` (
	`attachment_id` text NOT NULL,
	`offset` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`attachment_id`, `offset`)
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`message_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachments_by_message` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `attachments_pending` ON `attachments` (`message_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`pair_key` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`author_id` text NOT NULL,
	`text` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_by_conversation` ON `messages` (`conversation_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id` ON `messages` (`id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_through` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_by_user` ON `participants` (`user_id`);