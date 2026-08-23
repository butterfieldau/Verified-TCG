/**
 * Verified TCG's provider-independent catalogue identity layer.
 *
 * These tables are deliberately additive. Existing collections, wishlists,
 * scanner reads and PriceCharting mappings continue to use their current
 * external text card IDs until a later, separately validated cutover.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const catalogueGamesTable = pgTable("catalogue_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  publisher: text("publisher"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const catalogueSetsTable = pgTable(
  "catalogue_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => catalogueGamesTable.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    code: text("code"),
    series: text("series"),
    releaseDate: text("release_date"),
    language: text("language"),
    region: text("region"),
    totalCards: integer("total_cards"),
    printedTotal: integer("printed_total"),
    isPromoSet: boolean("is_promo_set").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("catalogue_sets_game_slug_uniq").on(t.gameId, t.slug),
    index("catalogue_sets_game_id_idx").on(t.gameId),
    index("catalogue_sets_game_code_idx").on(t.gameId, t.code),
  ],
);

export const catalogueCardsTable = pgTable(
  "catalogue_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => catalogueGamesTable.id, { onDelete: "restrict" }),
    setId: uuid("set_id").references(() => catalogueSetsTable.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    collectorNumber: text("collector_number"),
    collectorNumberNormalized: text("collector_number_normalized"),
    rarity: text("rarity"),
    supertype: text("supertype"),
    subtypes: jsonb("subtypes").notNull().default([]),
    cardType: text("card_type"),
    language: text("language"),
    releaseDate: text("release_date"),
    isPromo: boolean("is_promo").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("catalogue_cards_game_id_idx").on(t.gameId),
    index("catalogue_cards_set_id_idx").on(t.setId),
    index("catalogue_cards_set_collector_number_idx").on(
      t.setId,
      t.collectorNumberNormalized,
    ),
    index("catalogue_cards_name_idx").on(t.name),
  ],
);

export const catalogueCardVariantsTable = pgTable(
  "catalogue_card_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => catalogueCardsTable.id, { onDelete: "restrict" }),
    variantKey: text("variant_key").notNull(),
    name: text("name"),
    finish: text("finish"),
    edition: text("edition"),
    stamp: text("stamp"),
    language: text("language"),
    region: text("region"),
    isDefault: boolean("is_default").notNull().default(false),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("catalogue_card_variants_card_key_uniq").on(t.cardId, t.variantKey),
    index("catalogue_card_variants_card_id_idx").on(t.cardId),
  ],
);

export const catalogueCardImagesTable = pgTable(
  "catalogue_card_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => catalogueCardsTable.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").references(
      () => catalogueCardVariantsTable.id,
      { onDelete: "restrict" },
    ),
    url: text("url").notNull(),
    imageType: text("image_type").notNull().default("front"),
    source: text("source").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("catalogue_card_images_card_id_idx").on(t.cardId),
    index("catalogue_card_images_variant_id_idx").on(t.variantId),
  ],
);

/** Polymorphic lookup aliases; entity integrity is maintained by the repository. */
export const catalogueAliasesTable = pgTable(
  "catalogue_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    alias: text("alias").notNull(),
    aliasNormalized: text("alias_normalized").notNull(),
    language: text("language"),
    aliasType: text("alias_type").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("catalogue_aliases_normalized_idx").on(
      t.entityType,
      t.aliasNormalized,
    ),
    index("catalogue_aliases_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Provider-neutral identifiers. Provider IDs never become canonical UUIDs. */
export const catalogueExternalIdsTable = pgTable(
  "catalogue_external_ids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    providerKey: text("provider_key").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    externalSlug: text("external_slug"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("catalogue_external_ids_provider_entity_external_uniq").on(
      t.providerKey,
      t.entityType,
      t.externalId,
    ),
    index("catalogue_external_ids_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const catalogueSourceRecordsTable = pgTable(
  "catalogue_source_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    providerKey: text("provider_key").notNull(),
    externalId: text("external_id").notNull(),
    payloadHash: text("payload_hash"),
    rawPayload: jsonb("raw_payload"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("catalogue_source_records_provider_entity_external_uniq").on(
      t.providerKey,
      t.entityType,
      t.externalId,
    ),
    index("catalogue_source_records_entity_idx").on(t.entityType, t.entityId),
    index("catalogue_source_records_provider_external_idx").on(
      t.providerKey,
      t.externalId,
    ),
  ],
);

export const catalogueImportJobsTable = pgTable(
  "catalogue_import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerKey: text("provider_key").notNull(),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cursor: text("cursor"),
    recordsRead: integer("records_read").notNull().default(0),
    recordsCreated: integer("records_created").notNull().default(0),
    recordsUpdated: integer("records_updated").notNull().default(0),
    recordsSkipped: integer("records_skipped").notNull().default(0),
    recordsFailed: integer("records_failed").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("catalogue_import_jobs_status_idx").on(t.status),
    index("catalogue_import_jobs_provider_idx").on(t.providerKey),
  ],
);

export const catalogueImportErrorsTable = pgTable(
  "catalogue_import_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => catalogueImportJobsTable.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    externalId: text("external_id"),
    entityType: text("entity_type").notNull(),
    errorCode: text("error_code").notNull(),
    errorMessage: text("error_message").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("catalogue_import_errors_job_idx").on(t.importJobId)],
);
