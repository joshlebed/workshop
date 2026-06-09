CREATE TABLE "item_tags" (
	"item_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "item_tags_item_id_tag_pk" PRIMARY KEY("item_id","tag")
);
--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_tags_tag_idx" ON "item_tags" USING btree ("tag");