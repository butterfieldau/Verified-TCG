import React, { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  Heart,
  Lock,
  Package,
  RefreshCw,
} from "lucide-react";
import {
  fetchPublicWishlist,
  PublicApiError,
  selectWishlistForUsername,
  type WishlistData,
  type WishlistItem,
} from "@/lib/public-api";
import { publicConfig } from "@/lib/public-config";

type Status = "loading" | "private" | "not_found" | "error" | "stale" | "ok";

export default function CollectorWishlistPage() {
  const params = useParams<{ username: string }>();
  const username = params.username ?? "";
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<WishlistData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const visibleData = selectWishlistForUsername(data, username);

  useEffect(() => {
    if (!username) {
      setStatus("not_found");
      return;
    }

    const controller = new AbortController();
    let active = true;
    const hadData = selectWishlistForUsername(data, username) !== null;
    if (!hadData) {
      setData(null);
    }
    setStatus(hadData ? "stale" : "loading");
    setErrorMessage(null);

    const load = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const nextData = await fetchPublicWishlist(username, controller.signal);
          if (!active) return;
          setData(nextData);
          setStatus("ok");
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          lastError = error;
          if (error instanceof PublicApiError && ["not_found", "private"].includes(error.kind)) {
            break;
          }
          if (attempt === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
      }

      if (!active) return;
      const apiError = lastError instanceof PublicApiError ? lastError : null;
      if (apiError?.kind === "not_found") {
        setStatus("not_found");
      } else if (apiError?.kind === "private") {
        setStatus("private");
      } else {
        setStatus(hadData ? "stale" : "error");
        setErrorMessage(getErrorMessage(apiError));
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
    // data is intentionally read only when deciding whether a refresh is stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, retryCount]);

  return (
    <div className="min-h-screen bg-[#0C0C0F] text-white">
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white/60 hover:text-white transition-colors flex items-center gap-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded">
          <ArrowLeft size={16} aria-hidden="true" />
          Verified TCG
        </Link>
        <span className="text-white/20" aria-hidden="true">/</span>
        {status === "ok" && visibleData ? (
          <>
            <span className="text-white/60 text-sm">{visibleData.displayName}</span>
            <span className="text-white/20" aria-hidden="true">/</span>
            <span className="text-white text-sm font-medium">Wishlist</span>
          </>
        ) : (
          <span className="text-white/40 text-sm">{username}</span>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {status === "loading" && <LoadingState />}
        {status === "private" && (
          <StateMessage icon={<Lock size={28} aria-hidden="true" />} title="Wishlist is private">
            <p>@{username} keeps their wishlist private.</p>
            <a href={`mailto:${publicConfig.supportEmail}`} className="mt-2 inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 transition-colors text-white text-sm font-medium px-5 py-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
              Contact support
            </a>
          </StateMessage>
        )}
        {status === "not_found" && (
          <StateMessage icon={<AlertCircle size={28} aria-hidden="true" />} title="Collector not found">
            <p>No collector with username @{username} was found.</p>
          </StateMessage>
        )}
        {status === "error" && (
          <StateMessage icon={<AlertCircle size={28} aria-hidden="true" />} title="Wishlist unavailable">
            <p>{errorMessage ?? "Unable to load this wishlist right now."}</p>
            <RetryButton onClick={() => setRetryCount((count) => count + 1)} />
          </StateMessage>
        )}

        {(status === "ok" || status === "stale") && visibleData && (
          <>
            {status === "stale" && (
              <div className="mb-6 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-100 flex items-center justify-between gap-4" role="status">
                <span>{errorMessage ?? "Showing the last verified wishlist while we reconnect."}</span>
                <RetryButton onClick={() => setRetryCount((count) => count + 1)} compact />
              </div>
            )}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center">
                <Heart size={20} className="text-red-400" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{visibleData.displayName}'s Wishlist</h1>
                <p className="text-white/40 text-sm">@{visibleData.username} · {visibleData.items.length} card{visibleData.items.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            {visibleData.items.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                  <Package size={28} className="text-white/40" aria-hidden="true" />
                </div>
                <p className="text-white/50 text-sm">No cards on the wishlist yet.</p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {visibleData.items.map((item) => <WishlistCard key={item.id} item={item} />)}
            </div>
            {visibleData.items.length > 0 && (
              <div className="mt-10 rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
                <p className="text-white/70 text-sm mb-3">Have any of these cards? Connect on Verified TCG to make a trade offer.</p>
                {publicConfig.appUrl ? (
                  <a href={publicConfig.appUrl} className="inline-flex items-center rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
                    Open Verified TCG
                  </a>
                ) : (
                  <p className="text-white/40 text-xs">Open the Verified TCG mobile app to connect. App download links are not published yet.</p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function getErrorMessage(error: PublicApiError | null): string {
  if (error?.kind === "unavailable") return "The Verified TCG service is temporarily unavailable. Your wishlist was not replaced with empty data.";
  if (error?.kind === "invalid_response") return "The service returned data we could not safely display. Please try again later.";
  return "Unable to load this wishlist. Please try again.";
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-white/40" role="status" aria-live="polite">
      <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-red-500 animate-spin" />
      <p className="text-sm">Loading wishlist…</p>
    </div>
  );
}

function StateMessage({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center" role="status">
      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-white/40">{icon}</div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="text-white/50 text-sm max-w-xs">{children}</div>
    </div>
  );
}

function RetryButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`${compact ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm"} inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 rounded-xl font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300`}>
      <RefreshCw size={compact ? 13 : 15} aria-hidden="true" />
      Try again
    </button>
  );
}

function WishlistCard({ item }: { item: WishlistItem }) {
  const card = item.card;
  const [imageFailed, setImageFailed] = useState(false);
  const price = card.price?.raw;
  const hue = [...card.name].reduce((acc, character) => acc + character.charCodeAt(0), 0) % 360;
  const thumbBg = `hsl(${hue}, 45%, 28%)`;
  const initial = card.name[0]?.toUpperCase() ?? "?";

  return (
    <div className="rounded-2xl bg-white/5 border border-white/8 p-4 flex items-center gap-4">
      {card.image && !imageFailed ? (
        <img src={card.image} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" onError={() => setImageFailed(true)} />
      ) : (
        <div className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: thumbBg }} aria-hidden="true">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{card.name}</p>
        <p className="text-white/40 text-sm truncate">{card.setName ?? "Set details unavailable"}</p>
        {item.desiredGrade && <span className="inline-block mt-1 text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded-full">{item.desiredGrade}</span>}
      </div>
      <div className="text-right flex-shrink-0">
        {price != null && <p className="font-semibold text-sm">${price.toLocaleString("en-AU")}<span className="text-white/40 font-normal"> AUD</span></p>}
        {item.targetPrice != null && <p className="text-xs text-white/40 mt-0.5">Target: ${item.targetPrice.toLocaleString("en-AU")}</p>}
      </div>
    </div>
  );
}