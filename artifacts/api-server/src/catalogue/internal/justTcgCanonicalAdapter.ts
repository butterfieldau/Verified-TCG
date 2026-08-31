import {
  normalizeCollectorNumber,
  normalizeGameSlug,
  normalizeForMatching,
  normalizeSetCode,
  normalizeText,
} from "./catalogueNormalisation.js";

/** Minimal provider shape kept separate from public route response shaping. */
export interface JustTcgProviderCard {
  id: string;
  game?: string;
  game_id?: string;
  name?: string;
  set?: string;
  set_id?: string;
  set_name?: string;
  set_code?: string;
  number?: string;
  image_url?: string;
  imageUrl?: string;
  tcgplayerId?: string | number;
  rarity?: string;
  language?: string;
  region?: string;
  finish?: string;
  edition?: string;
  stamp?: string;
  variant?: string;
  variant_name?: string;
  is_foil?: boolean;
  isFoil?: boolean;
  updated_at?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

function tcgPlayerImageUrl(value: unknown): string | null {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return /^\d+$/.test(id)
    ? `https://product-images.tcgplayer.com/fit-in/1000x1000/${id}.jpg`
    : null;
}

export interface CatalogueVariantEvidence {
  key: string;
  name: string | null;
  finish: string | null;
  edition: string | null;
  stamp: string | null;
  language: string | null;
  region: string | null;
}

export interface JustTcgCanonicalCandidate {
  providerKey: "justtcg";
  externalId: string;
  gameSlug: string | null;
  gameExternalId: string | null;
  name: string;
  setName: string | null;
  setCode: string | null;
  setExternalId: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  imageUrl: string | null;
  language: string | null;
  region: string | null;
  variant: CatalogueVariantEvidence | null;
  sourceUpdatedAt: Date | null;
  raw: JustTcgProviderCard;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && normalizeText(value)
    ? normalizeText(value)
    : null;
}

/**
 * Variants are created only from explicit upstream fields. A missing field is
 * deliberately not turned into an invented "default" variant.
 */
function explicitVariant(
  card: JustTcgProviderCard,
): CatalogueVariantEvidence | null {
  const finish =
    optionalText(card.finish) ??
    (card.is_foil === true || card.isFoil === true ? "Foil" : null);
  const edition = optionalText(card.edition);
  const stamp = optionalText(card.stamp);
  const name = optionalText(card.variant_name ?? card.variant);
  if (!finish && !edition && !stamp && !name) return null;

  const key = [finish, edition, stamp, name]
    .filter((part): part is string => Boolean(part))
    .map(normalizeForMatching)
    .filter(Boolean)
    .join("-");
  if (!key) return null;
  return {
    key,
    name,
    finish,
    edition,
    stamp,
    language: optionalText(card.language),
    region: optionalText(card.region),
  };
}

export function normalizeJustTcgCard(
  card: JustTcgProviderCard,
): JustTcgCanonicalCandidate {
  return {
    providerKey: "justtcg",
    externalId: String(card.id),
    gameSlug:
      typeof card.game === "string" ? normalizeGameSlug(card.game) : null,
    gameExternalId: optionalText(card.game_id),
    name: normalizeText(String(card.name ?? "")),
    setName:
      typeof (card.set_name ?? card.set) === "string"
        ? normalizeText(String(card.set_name ?? card.set))
        : null,
    setCode: normalizeSetCode(
      typeof card.set_code === "string" ? card.set_code : null,
    ),
    setExternalId: optionalText(card.set_id),
    collectorNumber: normalizeCollectorNumber(
      typeof card.number === "string" ? card.number : null,
    ),
    rarity: optionalText(card.rarity),
    imageUrl:
      optionalText(card.image_url ?? card.imageUrl) ??
      tcgPlayerImageUrl(card.tcgplayerId),
    language: optionalText(card.language),
    region: optionalText(card.region),
    variant: explicitVariant(card),
    sourceUpdatedAt: (() => {
      const raw = optionalText(card.updated_at ?? card.updatedAt);
      if (!raw) return null;
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? null : date;
    })(),
    raw: card,
  };
}
