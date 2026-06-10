CREATE TABLE "item_acceptances" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_acceptances_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "letterboxd_watchlist_films" (
	"user_id" uuid NOT NULL,
	"film_slug" text NOT NULL,
	"title" text,
	"year" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letterboxd_watchlist_films_user_id_film_slug_pk" PRIMARY KEY("user_id","film_slug")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "suggestion_state" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "letterboxd_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "letterboxd_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_acceptances" ADD CONSTRAINT "item_acceptances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_acceptances" ADD CONSTRAINT "item_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letterboxd_watchlist_films" ADD CONSTRAINT "letterboxd_watchlist_films_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letterboxd_watchlist_films_slug_idx" ON "letterboxd_watchlist_films" USING btree ("film_slug");