CREATE TABLE "crew_members" (
	"crew_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"friendships_formed" integer DEFAULT 0 NOT NULL,
	"client" text,
	"platform" text,
	"app_version" text,
	CONSTRAINT "crew_members_crew_id_user_id_pk" PRIMARY KEY("crew_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crews_token_unique" UNIQUE("token"),
	CONSTRAINT "crews_name_check" CHECK (char_length(btrim("crews"."name")) > 0 AND char_length("crews"."name") <= 40)
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_members_user_idx" ON "crew_members" USING btree ("user_id");