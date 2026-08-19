import { FormEvent, useEffect, useState } from "react";
import { Database, FileJson, Search, ShieldCheck } from "lucide-react";
import { apiFetch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { ErrorBanner } from "@/components/admin-ui";

interface CatalogueStatus {
  source: string;
  authority: string;
  configured: boolean;
  status: string;
  writable: boolean;
  message: string;
}

interface CatalogueCard {
  id?: string;
  name?: string;
  game?: string;
  set?: string;
  set_name?: string;
  number?: string;
  rarity?: string;
  image_url?: string;
}

interface ImportPreview {
  dryRun: boolean;
  received: number;
  valid: number;
  duplicateRows: number;
  errors: { row: number; message: string }[];
  changes: unknown[];
  canApply: boolean;
  message: string;
}

export default function CataloguePage() {
  const { logout } = useAuth();
  const [status, setStatus] = useState<CatalogueStatus | null>(null);
  const [query, setQuery] = useState("");
  const [game, setGame] = useState("");
  const [cards, setCards] = useState<CatalogueCard[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState('[\n  {"name":"","set":"","number":""}\n]');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CatalogueStatus>("/admin/catalogue/status")
      .then(setStatus)
      .catch((err) => {
        if (err instanceof UnauthorizedError) void logout();
        else setError("Could not load catalogue connection status.");
      });
  }, [logout]);

  async function searchCards(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (game.trim()) params.set("game", game.trim());
      const response = await apiFetch<{ data?: CatalogueCard[] }>(
        `/admin/catalogue/cards?${params.toString()}`,
      );
      setCards(response.data ?? []);
      setSearched(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) void logout();
      else setError(err instanceof Error ? err.message : "Catalogue search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function dryRunImport() {
    setImportError(null);
    setImportPreview(null);
    try {
      const records = JSON.parse(importText) as unknown;
      const preview = await apiPost<ImportPreview>(
        "/admin/catalogue/imports/dry-run",
        { records },
      );
      setImportPreview(preview);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import validation failed.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-display text-2xl font-bold">Cards & catalogue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the connected authoritative source without creating a second card catalogue.
          </p>
        </div>
        {status && (
          <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${
            status.configured
              ? "border-positive/30 bg-positive/10 text-positive"
              : "border-negative/30 bg-negative/10 text-negative"
          }`}>
            {status.source} · {status.status}
          </span>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {status && (
        <div className="mb-6 flex gap-3 rounded-xl border border-border bg-card p-4">
          <ShieldCheck className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
          <div>
            <div className="text-sm font-bold">External, read-only authority</div>
            <p className="mt-1 text-sm text-muted-foreground">{status.message}</p>
          </div>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-bold tracking-wider text-muted-foreground">
          LIVE CARD SEARCH
        </h2>
        <form
          onSubmit={searchCards}
          className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_220px_auto]"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Card name or number"
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            value={game}
            onChange={(event) => setGame(event.target.value)}
            placeholder="Game (optional)"
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <button
            disabled={loading || !status?.configured || (!query.trim() && !game.trim())}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            <Search size={15} />
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading live catalogue…</div>
          ) : cards.length === 0 ? (
            <div className="p-10 text-center">
              <Database className="mx-auto mb-3 text-muted-foreground opacity-50" size={28} />
              <p className="text-sm text-muted-foreground">
                {searched ? "No cards matched this search." : "Search to load real catalogue records."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {cards.map((card, index) => (
                <div
                  key={card.id ?? `${card.name}-${index}`}
                  className="grid gap-3 p-4 sm:grid-cols-[48px_1fr_180px_100px] sm:items-center"
                >
                  <div className="h-14 w-10 overflow-hidden rounded border border-border bg-background">
                    {card.image_url ? (
                      <img src={card.image_url} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{card.name ?? "Unnamed card"}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {card.id ?? "No provider ID"}
                    </div>
                  </div>
                  <div className="text-sm">
                    <div>{card.set_name ?? card.set ?? "Set unavailable"}</div>
                    <div className="text-xs text-muted-foreground">{card.game ?? "Game unavailable"}</div>
                  </div>
                  <div className="text-sm text-muted-foreground sm:text-right">
                    {card.number ?? "No number"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold tracking-wider text-muted-foreground">
          STAGED IMPORT VALIDATION
        </h2>
        <div className="grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-bold">
              <FileJson size={16} /> JSON records
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={10}
              className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:border-primary"
            />
            <button
              onClick={() => void dryRunImport()}
              className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-background"
            >
              Validate dry run
            </button>
            {importError && <p className="mt-2 text-sm text-negative">{importError}</p>}
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            {!importPreview ? (
              <p className="text-sm text-muted-foreground">
                Validation checks required fields, length limits, and duplicate rows. No records
                are written.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Received" value={importPreview.received} />
                  <Metric label="Valid" value={importPreview.valid} />
                  <Metric label="Duplicates" value={importPreview.duplicateRows} />
                </div>
                <p className="text-sm text-muted-foreground">{importPreview.message}</p>
                {importPreview.errors.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-negative">
                    {importPreview.errors.map((issue, index) => (
                      <div key={`${issue.row}-${index}`}>Row {issue.row}: {issue.message}</div>
                    ))}
                  </div>
                )}
                <button disabled className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white opacity-40">
                  Apply import unavailable
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}