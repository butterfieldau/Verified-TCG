CREATE TABLE IF NOT EXISTS "collection_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "collection_lists_user_name_uniq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_lists_user_position_idx" ON "collection_lists" ("user_id","position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_list_items" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "list_id" uuid NOT NULL REFERENCES "collection_lists"("id") ON DELETE CASCADE,
  "collection_item_id" uuid NOT NULL REFERENCES "collection_items"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "collection_list_items_list_holding_uniq" UNIQUE("list_id","collection_item_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_list_items_holding_idx" ON "collection_list_items" ("collection_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_list_items_user_list_idx" ON "collection_list_items" ("user_id","list_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_preferences" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "view_mode" text DEFAULT 'grid' NOT NULL,
  "selected_list_id" uuid REFERENCES "collection_lists"("id") ON DELETE SET NULL,
  "filter_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sort_key" text DEFAULT 'date_desc' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);