import { z } from "zod";
import { buildApiUrl, publicConfig } from "./public-config.ts";

const priceSchema = z
  .object({
    raw: z.number().finite(),
    formatted: z.string().optional(),
    currency: z.string().optional(),
  })
  .passthrough();

const wishlistCardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    setName: z.string().optional(),
    setCode: z.string().optional(),
    number: z.string().optional(),
    rarity: z.string().optional(),
    image: z.string().optional(),
    price: priceSchema.optional(),
  })
  .passthrough();

const wishlistItemSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  card: wishlistCardSchema,
  desiredGrade: z.string().nullable().optional(),
  targetPrice: z.number().finite().nullable().optional(),
  addedAt: z.string().min(1),
});

const publicWishlistSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  items: z.array(wishlistItemSchema),
});

export function parsePublicWishlist(value: unknown): WishlistData | null {
  const parsed = publicWishlistSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type WishlistCard = z.infer<typeof wishlistCardSchema>;
export type WishlistItem = z.infer<typeof wishlistItemSchema>;
export type WishlistData = z.infer<typeof publicWishlistSchema>;

export function selectWishlistForUsername(
  data: WishlistData | null,
  username: string,
): WishlistData | null {
  return data?.username === username ? data : null;
}

export class PublicApiError extends Error {
  public readonly kind:
    | "not_found"
    | "private"
    | "unavailable"
    | "invalid_response"
    | "request_failed";
  public readonly status?: number;

  constructor(
    kind:
      | "not_found"
      | "private"
      | "unavailable"
      | "invalid_response"
      | "request_failed",
    status?: number,
  ) {
    super(kind);
    this.name = "PublicApiError";
    this.kind = kind;
    this.status = status;
  }
}

export async function fetchPublicWishlist(
  username: string,
  signal?: AbortSignal,
): Promise<WishlistData> {
  let response: Response;
  try {
    response = await fetch(
      buildApiUrl(`/collectors/${encodeURIComponent(username)}/wishlist`),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-app-version": publicConfig.clientVersion,
        },
        cache: "no-store",
        signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new PublicApiError("request_failed");
  }

  if (response.status === 404) {
    throw new PublicApiError("not_found", response.status);
  }
  if (response.status === 403) {
    throw new PublicApiError("private", response.status);
  }
  if (response.status === 426 || response.status >= 500) {
    throw new PublicApiError("unavailable", response.status);
  }
  if (!response.ok) {
    throw new PublicApiError("request_failed", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PublicApiError("invalid_response", response.status);
  }

  const parsed = parsePublicWishlist(body);
  if (!parsed) {
    throw new PublicApiError("invalid_response", response.status);
  }
  return parsed;
}