DROP TABLE "item_upvotes" CASCADE;
--> statement-breakpoint
UPDATE "lists" SET "modules" = array_remove("modules", 'voting') WHERE 'voting' = ANY("modules");
--> statement-breakpoint
DELETE FROM "activity_events" WHERE "event_type" IN ('item_upvoted', 'item_unupvoted');
