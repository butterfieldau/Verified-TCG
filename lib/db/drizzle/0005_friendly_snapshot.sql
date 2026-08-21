CREATE TABLE IF NOT EXISTS "card_price_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" text NOT NULL,
  "provider_key" text NOT NULL,
  "provider_product_id" text,
  "grade_key" text NOT NULL,
  "price_cents" integer,
  "currency" text DEFAULT 'USD' NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "snapshot_bucket" text NOT NULL,
  "capture_status" text DEFAULT 'success' NOT NULL,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "card_price_snapshots_card_provider_grade_bucket_uniq"
    UNIQUE("card_id", "provider_key", "grade_key", "snapshot_bucket")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_price_snapshots_card_grade_captured_idx"
  ON "card_price_snapshots" ("card_id", "grade_key", "captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_price_snapshots_provider_product_idx"
  ON "card_price_snapshots" ("provider_product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_price_snapshots_bucket_idx"
  ON "card_price_snapshots" ("snapshot_bucket");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_price_snapshots_captured_idx"
  ON "card_price_snapshots" ("captured_at");
--> statement-breakpoint
ALTER TABLE IF EXISTS "card_provider_mappings"
  ADD COLUMN IF NOT EXISTS "provider_epid" text;
