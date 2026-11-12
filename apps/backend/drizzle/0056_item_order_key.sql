ALTER TABLE "items" ADD COLUMN "order_key" integer;--> statement-breakpoint
CREATE INDEX "items_list_order_key_idx" ON "items" USING btree ("list_id","order_key");