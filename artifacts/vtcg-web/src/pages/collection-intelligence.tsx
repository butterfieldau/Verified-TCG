import { useEffect, useState } from "react";
import { LockKeyhole, PackageSearch } from "lucide-react";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { ErrorBanner, SkeletonCard, StatCard } from "@/components/admin-ui";

interface Intelligence {
  collection: {
    entries: number;
    totalQuantity: number;
    uniqueCards: number;
    collectors: number;
    gradedEntries: number;
    forSale: number;
    forTrade: number;
    pricedEntries: number;
    pricingCoveragePercent: number | null;
    trackedValue: {
      valueCents: number;
      currency: string;
      coverageIncomplete: boolean;
    } | null;
  };
  wishlist: {
    activeItems: number;
    uniqueCards: number;
    collectors: number;
    priceAlerts: number;
    missingPricing: number;
  };
  topCollected: { cardId: string; cardName: string; quantity: number; collectors: number }[];
  topWishlisted: { cardId: string; cardName: string; wishlists: number }[];
  quality: {
    invalidQuantity: number;
    invalidCurrency: number;
    missingPricing: number;
    stalePricing: number;
    wishlistMissingPricing: number;
    automaticPrivateDataRepairAvailable: boolean;
  };
  privacy: { collectorIdentitiesIncluded: boolean; note: string };
}

export default function CollectionIntelligencePage() {
  const { logout } = useAuth();
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Intelligence>("/admin/collections/overview")
      .then(setData)
      .catch((err) => {
        if (err instanceof UnauthorizedError) void logout();
        else setError(err instanceof Error ? err.message : "Collection intelligence failed to load.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Collection & wishlist quality</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregate operational insight without exposing collector identities or notes.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="mb-5 flex gap-3 rounded-xl border border-border bg-card p-4">
        <LockKeyhole className="mt-0.5 shrink-0 text-positive" size={18} />
        <div>
          <div className="text-sm font-bold">Aggregate-only privacy boundary</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.privacy.note ?? "Collector identities and private collection details are not returned by this endpoint."}
          </p>
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)
        ) : (
          <>
            <StatCard
              label="COLLECTION ENTRIES"
              value={data.collection.entries}
              sub={`${data.collection.collectors} collectors · ${data.collection.uniqueCards} unique cards`}
            />
            <StatCard
              label="PRICING COVERAGE"
              value={data.collection.pricingCoveragePercent == null ? "No holdings" : `${data.collection.pricingCoveragePercent}%`}
              accent={(data.collection.pricingCoveragePercent ?? 100) < 80}
              sub={`${data.collection.pricedEntries} entries priced`}
            />
            <StatCard
              label="ACTIVE WISHLIST ITEMS"
              value={data.wishlist.activeItems}
              sub={`${data.wishlist.priceAlerts} price alerts`}
            />
            <StatCard
              label="DATA QUALITY SIGNALS"
              value={data.quality.missingPricing + data.quality.stalePricing + data.quality.invalidCurrency + data.quality.invalidQuantity}
              accent={data.quality.missingPricing + data.quality.stalePricing > 0}
              sub={`${data.quality.wishlistMissingPricing} wishlist items missing price`}
            />
          </>
        )}
      </div>

      {data?.collection.trackedValue && (
        <div className="mb-8 rounded-xl border border-border bg-card p-5">
          <div className="text-xs font-bold tracking-wider text-muted-foreground">TRACKED VALUE WITH COVERAGE DISCLOSURE</div>
          <div className="mt-2 font-display text-3xl font-bold">
            {(data.collection.trackedValue.valueCents / 100).toLocaleString(undefined, {
              style: "currency",
              currency: data.collection.trackedValue.currency,
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.collection.trackedValue.coverageIncomplete
              ? "Incomplete: holdings without current quotes are excluded."
              : "All tracked holdings have current quote coverage."}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Leaderboard
          title="MOST COLLECTED"
          empty="No collection records yet."
          rows={(data?.topCollected ?? []).map((row) => ({
            id: row.cardId,
            label: row.cardName,
            value: `${row.quantity.toLocaleString()} cards`,
            sub: `${row.collectors.toLocaleString()} collectors`,
          }))}
        />
        <Leaderboard
          title="MOST WISHLISTED"
          empty="No active wishlist records yet."
          rows={(data?.topWishlisted ?? []).map((row) => ({
            id: row.cardId,
            label: row.cardName,
            value: `${row.wishlists.toLocaleString()} lists`,
            sub: row.cardId,
          }))}
        />
      </div>

      <h2 className="mb-3 mt-8 text-xs font-bold tracking-wider text-muted-foreground">QUALITY DETAILS</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Quality label="Missing collection pricing" value={data?.quality.missingPricing ?? 0} />
        <Quality label="Stale collection pricing" value={data?.quality.stalePricing ?? 0} />
        <Quality label="Wishlist missing pricing" value={data?.quality.wishlistMissingPricing ?? 0} />
        <Quality label="Invalid quantity" value={data?.quality.invalidQuantity ?? 0} />
        <Quality label="Invalid currency" value={data?.quality.invalidCurrency ?? 0} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Private records are never changed automatically from this view. Missing and stale pricing should be repaired through the controlled pricing queue.
      </p>
    </div>
  );
}

function Leaderboard({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { id: string; label: string; value: string; sub: string }[];
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-bold tracking-wider text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="p-10 text-center">
            <PackageSearch className="mx-auto mb-3 text-muted-foreground opacity-50" size={25} />
            <p className="text-sm text-muted-foreground">{empty}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row, index) => (
              <div key={row.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 p-4">
                <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{row.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{row.sub}</div>
                </div>
                <div className="text-sm font-semibold">{row.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Quality({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${value > 0 ? "text-primary" : ""}`}>{value.toLocaleString()}</div>
    </div>
  );
}