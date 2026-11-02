CREATE TABLE `message_receipts` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`delivered` integer DEFAULT false NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`delivered_at` text,
	`read_at` text,
	PRIMARY KEY(`message_id`, `user_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `receipts_by_user` ON `message_receipts` (`user_id`);
--> statement-breakpoint
INSERT INTO message_receipts (message_id, user_id, delivered, read)
SELECT m.id, p.user_id, CASE WHEN p.read_through >= m.seq THEN 1 ELSE 0 END,
  CASE WHEN p.read_through >= m.seq THEN 1 ELSE 0 END
FROM messages m JOIN participants p ON p.conversation_id = m.conversation_id
WHERE p.user_id <> m.author_id AND p.user_id <> 'system';
