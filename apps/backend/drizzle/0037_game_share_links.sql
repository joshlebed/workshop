CREATE TABLE "game_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date_key" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "game_share_links" ADD CONSTRAINT "game_share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_share_links_user_date_idx" ON "game_share_links" USING btree ("user_id","date_key");