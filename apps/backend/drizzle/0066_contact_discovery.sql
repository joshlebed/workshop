CREATE TABLE "contact_discovery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"count" integer,
	"matched_count" integer,
	"detail" text,
	"target_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_contact_handles" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_contact_handles_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "user_contact_handles_kind_check" CHECK ("user_contact_handles"."kind" IN ('email', 'phone'))
);
--> statement-breakpoint
ALTER TABLE "contact_discovery_events" ADD CONSTRAINT "contact_discovery_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_discovery_events" ADD CONSTRAINT "contact_discovery_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact_handles" ADD CONSTRAINT "user_contact_handles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_discovery_events_event_idx" ON "contact_discovery_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "contact_discovery_events_user_idx" ON "contact_discovery_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_contact_handles_hash_idx" ON "user_contact_handles" USING btree ("hash");