import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Eye, EyeOff, CheckCircle } from "lucide-react";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

export default function ActivatePage() {
  const [location, setLocation] = useLocation();
  const { auth, refreshSession } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = searchParams.get("token") || "";

  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (auth) {
      setLocation("/overview");
    }
  }, [auth, setLocation]);

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || !password.trim() || !displayName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost("/admin/auth/activate", { 
        token: token.trim(),
        password,
        displayName: displayName.trim()
      }, false);
      setSuccess(true);
      setTimeout(() => {
        void refreshSession();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate account.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-30">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px]" />
        </div>
        <div className="w-full max-w-sm relative z-10 text-center animate-in zoom-in-95">
          <div className="h-16 w-16 bg-positive/20 rounded-full flex items-center justify-center mx-auto mb-6 text-positive">
            <CheckCircle size={32} />
          </div>
          <h1 className="font-display text-2xl font-bold mb-2">Account Activated</h1>
          <p className="text-muted-foreground text-sm">Redirecting you to the dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="flex flex-col items-center mb-10 text-center">
          <img
            src={`${import.meta.env.BASE_URL}verified-tcg-logo-white.png`}
            alt="Verified TCG"
            className="mb-4 h-auto w-48"
          />
          <div className="text-xs text-muted-foreground mt-1.5 tracking-widest font-mono">STAFF INVITATION</div>
        </div>

        <form onSubmit={handleActivate} className="space-y-4 bg-card border border-border p-6 rounded-2xl shadow-xl shadow-black/50">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
              INVITATION TOKEN
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your token here…"
              autoFocus={!tokenFromUrl}
              required
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors font-mono placeholder:text-muted-foreground/40"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
              DISPLAY NAME
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex"
              autoFocus={!!tokenFromUrl}
              required
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
              NEW PASSWORD
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                required
                minLength={12}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm pr-10 focus:outline-none focus:border-primary transition-colors font-mono placeholder:text-muted-foreground/40"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password.length > 0 && password.length < 12 && (
              <p className="text-[10px] text-amber-500 mt-1.5 px-1">Password must be at least 12 characters</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-negative/10 border border-negative/30 text-negative rounded-xl px-4 py-3 text-sm animate-in fade-in slide-in-from-top-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="leading-tight">{error}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim() || password.length < 12 || !displayName.trim()}
            className="w-full py-3 mt-2 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(255,30,45,0.2)] active:scale-[0.98]"
          >
            {loading ? "Activating…" : "Activate Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
