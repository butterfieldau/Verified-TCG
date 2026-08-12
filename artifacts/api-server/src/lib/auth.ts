import type { NextFunction, Request, Response } from "express";

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

async function verifySupabaseToken(token: string): Promise<AuthenticatedUser | null> {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const user = await response.json() as {
      id?: unknown;
      email?: unknown;
      user_metadata?: unknown;
    };
    if (typeof user.id !== "string") return null;
    return {
      id: user.id,
      email: typeof user.email === "string" ? user.email : undefined,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!(process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL) ||
      !(process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY)) {
    res.status(503).json({ error: "Authentication is not configured" });
    return;
  }

  const user = token ? await verifySupabaseToken(token) : null;
  if (!user) {
    res.status(401).json({ error: "Valid bearer authentication is required" });
    return;
  }

  req.user = user;
  next();
}
