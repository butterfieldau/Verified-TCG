import { useState, useEffect } from "react";
import { Shield, AlertTriangle, Eye, EyeOff, KeyRound } from "lucide-react";
import { apiFetch, apiPost, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useLocation } from "wouter";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [checkingBootstrap, setCheckingBootstrap] = useState(true);
  
  const { refreshSession, auth } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (auth) {
      setLocation("/overview");
      return;
    }
    
    apiFetch<{ bootstrapRequired: boolean }>("/admin/auth/bootstrap-status")
      .then(res => setBootstrapRequired(res.bootstrapRequired))
      .catch(() => setBootstrapRequired(false))
      .finally(() => setCheckingBootstrap(false));
  }, [auth, setLocation]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost("/admin/auth/login", { email: email.trim(), password }, false);
      await refreshSession();
      setLocation("/overview");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError("Invalid credentials. Access denied.");
      } else {
        setError("Could not connect to the API. Check that the server is running.");
      }
    } finally {
      setSecret("");
      setLoading(false);
    }
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !secret.trim() || !displayName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost("/admin/auth/bootstrap", { 
        secret: secret.trim(), 
        email: email.trim(), 
        password, 
        displayName: displayName.trim(),
      }, false);
      setSecret("");
      await refreshSession();
      setLocation("/overview");
    } catch (err) {
      if (err instanceof UnauthorizedError || (err instanceof Error && err.message.includes("secret"))) {
        setError("Invalid bootstrap secret.");
      } else {
        setError(err instanceof Error ? err.message : "Bootstrap failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (checkingBootstrap) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(255,30,45,0.4)] animate-pulse">
          <Shield size={20} className="text-white" strokeWidth={2.5} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative noise/gradient */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="h-12 w-12 bg-primary rounded-xl flex items-center justify-center shadow-[0_0_30px_rgba(255,30,45,0.5)] mb-4">
            <Shield size={24} className="text-white" strokeWidth={2.5} />
          </div>
          <div className="font-display text-2xl font-bold tracking-wide leading-none text-foreground">VERIFIED TCG</div>
          <div className="text-xs text-muted-foreground mt-1.5 tracking-widest font-mono">COMMAND CENTRE</div>
        </div>

        <form onSubmit={bootstrapRequired ? handleBootstrap : handleLogin} className="space-y-4 bg-card border border-border p-6 rounded-2xl shadow-xl shadow-black/50">
          
          {bootstrapRequired && (
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
                YOUR NAME
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Owner name"
                required
                autoComplete="name"
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40"
              />
            </div>
          )}

          {bootstrapRequired && (
            <div className="bg-primary/10 border border-primary/30 p-4 rounded-xl mb-4 text-sm text-primary">
              <div className="font-bold flex items-center gap-2 mb-1">
                <KeyRound size={16} /> Initial Setup Required
              </div>
              <div>Provide the master admin secret to initialize the owner account.</div>
            </div>
          )}

          {bootstrapRequired && (
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
                ADMIN SECRET
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Master secret"
                required
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors font-mono placeholder:text-muted-foreground/40"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@verifiedtcg.com"
              autoFocus
              required
              autoComplete="username"
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors font-mono placeholder:text-muted-foreground/40"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5 tracking-wider font-mono">
              PASSWORD
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={12}
                autoComplete="current-password"
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
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-negative/10 border border-negative/30 text-negative rounded-xl px-4 py-3 text-sm animate-in fade-in slide-in-from-top-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="leading-tight">{error}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || password.length < 12 || (bootstrapRequired && (!secret.trim() || !displayName.trim()))}
            className="w-full py-3 mt-2 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(255,30,45,0.2)] active:scale-[0.98]"
          >
            {loading ? "Authenticating…" : bootstrapRequired ? "Initialize Owner" : "Authorize Access"}
          </button>
        </form>
      </div>
    </div>
  );
}
