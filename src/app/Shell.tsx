import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookUser,
  Building2,
  ClipboardList,
  Coins,
  FileStack,
  FileText,
  FlaskConical,
  Gauge,
  History,
  Home,
  Inbox,
  LogOut,
  Menu,
  MessageSquareWarning,
  Moon,
  PlugZap,
  Receipt,
  RotateCcw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  Users,
  Wallet,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ROLE_LABEL } from "../domain/permissions";
import { getPersistError, resetDemoData } from "../domain/store";
import type { Role } from "../domain/types";
import { formatDateTime } from "../lib/format";
import { cn } from "../lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../shared/ui/dropdown-menu";
import { isRead, notificationsFor } from "../features/shared/queries";
import { DEMO_ACCOUNTS } from "../features/auth/demoAccounts";
import { HOME, Link, navigate, useDb, useLocation, useSession } from "./core";

type NavItem = { to: string; label: string; icon: typeof Home; exact?: boolean; also?: string[] };
type NavGroup = { label?: string; items: NavItem[] };

const NAV: Record<Role, NavGroup[]> = {
  INDIVIDUAL: [
    {
      items: [
        { to: "/", label: "Overview", icon: Home, exact: true },
        { to: "/profile", label: "My profile", icon: UserRound },
        { to: "/income", label: "My income", icon: Wallet },
        { to: "/returns", label: "Tax returns", icon: FileText, also: ["/requests"] },
        { to: "/payments", label: "Tax payments", icon: Receipt, also: ["/bank"] },
        { to: "/documents", label: "Documents", icon: FileStack },
        { to: "/history", label: "Tax history", icon: History },
        { to: "/messages", label: "Messages", icon: Inbox }
      ]
    }
  ],
  EMPLOYER: [
    {
      items: [
        { to: "/company", label: "Overview", icon: Home, exact: true },
        { to: "/company/profile", label: "Company profile", icon: Building2 },
        { to: "/company/employees", label: "Employee directory", icon: Users },
        { to: "/company/payroll", label: "Monthly TDS & Health", icon: ClipboardList },
        { to: "/company/corporate", label: "Corporate income tax", icon: FileText, also: ["/requests"] },
        { to: "/payments", label: "Payments", icon: Receipt, also: ["/bank"] },
        { to: "/documents", label: "Documents", icon: FileStack },
        { to: "/history", label: "Filing history", icon: History },
        { to: "/messages", label: "Notifications", icon: Inbox }
      ]
    }
  ],
  ASSESSOR: [
    {
      items: [
        { to: "/gmca", label: "Overview", icon: Home, exact: true },
        { to: "/gmca/queue", label: "Assessment work queue", icon: ClipboardList, also: ["/gmca/cases"] },
        { to: "/gmca/returns/individual", label: "Individual returns", icon: UserRound },
        { to: "/gmca/returns/corporate", label: "Corporate returns", icon: Building2 },
        { to: "/gmca/requests", label: "Information requests", icon: MessageSquareWarning },
        { to: "/gmca/taxpayers", label: "Taxpayers", icon: BookUser },
        { to: "/gmca/payments", label: "Payments & liabilities", icon: Coins },
        { to: "/gmca/documents", label: "Documents & correspondence", icon: FileStack },
        { to: "/gmca/reports", label: "Reports", icon: BarChart3 }
      ]
    }
  ],
  ADMIN: [
    {
      items: [
        { to: "/admin", label: "Overview", icon: Home, exact: true },
        { to: "/admin/users", label: "Users & roles", icon: ShieldCheck },
        { to: "/admin/taxpayers", label: "Taxpayers & companies", icon: BookUser }
      ]
    },
    {
      label: "Configuration",
      items: [
        { to: "/admin/tax", label: "Tax configuration", icon: Settings2 },
        { to: "/admin/reliefs", label: "Relief configuration", icon: Sparkles },
        { to: "/admin/incentives", label: "Company incentives", icon: Building2 },
        { to: "/admin/currency", label: "Currency & rates", icon: Coins },
        { to: "/admin/integrations", label: "Integration demo settings", icon: PlugZap }
      ]
    },
    {
      label: "Oversight",
      items: [
        { to: "/admin/audit", label: "Audit log", icon: ScrollText },
        { to: "/admin/monitoring", label: "System monitoring", icon: Gauge },
        { to: "/gmca/reports", label: "Reports", icon: BarChart3 }
      ]
    }
  ]
};

function isActive(item: NavItem, path: string) {
  if (item.exact) return path === item.to;
  return [item.to, ...(item.also ?? [])].some((p) => path === p || path.startsWith(`${p}/`));
}

const THEME_KEY = "gmc-tax:theme";
function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);
  return [dark, () => setDark((v) => !v)] as const;
}

export function Logo({ dark }: { dark: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <img src={dark ? "/logo1.svg" : "/gmc-logo-black.svg"} alt="" className="h-12 w-auto sm:h-14" />
      <span className="border-l border-line pl-3 text-[12px] font-medium uppercase leading-tight tracking-[0.12em] text-muted">
        Income
        <br />
        Tax
      </span>
    </span>
  );
}

function SideNav({ role, path }: { role: Role; path: string }) {
  return (
    <nav aria-label="Main" className="grid gap-6">
      {NAV[role].map((g, gi) => (
        <div key={gi} className="grid gap-1">
          {g.label ? <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{g.label}</p> : null}
          <ul className="grid gap-0.5">
            {g.items.map((item) => {
              const active = isActive(item, path);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-3 border px-3 py-2 text-[14.5px] transition-colors", active ? "border-brand-200 bg-brand-50 font-medium text-brand-ink" : "border-transparent text-fg-2 hover:bg-sunk hover:text-fg")}
                  >
                    <item.icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, signIn, signOut } = useSession();
  const db = useDb();
  const { path } = useLocation();
  const [dark, toggleTheme] = useTheme();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [path]);
  if (!user) return null;

  const notes = notificationsFor(db, user);
  const unread = notes.filter((n) => !isRead(n, user.id));
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const context =
    user.role === "INDIVIDUAL"
      ? db.taxpayers.find((t) => t.id === user.taxpayerId)?.category === "FOREIGN"
        ? "Individual taxpayer · Foreign national"
        : "Individual taxpayer · Bhutanese citizen"
      : user.role === "EMPLOYER"
        ? db.companies.find((c) => c.id === user.companyId)?.name ?? "Employer"
        : `GMCA · ${user.title ?? ROLE_LABEL[user.role]}`;
  const portal = user.role === "ASSESSOR" || user.role === "ADMIN" ? "GMCA Administration Portal" : "Taxpayer Portal";
  const persistError = getPersistError();
  const messagesPath = user.role === "ASSESSOR" ? "/gmca/notifications" : user.role === "ADMIN" ? "/admin/notifications" : "/messages";

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only z-50 bg-primary px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <div className="border-b border-act-line bg-act-bg text-act-fg" role="note">
        <p className="page flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-[13px]">
          <FlaskConical aria-hidden="true" className="size-3.5" />
          <span className="font-medium">Demonstration prototype (v2).</span>
          <span>Fictional data. NDI, Immigration, Corporate Registry and DK Bank are simulated: no real system is contacted.</span>
        </p>
      </div>
      <header className="border-b border-line bg-surface">
        <div className="page flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-4">
            <button type="button" className="grid size-10 place-items-center border border-line lg:hidden" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <Menu className="size-5" />
            </button>
            <Link to={HOME[user.role]} aria-label="Home">
              <Logo dark={dark} />
            </Link>
            <span className="hidden border-l border-line pl-4 text-sm text-muted md:block">{portal}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button type="button" onClick={toggleTheme} className="grid size-10 place-items-center text-fg-2 hover:bg-sunk" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="relative grid size-10 place-items-center text-fg-2 hover:bg-sunk" aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}>
                  <Bell className="size-5" />
                  {unread.length ? <span aria-hidden="true" className="absolute right-2 top-2 size-2 rounded-full bg-ember" /> : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {notes.length === 0 ? <p className="px-2.5 py-3 text-sm text-muted">Nothing yet. Updates about your filings appear here.</p> : null}
                {notes.slice(0, 5).map((n) => (
                  <DropdownMenuItem key={n.id} onSelect={() => navigate(n.link ?? messagesPath)} className="grid gap-0.5">
                    <span className={cn("text-sm", !isRead(n, user.id) && "font-medium")}>{n.title}</span>
                    <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate(messagesPath)}>See all</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-3 py-1 pl-1 pr-2 hover:bg-sunk" aria-label={`Account menu for ${user.name}`}>
                  <span className="grid size-10 place-items-center rounded-full bg-brand-700 text-sm font-medium text-white dark:bg-primary">{initials}</span>
                  <span className="hidden text-left leading-tight xl:block">
                    <span className="block text-sm font-medium text-fg">{user.name}</span>
                    <span className="block max-w-[16rem] truncate text-xs text-muted">{context}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="grid gap-0.5">
                  <span>{user.name}</span>
                  <span className="text-xs font-normal text-muted">{context}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal uppercase tracking-[0.12em] text-act-fg">
                  <FlaskConical className="size-3.5" /> Demo only: switch role
                </DropdownMenuLabel>
                {DEMO_ACCOUNTS.map((a) => (
                  <DropdownMenuItem key={a.userId} onSelect={() => signIn(a.userId)} className="grid gap-0">
                    <span className={cn("flex items-center gap-2 text-sm", a.userId === user.id && "font-medium")}>
                      <ArrowLeftRight className="size-3.5" /> {a.label}
                    </span>
                    <span className="pl-5 text-xs text-muted">{db.users.find((u) => u.id === a.userId)?.name}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => {
                    if (window.confirm("Reset all demo data to the seeded state? Everything changed in this browser is lost.")) {
                      resetDemoData();
                      navigate(HOME[user.role]);
                    }
                  }}
                >
                  <RotateCcw className="size-4" /> Reset demo data
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={signOut}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 flex h-full w-[85%] max-w-[320px] flex-col overflow-y-auto border-r border-line bg-surface p-4 shadow-pop">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-muted">{portal}</span>
              <button type="button" className="grid size-10 place-items-center" aria-label="Close menu" onClick={() => setDrawer(false)}>
                <X className="size-5" />
              </button>
            </div>
            <SideNav role={user.role} path={path} />
          </div>
        </div>
      ) : null}

      <div className="page flex flex-1 gap-10 pb-20 pt-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-6 grid gap-6">
            <SideNav role={user.role} path={path} />
          </div>
        </aside>
        <main id="main" className="grid min-w-0 flex-1 content-start gap-10">
          {persistError ? (
            <p role="alert" className="border border-rej-line bg-rej-bg px-4 py-3 text-sm text-rej-fg">
              {persistError}
            </p>
          ) : null}
          {children}
        </main>
      </div>
      <footer className="border-t border-line py-8 text-center text-sm text-muted">Gelephu Mindfulness City Authority · Income Tax · Prototype v2 with fictional data. Provisional visual design, not official GMCA branding.</footer>
    </div>
  );
}
