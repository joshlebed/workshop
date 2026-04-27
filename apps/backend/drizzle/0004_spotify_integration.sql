CREATE TABLE "spotify_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"spotify_user_id" text NOT NULL,
	"spotify_display_name" text,
	"scope" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotify_album_saves" (
	"user_id" uuid NOT NULL,
	"spotify_album_id" text NOT NULL,
	"name" text NOT NULL,
	"artists" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text,
	"release_date" text,
	"total_tracks" integer,
	"spotify_url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spotify_album_saves_user_id_spotify_album_id_pk" PRIMARY KEY("user_id","spotify_album_id")
);
--> statement-breakpoint
CREATE TABLE "spotify_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_verifier" text NOT NULL,
	"app_redirect" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spotify_accounts" ADD CONSTRAINT "spotify_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_album_saves" ADD CONSTRAINT "spotify_album_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_oauth_states" ADD CONSTRAINT "spotify_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spotify_album_saves_user_created_idx" ON "spotify_album_saves" USING btree ("user_id","created_at");