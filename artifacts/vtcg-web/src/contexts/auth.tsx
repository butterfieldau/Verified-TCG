import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLocation } from "wouter";
import { apiFetch, apiPost, type AuthState } from "@/lib/api";

interface AuthContextType {
  auth: AuthState | null;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function hasAdminSessionMarker(): boolean {
  return /(?:^|;\s*)vtcg_admin_csrf=/.test(document.cookie);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [location, setLocation] = useLocation();

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    if (!hasAdminSessionMarker()) {
      setAuth(null);
      setIsLoading(false);
      return;
    }
    try {
      setAuth(await apiFetch<AuthState>("/admin/auth/me"));
    } catch {
      setAuth(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuth(null);
      if (location !== "/login" && location !== "/activate") {
        setLocation("/login");
      }
    };
    window.addEventListener("admin:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("admin:unauthorized", handleUnauthorized);
  }, [location, setLocation]);

  async function logout() {
    try {
      await apiPost("/admin/auth/logout", {});
    } catch {
      // A failed/expired server session is still signed out locally.
    }
    setAuth(null);
    setLocation("/login");
  }

  return (
    <AuthContext.Provider value={{ auth, isLoading, refreshSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}