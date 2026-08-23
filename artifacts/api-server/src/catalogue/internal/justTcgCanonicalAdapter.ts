import {
  normalizeCollectorNumber,
  normalizeGameSlug,
  normalizeText,
} from "./catalogueNormalisation.js";

/** Minimal provider shape kept separate from public route response shaping. */
export interface JustTcgProviderCard {
  id: string;
  game?: string;
  name?: string;
  set?: string;
  set_name?: string;
  set_code?: string;
  number?: string;
  image_url?: string;
  rarity?: string;
  [key: string]: unknown;
}

export interface JustTcgCanonicalCandidate {
  providerKey: "justtcg";
  externalId: string;
  gameSlug: string | null;
  name: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  imageUrl: string | null;
  raw: JustTcgProviderCard;
}

export function normalizeJustTcgCard(
  card: JustTcgProviderCard,
): JustTcgCanonicalCandidate {
  return {
    providerKey: "justtcg",
    externalId: String(card.id),
    gameSlug:
      typeof card.game === "string" ? normalizeGameSlug(card.game) : null,
    name: normalizeText(String(card.name ?? "")),
    setName:
      typeof (card.set_name ?? card.set) === "string"
        ? normalizeText(String(card.set_name ?? card.set))
        : null,
    setCode:
      typeof card.set_code === "string" ? normalizeText(card.set_code) : null,
    collectorNumber: normalizeCollectorNumber(
      typeof card.number === "string" ? card.number : null,
    ),
    rarity: typeof card.rarity === "string" ? normalizeText(card.rarity) : null,
    imageUrl: typeof card.image_url === "string" ? card.image_url : null,
    raw: card,
  };
}
