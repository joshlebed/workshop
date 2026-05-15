ALTER TYPE "public"."list_type" ADD VALUE 'game';--> statement-breakpoint
CREATE TABLE "game_scores" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"score" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_scores_item_id_user_id_date_pk" PRIMARY KEY("item_id","user_id","date")
);
--> statement-breakpoint
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_scores_item_date_idx" ON "game_scores" USING btree ("item_id","date");--> statement-breakpoint
CREATE INDEX "game_scores_user_date_idx" ON "game_scores" USING btree ("user_id","date");