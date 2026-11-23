import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { getDb, ServiceError, subscribe, transact, type Actor } from "../domain/store";
import type { Db, Role, User } from "../domain/types";
import { setReportingCurrency } from "../lib/money";
import { cn } from "../lib/utils";

// ---------- Router (history API, no dependency) ----------

const NAV_EVENT = "gmca:navigate";

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

function readLocation() {
  return window.location.pathname + window.location.search;
}

export function useLocation() {
  const loc = useSyncExternalStore(
    (cb) => {
      window.addEventListener("popstate", cb);
      window.addEventListener(NAV_EVENT, cb);
      return () => {
        window.removeEventListener("popstate", cb);
        window.removeEventListener(NAV_EVENT, cb);
      };
    },
    readLocation
  );
  return useMemo(() => {
    const url = new URL(loc, window.location.origin);
    return { path: url.pathname.replace(/\/+$/, "") || "/", query: url.searchParams };
  }, [loc]);
}

/** "/returns/:id" against "/returns/iit-0001" → { id: "iit-0001" }. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const a = path.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(a[i]!);
    else if (seg !== a[i]) return null;
  }
  return params;
}

export function Link({ to, className, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        props.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

// ---------- Data ----------

export function useDb(): Db {
  const db = useSyncExternalStore(subscribe, getDb);
  setReportingCurrency(db.config.reportingCurrency);
  return db;
}

// ---------- Session (demo sign-in) ----------

const SESSION_KEY = "gmca-v2:session";

type SessionValue = { user: User | null; actor: Actor | null; signIn: (userId: string) => void; signOut: () => void };
const SessionContext = createContext<SessionValue | null>(null);

export const HOME: Record<Role, string> = { INDIVIDUAL: "/", EMPLOYER: "/company", ASSESSOR: "/gmca", ADMIN: "/admin" };

export function SessionProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [userId, setUserId] = useState<string | null>(() => {
    // Dev server only: ?demo-as=<userId> signs in for screenshots and automated checks.
    const devAs = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("demo-as") : null;
    if (devAs) return devAs;
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const user = db.users.find((u) => u.id === userId && u.status === "ACTIVE") ?? null;
  const signIn = useCallback((id: string) => {
    const u = getDb().users.find((x) => x.id === id);
    if (!u || u.status !== "ACTIVE") return;
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* session lasts until reload */
    }
    transact((d) => {
      const target = d.users.find((x) => x.id === id);
      if (target) target.lastSignInAt = new Date().toISOString();
    });
    setUserId(id);
    navigate(HOME[u.role]);
  }, []);
  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setUserId(null);
    navigate("/login");
  }, []);
  const actor = useMemo<Actor | null>(() => (user ? { id: user.id, name: user.name, role: user.role, taxpayerId: user.taxpayerId, companyId: user.companyId } : null), [user]);
  return <SessionContext.Provider value={{ user, actor, signIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}

/** For pages inside the signed-in shell. */
export function useActor(): Actor {
  const { actor } = useSession();
  if (!actor) throw new Error("Not signed in");
  return actor;
}

// ---------- Toasts and actions ----------

type Toast = { id: number; tone: "ok" | "error"; text: string };
const ToastContext = createContext<(tone: Toast["tone"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] grid justify-items-end gap-2 sm:inset-x-auto sm:right-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("rise pointer-events-auto flex max-w-md items-start gap-3 border px-4 py-3 text-sm shadow-pop", t.tone === "ok" ? "border-ok-line bg-ok-bg text-ok-fg" : "border-rej-line bg-rej-bg text-rej-fg")}>
            {t.tone === "ok" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1 text-fg">{t.text}</span>
            <button type="button" aria-label="Dismiss" className="text-muted hover:text-fg" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/**
 * Run a service op as the signed-in actor. Service errors become a toast and return undefined,
 * so the stored state is never half-written.
 */
export function useRun() {
  const { actor } = useSession();
  const toast = useToast();
  return useCallback(
    <T,>(op: (d: Db, actor: Actor) => T, success?: string): T | undefined => {
      if (!actor) return undefined;
      try {
        const result = transact((d) => op(d, actor));
        if (success) toast("ok", success);
        return result;
      } catch (e) {
        if (e instanceof ServiceError) toast("error", e.message);
        else {
          console.error(e);
          toast("error", "Something went wrong. Your last change was not saved.");
        }
        return undefined;
      }
    },
    [actor, toast]
  );
}

/** Same as useRun without a signed-in actor (registration). */
export function useRunPublic() {
  const toast = useToast();
  return useCallback(
    <T,>(op: (d: Db) => T): T | undefined => {
      try {
        return transact(op);
      } catch (e) {
        toast("error", e instanceof ServiceError ? e.message : "Something went wrong. Please try again.");
        return undefined;
      }
    },
    [toast]
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · GMCA Income Tax (v2 demo)`;
  }, [title]);
}
