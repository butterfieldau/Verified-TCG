import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  KeyRound,
  Mail,
  Send,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { apiFetch, apiPatch, apiPost, type Admin } from "@/lib/api";
import { ErrorBanner, fmtDate } from "@/components/admin-ui";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";

// Mirror of the backend permission baselines in
// artifacts/api-server/src/lib/adminPermissions.ts (permissionsByRole).
// The backend clamps any submitted permission set to a role's baseline, so
// these lists must stay aligned to avoid silently dropped selections.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    "dashboard:read",
    "users:read",
    "users:manage",
    "users:delete",
    "analytics:read",
    "reports:read",
    "reports:moderate",
    "contact:read",
    "notifications:read",
    "notifications:manage",
    "support:read",
    "support:manage",
    "privacy:read",
    "privacy:manage",
    "privacy:approve",
    "privacy:export",
    "privacy:delete",
    "retention:read",
    "retention:manage",
    "notes:read",
    "notes:manage",
    "announcements:read",
    "announcements:manage",
    "audit:read",
  ],
  support: [
    "dashboard:read",
    "users:read",
    "contact:read",
    "support:read",
    "support:manage",
    "privacy:read",
    "privacy:manage",
    "notes:read",
    "announcements:read",
  ],
  moderator: [
    "dashboard:read",
    "users:read",
    "reports:read",
    "reports:moderate",
    "notes:read",
    "announcements:read",
  ],
  analyst: [
    "dashboard:read",
    "users:read",
    "analytics:read",
    "reports:read",
    "notifications:read",
    "audit:read",
    "announcements:read",
  ],
};

interface TeamResponse {
  administrators: Admin[];
  invitationDelivery: { configured: boolean; message: string };
}

export default function TeamPage() {
  const { auth } = useAuth();
  const { toast } = useToast();
  const [team, setTeam] = useState<Admin[]>([]);
  const [delivery, setDelivery] = useState<TeamResponse["invitationDelivery"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("support");
  const [inviting, setInviting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<Record<string, string>>({});
  const [draftPermissions, setDraftPermissions] = useState<Record<string, string[]>>({});

  function loadTeam() {
    setLoading(true);
    setError(null);
    apiFetch<TeamResponse>("/admin/team")
      .then((data) => {
        setTeam(data.administrators);
        setDelivery(data.invitationDelivery);
        setDraftRole(Object.fromEntries(data.administrators.map((admin) => [admin.id, admin.role])));
        setDraftPermissions(Object.fromEntries(data.administrators.map((admin) => [admin.id, admin.permissions])));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load team."))
      .finally(() => setLoading(false));
  }

  useEffect(loadTeam, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    try {
      const response = await apiPost<{ message: string; delivery: string }>("/admin/team/invitations", {
        email: inviteEmail.trim(),
        displayName: inviteName.trim(),
        role: inviteRole,
        permissions: ROLE_PERMISSIONS[inviteRole],
      });
      toast({
        title: response.delivery === "sent" ? "Invitation sent" : "Administrator added",
        description: response.message,
      });
      setInviteName("");
      setInviteEmail("");
      loadTeam();
    } catch (inviteError) {
      toast({ title: "Invitation not created", description: inviteError instanceof Error ? inviteError.message : "Request failed.", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  async function saveAccess(admin: Admin) {
    try {
      const response = await apiPatch<{ message: string }>(`/admin/team/${admin.id}`, {
        role: draftRole[admin.id],
        permissions: draftPermissions[admin.id],
      });
      toast({ title: "Access updated", description: response.message });
      loadTeam();
    } catch (saveError) {
      toast({ title: "Access not updated", description: saveError instanceof Error ? saveError.message : "Request failed.", variant: "destructive" });
    }
  }

  async function setStatus(admin: Admin) {
    const status = admin.status === "active" ? "inactive" : "active";
    try {
      const response = await apiPatch<{ message: string }>(`/admin/team/${admin.id}`, { status });
      toast({ title: status === "active" ? "Account activated" : "Account deactivated", description: response.message });
      loadTeam();
    } catch (statusError) {
      toast({ title: "Status not updated", description: statusError instanceof Error ? statusError.message : "Request failed.", variant: "destructive" });
    }
  }

  async function resetAccess(admin: Admin) {
    if (!window.confirm(`Reset access for ${admin.displayName}? All sessions will be revoked.`)) return;
    try {
      const response = await apiPost<{ message: string }>(`/admin/team/${admin.id}/reset-access`, {});
      toast({ title: "Security access reset", description: response.message });
      loadTeam();
    } catch (resetError) {
      toast({ title: "Access not reset", description: resetError instanceof Error ? resetError.message : "Request failed.", variant: "destructive" });
    }
  }

  function changeRole(adminId: string, role: string) {
    setDraftRole((current) => ({ ...current, [adminId]: role }));
    setDraftPermissions((current) => ({ ...current, [adminId]: ROLE_PERMISSIONS[role] ?? [] }));
  }

  function togglePermission(adminId: string, permission: string) {
    setDraftPermissions((current) => {
      const selected = current[adminId] ?? [];
      return {
        ...current,
        [adminId]: selected.includes(permission)
          ? selected.filter((item) => item !== permission)
          : [...selected, permission],
      };
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <h1 className="font-display text-2xl font-bold">Admin team</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Manage staff identities, least-privilege access, invitations, and activation.</p>
      {error && <ErrorBanner message={error} />}
      {delivery && !delivery.configured && (
        <div className="mb-5 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 shrink-0" size={16} />
          <div><strong>Invitation delivery unavailable.</strong> {delivery.message}</div>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)
          ) : team.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
              <UsersRound className="mx-auto mb-3 opacity-50" />
              No administrators found.
            </div>
          ) : team.map((admin) => {
            const editable = admin.role !== "owner" && admin.id !== auth?.admin.id;
            const role = draftRole[admin.id] ?? admin.role;
            const availablePermissions = ROLE_PERMISSIONS[role] ?? admin.permissions;
            return (
              <article key={admin.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-start gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-sm font-bold">
                    {admin.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-bold">{admin.displayName}</h2>
                      {admin.id === auth?.admin.id && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">You</span>}
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{admin.role}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{admin.email}</div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className={admin.status === "active" ? "text-positive" : ""}>{admin.status}</span>
                      <span>Last login: {admin.lastLoginAt ? fmtDate(admin.lastLoginAt) : "Never"}</span>
                      {admin.status === "invited" && <span>Delivery: {admin.invitationDeliveryStatus}</span>}
                    </div>
                  </div>
                  {editable && (
                    <button type="button" onClick={() => setExpanded(expanded === admin.id ? null : admin.id)} className="rounded-lg border border-border p-2 text-muted-foreground" aria-label={`Manage ${admin.displayName}`}>
                      <ChevronDown size={16} className={expanded === admin.id ? "rotate-180" : ""} />
                    </button>
                  )}
                </div>

                {editable && expanded === admin.id && (
                  <div className="border-t border-border bg-background/40 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-bold text-muted-foreground">
                        ROLE
                        <select value={role} onChange={(event) => changeRole(admin.id, event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
                          <option value="admin">Admin</option>
                          <option value="support">Support</option>
                          <option value="moderator">Moderator</option>
                          <option value="analyst">Analyst</option>
                        </select>
                      </label>
                      <div>
                        <div className="text-xs font-bold text-muted-foreground">ACCOUNT</div>
                        <div className="mt-1.5 flex gap-2">
                          <button type="button" onClick={() => void setStatus(admin)} className="rounded-lg border border-border px-3 py-2 text-xs font-bold">
                            {admin.status === "active" ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" onClick={() => void resetAccess(admin)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold">
                            <KeyRound size={13} /> Reset access
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="text-xs font-bold text-muted-foreground">PERMISSION SET</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {availablePermissions.map((permission) => (
                          <label key={permission} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                            <input type="checkbox" checked={(draftPermissions[admin.id] ?? []).includes(permission)} onChange={() => togglePermission(admin.id, permission)} />
                            <span className="font-mono">{permission}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => void saveAccess(admin)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white">
                      <ShieldCheck size={15} /> Save access
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="overflow-hidden rounded-xl border border-border bg-card lg:sticky lg:top-6">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-bold">
            <Send size={16} className="text-primary" /> Invite team member
          </div>
          <form onSubmit={invite} className="space-y-4 p-5">
            <label className="block text-xs font-bold text-muted-foreground">
              NAME
              <input value={inviteName} onChange={(event) => setInviteName(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder="Staff member name" />
            </label>
            <label className="block text-xs font-bold text-muted-foreground">
              EMAIL
              <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder="staff@verifiedtcg.com" />
            </label>
            <label className="block text-xs font-bold text-muted-foreground">
              ROLE
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="moderator">Moderator</option>
                <option value="analyst">Analyst</option>
              </select>
            </label>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Role permissions</div>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_PERMISSIONS[inviteRole].map((permission) => <span key={permission} className="rounded bg-card px-1.5 py-1 font-mono text-[10px] text-muted-foreground">{permission}</span>)}
              </div>
            </div>
            <button disabled={inviting || !inviteName.trim() || !inviteEmail.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-50">
              <Mail size={15} /> {inviting ? "Creating…" : delivery?.configured ? "Send invitation" : "Add pending invitation"}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}