ALTER TABLE `messages` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `is_admin` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE participants SET is_admin = 1 WHERE EXISTS (
  SELECT 1 FROM conversations c
  WHERE c.id = participants.conversation_id AND c.kind = 'group'
    AND (c.created_by = participants.user_id OR (
      c.created_by = 'system' AND participants.user_id = (
        SELECT p.user_id FROM participants p
        WHERE p.conversation_id = c.id AND p.user_id <> 'system'
        ORDER BY p.user_id LIMIT 1
      )
    ))
);
