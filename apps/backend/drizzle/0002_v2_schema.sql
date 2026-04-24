CREATE TYPE "public"."activity_event_type" AS ENUM('list_created', 'member_joined', 'member_left', 'member_removed', 'item_added', 'item_updated', 'item_deleted', 'item_upvoted', 'item_unupvoted', 'item_completed', 'item_uncompleted', 'invite_created', 'invite_revoked');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('apple', 'google');--> statement-breakpoint
CREATE TYPE "public"."list_type" AS ENUM('movie', 'tv', 'book', 'date_idea', 'trip');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" "activity_event_type" NOT NULL,
	"item_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_upvotes" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_upvotes_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"type" "list_type" NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_by" uuid NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"email" text,
	"token" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "list_members" (
	"list_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_members_list_id_user_id_pk" PRIMARY KEY("list_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "list_type" NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_cache" (
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_cache_source_source_id_pk" PRIMARY KEY("source","source_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_bucket_key_window_start_pk" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
CREATE TABLE "user_activity_reads" (
	"user_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_activity_reads_user_id_list_id_pk" PRIMARY KEY("user_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider" "auth_provider" NOT NULL,
	"provider_sub" text NOT NULL,
	"email" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_upvotes" ADD CONSTRAINT "item_upvotes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_upvotes" ADD CONSTRAINT "item_upvotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_invites" ADD CONSTRAINT "list_invites_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_invites" ADD CONSTRAINT "list_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_reads" ADD CONSTRAINT "user_activity_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_reads" ADD CONSTRAINT "user_activity_reads_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_list_created_idx" ON "activity_events" USING btree ("list_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_events_actor_created_idx" ON "activity_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "item_upvotes_user_idx" ON "item_upvotes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_list_idx" ON "items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "items_list_completed_created_idx" ON "items" USING btree ("list_id","completed","created_at");--> statement-breakpoint
CREATE INDEX "list_invites_list_idx" ON "list_invites" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "list_invites_email_idx" ON "list_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "list_members_user_idx" ON "list_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "list_members_one_owner_idx" ON "list_members" USING btree ("list_id") WHERE role = 'owner';--> statement-breakpoint
CREATE INDEX "lists_owner_idx" ON "lists" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "lists_owner_updated_idx" ON "lists" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_sub_idx" ON "users" USING btree ("auth_provider","provider_sub");