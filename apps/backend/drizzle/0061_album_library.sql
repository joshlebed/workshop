CREATE TABLE "spotify_albums" (
	"spotify_album_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"artists" jsonb NOT NULL,
	"release_year" integer NOT NULL,
	"album_type" text NOT NULL,
	"track_count" integer NOT NULL,
	"label" text,
	"popularity" integer,
	"image_url" text,
	"image_small_url" text,
	"spotify_url" text NOT NULL,
	"genre" text,
	"subgenre" text,
	"vibes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"energy" integer,
	"mood" integer,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags_known" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotify_library_albums" (
	"user_id" uuid NOT NULL,
	"spotify_album_id" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spotify_library_albums_user_id_spotify_album_id_pk" PRIMARY KEY("user_id","spotify_album_id")
);
--> statement-breakpoint
ALTER TABLE "spotify_library_albums" ADD CONSTRAINT "spotify_library_albums_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_library_albums" ADD CONSTRAINT "spotify_library_albums_spotify_album_id_spotify_albums_spotify_album_id_fk" FOREIGN KEY ("spotify_album_id") REFERENCES "public"."spotify_albums"("spotify_album_id") ON DELETE cascade ON UPDATE no action;