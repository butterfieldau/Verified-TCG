CREATE TABLE IF NOT EXISTS "collection_import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "content_sha256" text NOT NULL,
  "status" text DEFAULT 'previewed' NOT NULL,
  "source_currency" text,
  "normalized_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "preview_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "commit_summary" jsonb,
  "commit_results" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "committed_at" timestamp with time zone,
  CONSTRAINT "collection_import_jobs_user_hash_uniq" UNIQUE("user_id","content_sha256")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_import_jobs_user_created_idx"
  ON "collection_import_jobs" ("user_id","created_at");