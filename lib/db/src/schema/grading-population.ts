/**
 * Provider-neutral graded-population data.  These records complement the
 * JustTCG catalogue; neither provider IDs nor population rows replace public
 * JustTCG card IDs or pricing mappings.
 */
import { index, integer, jsonb, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { catalogueCardsTable } from "./canonical-catalogue";

export const gradingCardMappingsTable = pgTable(
  "grading_card_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalCardId: uuid("canonical_card_id")
      .notNull()
      .references(() => catalogueCardsTable.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    providerCardId: text("provider_card_id"),
    matchConfidence: real("match_confidence"),
    matchMethod: text("match_method"),
    matchStatus: text("match_status").notNull().default("unmatched"),
    providerMatch: jsonb("provider_match").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("grading_card_mappings_card_provider_uniq").on(t.canonicalCardId, t.providerKey),
    unique("grading_card_mappings_provider_card_uniq").on(t.providerKey, t.providerCardId),
    index("grading_card_mappings_card_idx").on(t.canonicalCardId),
  ],
);

export const gradingPopulationSnapshotsTable = pgTable(
  "grading_population_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalCardId: uuid("canonical_card_id")
      .notNull()
      .references(() => catalogueCardsTable.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    grader: text("grader").notNull(),
    gradeCode: text("grade_code").notNull(),
    gradeLabel: text("grade_label").notNull(),
    rawGradeLabel: text("raw_grade_label"),
    population: integer("population"),
    totalPopulation: integer("total_population"),
    gemRate: real("gem_rate"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    unique("grading_population_snapshots_dedup_uniq").on(
      t.canonicalCardId, t.providerKey, t.grader, t.gradeCode, t.capturedAt,
    ),
    index("grading_population_snapshots_card_captured_idx").on(t.canonicalCardId, t.capturedAt),
    index("grading_population_snapshots_card_grader_idx").on(t.canonicalCardId, t.grader, t.capturedAt),
  ],
);
