/** Provider-independent, conservative catalogue matching normalisation. */

const GAME_ALIASES: Record<string, string> = {
  pokemon: "pokemon",
  "pokemon tcg": "pokemon",
  "pokemon trading card game": "pokemon",
  "one piece": "one-piece",
  onepiece: "one-piece",
  "one piece card game": "one-piece",
  mtg: "magic-the-gathering",
  magic: "magic-the-gathering",
  "magic the gathering": "magic-the-gathering",
  yugioh: "yu-gi-oh",
  "yu gi oh": "yu-gi-oh",
  "yu gi oh!": "yu-gi-oh",
  "dragon ball": "dragon-ball",
  dragonball: "dragon-ball",
  "dragon ball super": "dragon-ball",
  lorcana: "lorcana",
  "disney lorcana": "lorcana",
  digimon: "digimon",
};

export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Lookup-only form. The original display value is always retained separately. */
export function normalizeForMatching(value: string): string {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.·_]+/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function normalizeGameSlug(value: string): string | null {
  const normalized = normalizeForMatching(value);
  return GAME_ALIASES[normalized] ?? null;
}

/**
 * Preserves meaningful leading zeroes, prefixes, and fractions. It only
 * canonicalises Unicode, case, whitespace and separators around / and -.
 */
export function normalizeCollectorNumber(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = normalizeText(value)
    .toUpperCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, "-");
  return normalized || null;
}

export function normalizeSetCode(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = normalizeText(value)
    .toUpperCase()
    .replace(/\s*[-/]\s*/g, (match) => match.trim());
  return normalized || null;
}
