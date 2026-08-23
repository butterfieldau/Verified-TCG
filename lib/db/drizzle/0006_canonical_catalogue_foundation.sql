-- Stage 3A: additive, provider-independent catalogue identity foundation.
-- No existing collection, wishlist, pricing, scanner, or provider mapping rows
-- are altered by this migration.
CREATE TABLE IF NOT EXISTS "catalogue_games" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "short_name" text,
  "publisher" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "catalogue_games"("id") ON DELETE RESTRICT,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "code" text,
  "series" text,
  "release_date" text,
  "language" text,
  "region" text,
  "total_cards" integer,
  "printed_total" integer,
  "is_promo_set" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_sets_game_slug_uniq" UNIQUE("game_id", "slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "catalogue_games"("id") ON DELETE RESTRICT,
  "set_id" uuid REFERENCES "catalogue_sets"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "collector_number" text,
  "collector_number_normalized" text,
  "rarity" text,
  "supertype" text,
  "subtypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "card_type" text,
  "language" text,
  "release_date" text,
  "is_promo" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_card_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "catalogue_cards"("id") ON DELETE RESTRICT,
  "variant_key" text NOT NULL,
  "name" text,
  "finish" text,
  "edition" text,
  "stamp" text,
  "language" text,
  "region" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_card_variants_card_key_uniq" UNIQUE("card_id", "variant_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_card_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "catalogue_cards"("id") ON DELETE RESTRICT,
  "variant_id" uuid REFERENCES "catalogue_card_variants"("id") ON DELETE RESTRICT,
  "url" text NOT NULL,
  "image_type" text DEFAULT 'front' NOT NULL,
  "source" text NOT NULL,
  "width" integer,
  "height" integer,
  "checksum" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "alias" text NOT NULL,
  "alias_normalized" text NOT NULL,
  "language" text,
  "alias_type" text NOT NULL,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_external_ids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "provider_key" text NOT NULL,
  "external_id" text NOT NULL,
  "external_url" text,
  "external_slug" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_external_ids_provider_entity_external_uniq" UNIQUE("provider_key", "entity_type", "external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_source_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "provider_key" text NOT NULL,
  "external_id" text NOT NULL,
  "payload_hash" text,
  "raw_payload" jsonb,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_updated_at" timestamp with time zone,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_source_records_provider_entity_external_uniq" UNIQUE("provider_key", "entity_type", "external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_key" text NOT NULL,
  "job_type" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cursor" text,
  "records_read" integer DEFAULT 0 NOT NULL,
  "records_created" integer DEFAULT 0 NOT NULL,
  "records_updated" integer DEFAULT 0 NOT NULL,
  "records_skipped" integer DEFAULT 0 NOT NULL,
  "records_failed" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogue_import_errors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_job_id" uuid NOT NULL REFERENCES "catalogue_import_jobs"("id") ON DELETE CASCADE,
  "provider_key" text NOT NULL,
  "external_id" text,
  "entity_type" text NOT NULL,
  "error_code" text NOT NULL,
  "error_message" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_sets_game_id_idx" ON "catalogue_sets" ("game_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_sets_game_code_idx" ON "catalogue_sets" ("game_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_cards_game_id_idx" ON "catalogue_cards" ("game_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_cards_set_id_idx" ON "catalogue_cards" ("set_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_cards_set_collector_number_idx" ON "catalogue_cards" ("set_id", "collector_number_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_cards_name_idx" ON "catalogue_cards" ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_card_variants_card_id_idx" ON "catalogue_card_variants" ("card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_card_images_card_id_idx" ON "catalogue_card_images" ("card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_card_images_variant_id_idx" ON "catalogue_card_images" ("variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_aliases_normalized_idx" ON "catalogue_aliases" ("entity_type", "alias_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_aliases_entity_idx" ON "catalogue_aliases" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_external_ids_entity_idx" ON "catalogue_external_ids" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_source_records_entity_idx" ON "catalogue_source_records" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_source_records_provider_external_idx" ON "catalogue_source_records" ("provider_key", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_import_jobs_status_idx" ON "catalogue_import_jobs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_import_jobs_provider_idx" ON "catalogue_import_jobs" ("provider_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_import_errors_job_idx" ON "catalogue_import_errors" ("import_job_id");
