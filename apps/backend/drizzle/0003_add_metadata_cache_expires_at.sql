ALTER TABLE "metadata_cache" ADD COLUMN "expires_at" timestamp with time zone NOT NULL DEFAULT now();
