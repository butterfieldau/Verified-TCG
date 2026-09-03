CREATE TABLE IF NOT EXISTS "grading_card_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "canonical_card_id" uuid NOT NULL REFERENCES "catalogue_cards"("id") ON DELETE CASCADE,
  "provider_key" text NOT NULL,
  "provider_card_id" text,
  "match_confidence" real,
  "match_method" text,
  "match_status" text DEFAULT 'unmatched' NOT NULL,
  "provider_match" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "grading_card_mappings_card_provider_uniq" UNIQUE("canonical_card_id","provider_key"),
  CONSTRAINT "grading_card_mappings_provider_card_uniq" UNIQUE("provider_key","provider_card_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grading_card_mappings_card_idx" ON "grading_card_mappings" ("canonical_card_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grading_population_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "canonical_card_id" uuid NOT NULL REFERENCES "catalogue_cards"("id") ON DELETE CASCADE,
  "provider_key" text NOT NULL,
  "grader" text NOT NULL,
  "grade_code" text NOT NULL,
  "grade_label" text NOT NULL,
  "raw_grade_label" text,
  "population" integer,
  "total_population" integer,
  "gem_rate" real,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_updated_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "grading_population_snapshots_dedup_uniq" UNIQUE("canonical_card_id","provider_key","grader","grade_code","captured_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grading_population_snapshots_card_captured_idx" ON "grading_population_snapshots" ("canonical_card_id","captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grading_population_snapshots_card_grader_idx" ON "grading_population_snapshots" ("canonical_card_id","grader","captured_at");
