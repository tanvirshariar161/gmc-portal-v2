import { AlertTriangle, CheckCircle2, ChevronRight, Info, X, XCircle } from "lucide-react";
import { createContext, isValidElement, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { formatMoney, type Cents } from "../../lib/money";

export function Eyebrow({ children, tone = "brand", className }: { children: ReactNode; tone?: "brand" | "onGreen"; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.22em]", tone === "brand" ? "text-brand-ink" : "text-white/75", className)}>
      <span aria-hidden="true" className={cn("block h-px w-6", tone === "brand" ? "bg-brand-ink" : "bg-white/45")} />
      {children}
    </div>
  );
}

/** Eyebrow + Lora display + lead: the heading stack used on every page of the GMC ecosystem. */
export function PageIntro({ eyebrow, title, lead, actions, size = "lg" }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode; size?: "lg" | "md" }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="grid max-w-3xl gap-4">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <div className="flex items-center gap-2">
          {lead && textOf(lead).length > LONG_GUIDANCE ? <InfoTip label={typeof title === "string" ? title : "this step"}>{lead}</InfoTip> : null}
          <h1 className={cn("display", size === "lg" ? "text-[2.25rem] sm:text-[3.25rem]" : "text-[2rem] sm:text-[2.5rem]")}>{title}</h1>
        </div>
        {lead && textOf(lead).length <= LONG_GUIDANCE ? <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

export function SectionLabel({ children, rule = false, id }: { children: ReactNode; rule?: boolean; id?: string }) {
  return (
    <h2 id={id} className="flex items-center gap-4 text-[13px] font-medium uppercase tracking-[0.12em] text-muted">
      {children}
      {rule ? <span aria-hidden="true" className="h-px flex-1 bg-line" /> : null}
    </h2>
  );
}

export type StatusFamily = "neutral" | "review" | "action" | "approved" | "rejected";

const family: Record<StatusFamily, string> = {
  neutral: "bg-surface text-fg-2 border-line",
  review: "bg-rev-bg text-rev-fg border-rev-line",
  action: "bg-act-bg text-act-fg border-act-line",
  approved: "bg-ok-bg text-ok-fg border-ok-line",
  rejected: "bg-rej-bg text-rej-fg border-rej-line"
};

export function StatusBadge({ tone, children }: { tone: StatusFamily; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap border px-2.5 py-0.5 text-xs font-medium", family[tone])}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const alertIcon = { review: Info, action: AlertTriangle, approved: CheckCircle2, rejected: XCircle, neutral: Info };

export function Alert({ tone = "review", title, children, action }: { tone?: StatusFamily; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = alertIcon[tone];
  return (
    <div role={tone === "rejected" ? "alert" : "status"} className={cn("flex gap-3 border px-4 py-3 text-sm", family[tone])}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="grid flex-1 gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="leading-relaxed text-fg-2 [&_strong]:text-fg">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

/** CR-05: when a dashboard section is wrapped in <AmountMask hidden>, amounts render as •••• for screen readers and eyes alike. */
const MaskContext = createContext(false);
export function AmountMask({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <MaskContext.Provider value={hidden}>{children}</MaskContext.Provider>;
}

export function Money({ cents, currency, className }: { cents: Cents; currency?: string; className?: string }) {
  const masked = useContext(MaskContext);
  if (masked) {
    return (
      <span className={cn("num", className)}>
        <span aria-hidden="true">$••••</span>
        <span className="sr-only">amount hidden</span>
      </span>
    );
  }
  return <span className={cn("num", className)}>{formatMoney(cents, currency)}</span>;
}

/** Label/value rows for summaries and receipts. */
export function DataList({ rows, className }: { rows: { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line-soft", className)}>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-6">
          <dt className="text-sm text-muted">{row.label}</dt>
          <dd className="min-w-0 text-[15px] text-fg">
            {row.value}
            {row.hint ? <span className="mt-0.5 block text-xs text-muted">{row.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function IconTile({ icon: Icon, size = 40, tone = "brand" }: { icon: typeof Info; size?: 28 | 40 | 52; tone?: "brand" | "onGreen" }) {
  const box = size === 28 ? "size-7" : size === 40 ? "size-10" : "size-[52px]";
  const glyph = size === 28 ? "size-4" : size === 40 ? "size-5" : "size-6";
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center", box, tone === "brand" ? "bg-brand-50 text-brand-ink" : "bg-white/15 text-white")}>
      <Icon className={glyph} strokeWidth={1.75} />
    </span>
  );
}

/** Quick-access tile (C16): icon, title, description, optional count, chevron. */
export function Tile({ icon, title, description, count, href, onNavigate }: { icon: typeof Info; title: string; description: string; count?: number; href: string; onNavigate: (path: string) => void }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(href);
      }}
      className="group flex items-center gap-4 border border-line bg-surface px-5 py-4 transition-colors hover:border-brand-200 hover:bg-brand-50"
    >
      <IconTile icon={icon} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium text-fg">{title}</span>
        <span className="text-sm text-muted">{description}</span>
      </span>
      {count !== undefined ? (
        <>
          <span className="num grid size-[30px] place-items-center rounded-full border-2 border-line font-serif text-sm text-fg">{count}</span>
          <span aria-hidden="true" className="h-6 w-px bg-line" />
        </>
      ) : null}
      <ChevronRight aria-hidden="true" className="size-4 text-line transition group-hover:translate-x-0.5 group-hover:text-brand-ink" />
    </a>
  );
}

/** Hero action card (C14 filled / C15 outlined): the one primary action of a page. */
export function ActionCard({
  href,
  onNavigate,
  filled,
  icon,
  eyebrow,
  title,
  body,
  cta
}: {
  href: string;
  onNavigate: (path: string) => void;
  filled: boolean;
  icon: typeof Info;
  eyebrow: ReactNode;
  title: ReactNode;
  body: ReactNode;
  cta: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(href);
      }}
      className={cn(
        "group relative grid min-h-[210px] content-between gap-6 overflow-hidden p-7 transition-colors sm:p-8",
        filled ? "bg-primary text-white hover:bg-primary-hover" : "border border-brand-200 bg-surface hover:border-primary hover:bg-brand-50"
      )}
    >
      {filled ? (
        <svg aria-hidden="true" className="pointer-events-none absolute -right-24 -top-16 h-[420px] w-[420px]" viewBox="0 0 420 420" fill="none">
          {Array.from({ length: 14 }, (_, i) => (
            <circle key={i} cx="210" cy="140" r={14 * (i + 1)} stroke="#fff" strokeOpacity="0.08" />
          ))}
        </svg>
      ) : null}
      <div className="relative flex gap-5">
        <IconTile icon={icon} size={52} tone={filled ? "onGreen" : "brand"} />
        <div className="grid gap-2">
          <Eyebrow tone={filled ? "onGreen" : "brand"}>{eyebrow}</Eyebrow>
          <h2 className={cn("font-serif text-[1.625rem] leading-tight sm:text-[1.875rem]", !filled && "text-fg")}>{title}</h2>
          <p className={cn("text-[15px]", filled ? "text-white/85" : "text-fg-2")}>{body}</p>
        </div>
      </div>
      <span className={cn("relative flex items-center justify-end gap-2 font-medium transition-[gap] group-hover:gap-3", !filled && "text-fg")}>
        {cta} <ChevronRight aria-hidden="true" className="size-4" />
      </span>
    </a>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: typeof Info; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel grid justify-items-center gap-3 px-6 py-14 text-center">
      <IconTile icon={icon} size={52} />
      <h2 className="font-serif text-xl">{title}</h2>
      {children ? <p className="max-w-sm text-sm text-muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function Breadcrumb({ items, onNavigate }: { items: { label: string; href?: string }[]; onNavigate: (path: string) => void }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-2">
            {i > 0 ? <ChevronRight aria-hidden="true" className="size-3.5" /> : null}
            {item.href ? (
              <a
                href={item.href}
                className="hover:text-fg"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.href!);
                }}
              >
                {item.label}
              </a>
            ) : (
              <span aria-current="page" className="text-fg">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Plain text of a node, to judge how long a piece of guidance is. */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Guidance longer than this moves behind an info icon next to its heading. */
export const LONG_GUIDANCE = 90;

/**
 * Info icon that shows guidance on demand, so long help text doesn't crowd the page.
 * Opens on click or tap; Escape or a click elsewhere closes it.
 */
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className={cn("grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-sunk hover:text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", open && "bg-sunk text-brand-ink")}
      >
        <Info aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
      </button>
      {open ? (
        <span id={id} role="note" className="absolute left-0 top-full z-40 mt-2 block w-[min(26rem,calc(100vw-2rem))] border border-line bg-surface p-4 text-left font-sans text-sm font-normal leading-relaxed tracking-normal text-fg-2 shadow-lg">
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** Modal dialog on the native <dialog> element: focus stays inside, Escape closes it. */
export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={`${title}-title`}
      className={cn("m-auto border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40", size === "lg" ? "w-[min(52rem,calc(100vw-2rem))]" : "w-[min(36rem,calc(100vw-2rem))]")}
    >
      {open ? (
        <div className="grid gap-5 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <h2 id={`${title}-title`} className="font-serif text-[1.5rem] leading-tight">
              {title}
            </h2>
            <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center text-muted hover:bg-sunk hover:text-fg">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          {children}
          {footer ? <div className="flex flex-wrap justify-end gap-3 border-t border-line-soft pt-4">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
