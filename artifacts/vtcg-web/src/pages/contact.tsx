import { useState, useEffect } from "react";
import { MessageSquare, X } from "lucide-react";
import { apiFetch, UnauthorizedError } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { fmtDate, ErrorBanner } from "@/components/admin-ui";

interface ContactRow {
  id: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  submittedAt: string;
}

export default function ContactPage() {
  const { logout } = useAuth();
  const [messages, setMessages] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactRow | null>(null);

  useEffect(() => {
    apiFetch<{ submissions: ContactRow[] }>("/admin/contact")
      .then((data) => setMessages(data.submissions))
      .catch((err) => {
        if (err instanceof UnauthorizedError) logout();
        else setError("Failed to load contact messages.");
      })
      .finally(() => setLoading(false));
  }, [logout]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">
      <h1 className="font-display text-2xl font-bold mb-1">Contact Submissions</h1>
      <p className="text-sm text-muted-foreground mb-8">Messages from the public website contact form.</p>

      {error && <ErrorBanner message={error} />}

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div>
          <div className="grid grid-cols-[1.5fr_1fr_2fr_120px] gap-4 px-5 py-3 border-b border-border text-xs font-bold text-muted-foreground tracking-wider">
            <span>SENDER</span><span>CATEGORY</span><span>SUBJECT</span><span>DATE</span>
          </div>

          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1.5fr_1fr_2fr_120px] gap-4 px-5 py-4 border-b border-border animate-pulse">
                {Array.from({ length: 4 }).map((_, j) => <div key={j} className="h-3 bg-border rounded w-24" />)}
              </div>
            ))
          ) : messages.length === 0 ? (
            <div className="py-16 text-center">
              <MessageSquare size={32} className="text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            </div>
          ) : (
            messages.map((m) => (
              <button key={m.id} onClick={() => setSelected(m)} className="w-full grid grid-cols-[1.5fr_1fr_2fr_120px] gap-4 px-5 py-3.5 border-b border-border hover:bg-background transition-colors text-left items-center">
                <div className="min-w-0 pr-4">
                  <div className="text-sm font-semibold truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </div>
                <div className="text-sm text-muted-foreground capitalize truncate">
                  <span className="inline-flex bg-background border border-border px-2 py-0.5 rounded-md text-xs">{m.category.replace(/_/g, " ")}</span>
                </div>
                <div className="text-sm font-medium truncate pr-4">{m.subject}</div>
                <div className="text-sm text-muted-foreground tabular-nums">{fmtDate(m.submittedAt)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <MessageSquare size={30} className="mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          </div>
        ) : messages.map((message) => (
          <button key={message.id} onClick={() => setSelected(message)} className="w-full rounded-xl border border-border bg-card p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{message.subject}</div>
                <div className="truncate text-xs text-muted-foreground">{message.name} · {message.email}</div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">{fmtDate(message.submittedAt)}</div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <span className="inline-flex rounded-md border border-border bg-background px-2 py-0.5 text-xs capitalize text-muted-foreground">
                {message.category.replace(/_/g, " ")}
              </span>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{message.message}</p>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-2xl bg-background border border-border rounded-2xl shadow-2xl z-50 p-6 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-5 shrink-0">
              <span className="text-xs font-bold text-muted-foreground tracking-wider">MESSAGE DETAIL</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            
            <div className="space-y-4 overflow-y-auto shrink">
              <div className="flex flex-col sm:flex-row gap-4 bg-card border border-border rounded-xl p-4">
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1">From</div>
                  <div className="text-sm font-bold truncate">{selected.name}</div>
                  <a href={`mailto:${selected.email}`} className="text-sm text-primary hover:underline truncate inline-block">{selected.email}</a>
                </div>
                <div className="sm:w-[200px]">
                  <div className="text-xs text-muted-foreground mb-1">Date</div>
                  <div className="text-sm font-medium">{new Date(selected.submittedAt).toLocaleString()}</div>
                </div>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="inline-flex bg-background border border-border px-2 py-1 rounded-md text-xs font-semibold capitalize text-muted-foreground">
                    {selected.category.replace(/_/g, " ")}
                  </span>
                  <div className="text-sm font-bold">{selected.subject}</div>
                </div>
                <div className="w-full h-px bg-border" />
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {selected.message}
                </div>
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-border flex justify-end shrink-0">
              <a 
                href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject)}`}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors"
              >
                Reply via Email
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
