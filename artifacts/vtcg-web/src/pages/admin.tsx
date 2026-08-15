/**
 * Admin Panel — internal operator tool.
 *
 * Lets operators look up users by email and update their subscription tier
 * or founding member status.  The ADMIN_SECRET entered here is sent as the
 * `x-admin-secret` header on every API request and is never stored anywhere
 * beyond the current browser session.
 */

import { useState } from "react";
import {
  Search, Shield, CheckCircle, User, ChevronRight, AlertTriangle,
  Crown, Star, RotateCcw,
} from "lucide-react";

// The API server is a separate artifact mounted at /api — never prefix with BASE_URL.
const API_BASE = "/api";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  username: string;
  subscriptionTier: string;
  isFoundingMember: boolean;
  createdAt: string;
}

interface ActionState {
  userId: string;
  tier?: string;
  foundingMember?: boolean;
}

function tierBadge(tier: string, isFoundingMember: boolean) {
  if (tier === "pro" && isFoundingMember) {
    return (
      <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold px-2.5 py-1 rounded-full">
        <Star size={11} /> FOUNDING PRO
      </span>
    );
  }
  if (tier === "pro") {
    return (
      <span className="inline-flex items-center gap-1 bg-primary/20 text-primary border border-primary/40 text-xs font-bold px-2.5 py-1 rounded-full">
        <Crown size={11} /> PRO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-400 border border-zinc-700 text-xs font-bold px-2.5 py-1 rounded-full">
      <User size={11} /> FREE
    </span>
  );
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [action, setAction] = useState<ActionState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Search ────────────────────────────────────────────────────────────────

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSearching(true);
    setSearchError(null);
    setUsers([]);
    setSelected(null);
    setSaveResult(null);

    try {
      const resp = await fetch(
        `${API_BASE}/admin/users?email=${encodeURIComponent(email.trim())}`,
        { headers: { "x-admin-secret": secret } },
      );
      const data = await resp.json();

      if (!resp.ok) {
        setSearchError(data.message ?? "Search failed.");
        return;
      }

      setUsers(data.users ?? []);
      if ((data.users ?? []).length === 0) {
        setSearchError("No users found matching that email.");
      }
    } catch {
      setSearchError("Network error — check that the API server is running.");
    } finally {
      setSearching(false);
    }
  }

  function selectUser(user: AdminUser) {
    setSelected(user);
    setAction({ userId: user.id, tier: user.subscriptionTier, foundingMember: user.isFoundingMember });
    setSaveResult(null);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !selected) return;

    setSaving(true);
    setSaveResult(null);

    const body: Record<string, unknown> = {};
    if (action.tier !== undefined) body.subscription_tier = action.tier;
    if (action.foundingMember !== undefined) body.is_founding_member = action.foundingMember;

    try {
      const resp = await fetch(`${API_BASE}/admin/users/${selected.id}/subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (!resp.ok) {
        setSaveResult({ ok: false, message: data.message ?? "Update failed." });
        return;
      }

      // Reflect the change in the user list and selected state
      const updated: AdminUser = data.user;
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      setSelected({ ...selected, ...updated });
      setAction({ userId: updated.id, tier: updated.subscriptionTier, foundingMember: updated.isFoundingMember });
      setSaveResult({ ok: true, message: data.message ?? "Updated successfully." });
    } catch {
      setSaveResult({ ok: false, message: "Network error — could not reach the API." });
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background px-8 py-5 flex items-center gap-4">
        <div className="h-9 w-9 bg-primary rounded flex items-center justify-center shadow-[0_0_15px_rgba(255,30,45,0.4)]">
          <Shield size={18} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-wide leading-none">ADMIN PANEL</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Verified TCG — Internal operator tool</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left pane — search + results */}
        <div className="w-[380px] border-r border-border flex flex-col shrink-0">
          {/* Secret + Search form */}
          <form onSubmit={handleSearch} className="p-6 space-y-4 border-b border-border">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-2 tracking-wider">
                ADMIN SECRET
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter ADMIN_SECRET…"
                required
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-2 tracking-wider">
                FIND USER BY EMAIL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !secret || !email.trim()}
                  className="px-4 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-[0_0_10px_rgba(255,30,45,0.2)]"
                >
                  {searching ? "…" : "Search"}
                </button>
              </div>
            </div>
          </form>

          {/* Results */}
          <div className="flex-1 overflow-y-auto">
            {searchError && (
              <div className="m-4 flex items-start gap-3 bg-negative/10 border border-negative/30 text-negative rounded-lg px-4 py-3 text-sm">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {searchError}
              </div>
            )}
            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => selectUser(user)}
                className={`w-full text-left px-5 py-4 border-b border-border hover:bg-card transition-colors flex items-center justify-between group ${
                  selected?.id === user.id ? "bg-card border-l-2 border-l-primary pl-[18px]" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{user.displayName}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    @{user.username} · {user.email}
                  </div>
                  <div className="mt-2">{tierBadge(user.subscriptionTier, user.isFoundingMember)}</div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground shrink-0 ml-3 group-hover:text-foreground transition-colors" />
              </button>
            ))}
          </div>
        </div>

        {/* Right pane — edit panel */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-center p-12">
              <div>
                <div className="h-16 w-16 rounded-full bg-card border border-border flex items-center justify-center mx-auto mb-4">
                  <User size={28} className="text-muted-foreground" />
                </div>
                <p className="text-muted-foreground text-sm">Search for a user on the left, then select them to manage their subscription.</p>
              </div>
            </div>
          ) : (
            <div className="p-8 max-w-2xl">
              {/* User header */}
              <div className="flex items-center gap-5 mb-8">
                <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-2xl font-display font-bold text-primary">
                  {selected.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{selected.displayName}</h2>
                  <p className="text-muted-foreground text-sm mt-0.5">{selected.email}</p>
                  <p className="text-muted-foreground text-xs mt-0.5 font-mono opacity-60">{selected.id}</p>
                </div>
              </div>

              {/* Current status */}
              <div className="bg-card border border-border rounded-xl p-5 mb-6">
                <h3 className="text-xs font-bold text-muted-foreground tracking-wider mb-3">CURRENT STATUS</h3>
                <div className="flex items-center gap-4">
                  {tierBadge(selected.subscriptionTier, selected.isFoundingMember)}
                  <span className="text-xs text-muted-foreground">
                    Member since {new Date(selected.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Edit form */}
              <form onSubmit={handleSave} className="bg-card border border-border rounded-xl p-6 space-y-6">
                <h3 className="text-xs font-bold text-muted-foreground tracking-wider">UPDATE SUBSCRIPTION</h3>

                {/* Tier selector */}
                <div>
                  <label className="block text-sm font-bold mb-3">Subscription Tier</label>
                  <div className="flex gap-3">
                    {["free", "pro"].map((tier) => (
                      <label
                        key={tier}
                        className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                          action?.tier === tier
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-muted-foreground bg-background"
                        }`}
                      >
                        <input
                          type="radio"
                          name="tier"
                          value={tier}
                          checked={action?.tier === tier}
                          onChange={() => setAction((a) => a ? { ...a, tier } : { userId: selected.id, tier })}
                          className="sr-only"
                        />
                        {tier === "pro" ? (
                          <Crown size={18} className={action?.tier === "pro" ? "text-primary" : "text-muted-foreground"} />
                        ) : (
                          <User size={18} className={action?.tier === "free" ? "text-primary" : "text-muted-foreground"} />
                        )}
                        <div>
                          <div className="font-bold text-sm uppercase">{tier}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {tier === "pro" ? "Full feature access" : "Limited access"}
                          </div>
                        </div>
                        {action?.tier === tier && (
                          <CheckCircle size={16} className="ml-auto text-primary" />
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Founding member toggle */}
                <div className="flex items-center justify-between p-4 bg-background border border-border rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 rounded-lg">
                      <Star size={16} className="text-amber-400" />
                    </div>
                    <div>
                      <div className="font-bold text-sm">Founding Member</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Grants the Founding Member badge — awarded to early supporters
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-4">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={action?.foundingMember ?? false}
                      onChange={(e) =>
                        setAction((a) =>
                          a ? { ...a, foundingMember: e.target.checked } : { userId: selected.id, foundingMember: e.target.checked }
                        )
                      }
                    />
                    <div className="w-11 h-6 bg-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500 shadow-inner" />
                  </label>
                </div>

                {/* Save result */}
                {saveResult && (
                  <div
                    className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
                      saveResult.ok
                        ? "bg-positive/10 border border-positive/30 text-positive"
                        : "bg-negative/10 border border-negative/30 text-negative"
                    }`}
                  >
                    {saveResult.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
                    {saveResult.message}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAction({ userId: selected.id, tier: selected.subscriptionTier, foundingMember: selected.isFoundingMember });
                      setSaveResult(null);
                    }}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw size={14} /> Reset
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_10px_rgba(255,30,45,0.2)]"
                  >
                    {saving ? (
                      <>Saving…</>
                    ) : (
                      <><CheckCircle size={15} /> Save Changes</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
