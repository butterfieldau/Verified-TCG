import React, { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  Heart,
  ArrowLeft,
  AlertCircle,
  Lock,
  Package,
} from "lucide-react";
import packageMetadata from "../../package.json";

interface WishlistCard {
  id: string;
  name: string;
  setName: string;
  setCode?: string;
  number?: string;
  rarity?: string;
  image?: string;
  price?: { raw: number; formatted?: string; currency?: string };
  [key: string]: unknown;
}

interface WishlistItem {
  id: string;
  cardId: string;
  card: WishlistCard;
  desiredGrade?: string;
  targetPrice?: number;
  addedAt: string;
}

interface WishlistData {
  username: string;
  displayName: string;
  items: WishlistItem[];
}

type Status = "loading" | "private" | "not_found" | "error" | "ok";

function getApiBase(): string {
  return `${window.location.origin}/api`;
}

export default function CollectorWishlistPage() {
  const params = useParams<{ username: string }>();
  const username = params.username ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<WishlistData | null>(null);

  useEffect(() => {
    if (!username) return;

    let cancelled = false;
    setStatus("loading");
    setData(null);

    fetch(`${getApiBase()}/collectors/${encodeURIComponent(username)}/wishlist`, {
      headers: { "x-app-version": packageMetadata.version },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) { setStatus("not_found"); return; }
        if (res.status === 403) { setStatus("private"); return; }
        if (!res.ok) { setStatus("error"); return; }
        const json = await res.json();
        setData(json);
        setStatus("ok");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });

    return () => { cancelled = true; };
  }, [username]);

  return (
    <div className="min-h-screen bg-[#0C0C0F] text-white">
      {/* Nav */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white/60 hover:text-white transition-colors flex items-center gap-2 text-sm">
          <ArrowLeft size={16} />
          Verified TCG
        </Link>
        <span className="text-white/20">/</span>
        {status === "ok" && data ? (
          <>
            <span className="text-white/60 text-sm">{data.displayName}</span>
            <span className="text-white/20">/</span>
            <span className="text-white text-sm font-medium">Wishlist</span>
          </>
        ) : (
          <span className="text-white/40 text-sm">{username}</span>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* Loading */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 py-20 text-white/40">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-red-500 animate-spin" />
            <p className="text-sm">Loading wishlist…</p>
          </div>
        )}

        {/* Private */}
        {status === "private" && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
              <Lock size={28} className="text-white/40" />
            </div>
            <h1 className="text-xl font-semibold">Wishlist is private</h1>
            <p className="text-white/50 text-sm max-w-xs">
              @{username} keeps their wishlist private. Follow them on the app to connect.
            </p>
            <a
              href="https://verifiedtcg.co"
              className="mt-2 inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 transition-colors text-white text-sm font-medium px-5 py-2.5 rounded-xl"
            >
              Get the App
            </a>
          </div>
        )}

        {/* Not found */}
        {status === "not_found" && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
              <AlertCircle size={28} className="text-white/40" />
            </div>
            <h1 className="text-xl font-semibold">Collector not found</h1>
            <p className="text-white/50 text-sm">
              No collector with username @{username} was found.
            </p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
              <AlertCircle size={28} className="text-red-400" />
            </div>
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-white/50 text-sm">Unable to load the wishlist. Please try again later.</p>
          </div>
        )}

        {/* Wishlist */}
        {status === "ok" && data && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center">
                <Heart size={20} className="text-red-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{data.displayName}'s Wishlist</h1>
                <p className="text-white/40 text-sm">@{data.username} · {data.items.length} card{data.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Empty state */}
            {data.items.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                  <Package size={28} className="text-white/40" />
                </div>
                <p className="text-white/50 text-sm">No cards on the wishlist yet.</p>
              </div>
            )}

            {/* Items */}
            <div className="flex flex-col gap-3">
              {data.items.map((item) => (
                <WishlistCard key={item.id} item={item} />
              ))}
            </div>

            {/* CTA */}
            {data.items.length > 0 && (
              <div className="mt-10 rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
                <p className="text-white/70 text-sm mb-3">
                  Have any of these cards? Connect on Verified TCG to make a trade offer.
                </p>
                <a
                  href="https://verifiedtcg.co"
                  className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 transition-colors text-white text-sm font-medium px-5 py-2.5 rounded-xl"
                >
                  Open in App
                </a>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function WishlistCard({ item }: { item: WishlistItem }) {
  const card = item.card;
  const price = typeof card.price === "object" && card.price !== null ? card.price.raw : null;

  // Derive a background color for the thumb from the card name
  const hue = [...(card.name ?? "")].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const thumbBg = `hsl(${hue}, 45%, 28%)`;
  const initial = (card.name ?? "?")[0]?.toUpperCase() ?? "?";

  return (
    <div className="rounded-2xl bg-white/5 border border-white/8 p-4 flex items-center gap-4">
      {/* Thumb */}
      {card.image ? (
        <img
          src={card.image}
          alt={card.name}
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div
          className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-xl"
          style={{ backgroundColor: thumbBg }}
        >
          {initial}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{card.name}</p>
        <p className="text-white/40 text-sm truncate">{card.setName}</p>
        {item.desiredGrade && (
          <span className="inline-block mt-1 text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded-full">
            {item.desiredGrade}
          </span>
        )}
      </div>

      {/* Pricing */}
      <div className="text-right flex-shrink-0">
        {price != null && (
          <p className="font-semibold text-sm">
            ${price.toLocaleString("en-AU")}
            <span className="text-white/40 font-normal"> AUD</span>
          </p>
        )}
        {item.targetPrice != null && (
          <p className="text-xs text-white/40 mt-0.5">
            Target: ${item.targetPrice.toLocaleString("en-AU")}
          </p>
        )}
      </div>
    </div>
  );
}
