import { FileText, FlaskConical, Paperclip, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useRun } from "../../app/core";
import type { Actor } from "../../domain/store";
import type { AssessmentStatus, CalculationSnapshot, Conversion, Db, DocumentCategory, DocumentReviewStatus, OwnerRef, PaymentStatus, RelatedRef, SubmissionStatus, TaxDocument } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { formatAmount, formatMoney, formatRate } from "../../lib/money";
import { cn } from "../../lib/utils";
import { CATEGORY_LABEL, removeDraftDocument, uploadDocument, validateUpload } from "../../services/documents";
import { StatusBadge, type StatusFamily } from "../../shared/gmc/Layout";

export function PageHeader({ title, lead, actions, back }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="grid gap-4">
      {back ? (
        <Link to={back.to} className="w-fit text-sm text-muted hover:text-fg">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="grid max-w-3xl gap-3">
          <h1 className="display text-[2rem] sm:text-[2.5rem]">{title}</h1>
          {lead ? <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{lead}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="font-serif text-xl text-fg sm:text-[1.375rem]">{title}</h2>
          {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Marks seeded data and simulated integrations so nothing reads as official. */
export function DemoTag({ children = "Demo", title }: { children?: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap border border-act-line bg-act-bg px-1.5 py-px text-[11px] font-medium uppercase tracking-[0.08em] text-act-fg">
      <FlaskConical aria-hidden="true" className="size-3" />
      {children}
    </span>
  );
}

// ---------- Status badges: separate badges for separate processes ----------

const SUBMISSION: Record<SubmissionStatus, [StatusFamily, string]> = { DRAFT: ["neutral", "Draft"], SUBMITTED: ["approved", "Submitted"] };
const ASSESSMENT: Record<AssessmentStatus, [StatusFamily, string]> = {
  NOT_ASSIGNED: ["neutral", "Not assigned"],
  ASSIGNED: ["review", "Assigned"],
  UNDER_REVIEW: ["review", "Under review"],
  INFO_REQUIRED: ["action", "Additional information required"],
  RESPONSE_RECEIVED: ["review", "Response received"],
  COMPLETED: ["approved", "Assessment completed"]
};
const PAYMENT: Record<PaymentStatus, [StatusFamily, string]> = {
  NOT_DUE: ["neutral", "Not due"],
  UNPAID: ["action", "Unpaid"],
  PENDING: ["review", "Payment pending"],
  PARTIALLY_PAID: ["action", "Partially paid"],
  PAID: ["approved", "Paid"],
  FAILED: ["rejected", "Last payment failed"]
};
const DOC_REVIEW: Record<DocumentReviewStatus, [StatusFamily, string]> = {
  UPLOADED: ["neutral", "Uploaded"],
  UNDER_REVIEW: ["review", "Under review"],
  ACCEPTED: ["approved", "Accepted"],
  REJECTED: ["rejected", "Rejected"],
  EVIDENCE_REQUIRED: ["action", "More evidence required"]
};

export const assessmentLabel = (s: AssessmentStatus) => ASSESSMENT[s][1];
export const paymentLabel = (s: PaymentStatus) => PAYMENT[s][1];

export function SubmissionBadge({ status }: { status: SubmissionStatus }) {
  const [t, l] = SUBMISSION[status];
  return <StatusBadge tone={t}>{l}</StatusBadge>;
}
export function AssessmentBadge({ status }: { status: AssessmentStatus }) {
  const [t, l] = ASSESSMENT[status];
  return <StatusBadge tone={t}>{l}</StatusBadge>;
}
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const [t, l] = PAYMENT[status];
  return <StatusBadge tone={t}>{l}</StatusBadge>;
}
export function DocReviewBadge({ status }: { status?: DocumentReviewStatus }) {
  if (!status) return null;
  const [t, l] = DOC_REVIEW[status];
  return <StatusBadge tone={t}>{l}</StatusBadge>;
}

// ---------- Metrics ----------

/** A row of summary figures inside one bordered band (not a card per number). */
export function MetricStrip({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <dl className="grid border border-line bg-surface sm:grid-cols-2 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
      {items.map((m, i) => (
        <div key={m.label} className={cn("grid content-start gap-1 px-5 py-4", i > 0 && "border-t border-line-soft sm:[&:nth-child(2)]:border-t-0 lg:border-l lg:border-t-0")}>
          <dt className="text-[13px] text-muted">{m.label}</dt>
          <dd className="num font-serif text-[1.625rem] leading-tight text-fg">{m.value}</dd>
          {m.hint ? <dd className="text-xs text-muted">{m.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

// ---------- Currency ----------

export function ConversionView({ conversion, compact }: { conversion?: Conversion; compact?: boolean }) {
  if (!conversion) return <span className="text-muted">—</span>;
  const original = formatAmount(conversion.originalMinor, conversion.currency);
  if (conversion.currency === conversion.reportingCurrency) return <span className="num">{original}</span>;
  if (conversion.status === "PENDING")
    return (
      <span className="grid gap-0.5">
        <span className="num">{original}</span>
        <span className="text-xs font-medium text-act-fg">Conversion pending · no rate configured</span>
      </span>
    );
  return (
    <span className="grid gap-0.5">
      <span className="num">{formatAmount(conversion.reportingMinor!, conversion.reportingCurrency)}</span>
      <span className="num text-xs text-muted">
        {original} at {formatRate(conversion.rate!, conversion.currency, conversion.reportingCurrency)}
        {compact ? "" : ` · rate of ${formatDate(conversion.rateDate, "short")}`} {conversion.isDemoRate ? <span className="font-medium text-act-fg">· demo rate</span> : null}
      </span>
    </span>
  );
}

export function CurrencySelect({ db, value, onChange, id, label = "Currency", className }: { db: Db; value: string; onChange: (c: string) => void; id?: string; label?: string; className?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const hasRate = (code: string) => code === db.config.reportingCurrency || db.config.exchangeRates.some((r) => r.currency === code);
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={fid} className="text-sm font-medium">
        {label}
      </label>
      <select id={fid} className="control" value={value} onChange={(e) => onChange(e.target.value)}>
        {db.config.currencies
          .filter((c) => c.enabled || c.code === value)
          .map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
              {hasRate(c.code) ? "" : " (no rate yet)"}
            </option>
          ))}
      </select>
    </div>
  );
}

// ---------- Calculation breakdown ----------

export function CalcBreakdown({ snapshot, title = "Calculation" }: { snapshot?: CalculationSnapshot; title?: string }) {
  if (!snapshot) return null;
  return (
    <div className="border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h3 className="font-medium">{title}</h3>
        <span className="flex items-center gap-2 text-xs text-muted">
          Rule set {snapshot.ruleSetVersion} <DemoTag>Prototype</DemoTag>
        </span>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <tbody>
          {snapshot.lines.map((l) => (
            <tr key={l.key} className={cn("border-b border-line-soft", l.tone === "total" && "bg-sunk font-medium", l.tone === "sub" && "font-medium")}>
              <th scope="row" className="px-5 py-2.5 text-left font-[inherit]">
                {l.label}
                {l.note ? <span className="mt-0.5 block text-xs font-normal text-muted">{l.note}</span> : null}
              </th>
              <td className={cn("num whitespace-nowrap px-5 py-2.5 text-right align-top", l.tone === "credit" && "text-ok-fg")}>{formatMoney(l.amountMinor, snapshot.reportingCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshot.warnings.length || snapshot.assumptions.length ? (
        <div className="grid gap-2 px-5 py-4 text-xs leading-relaxed">
          {snapshot.warnings.map((w) => (
            <p key={w} className="text-act-fg">
              {w}
            </p>
          ))}
          {snapshot.assumptions.map((a) => (
            <p key={a} className="text-muted">
              {a}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Documents ----------

export function DocLink({ doc, children }: { doc: TaxDocument; children?: ReactNode }) {
  return (
    <Link to={`/documents/${doc.id}`} className="inline-flex items-center gap-1.5 text-brand-ink underline-offset-4 hover:underline">
      <FileText aria-hidden="true" className="size-4 shrink-0" />
      {children ?? doc.title}
    </Link>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * Upload linked to one specific record (an income source, a relief, a request…).
 * Validates type and size before anything is stored.
 */
export function RecordUpload({
  db,
  label,
  hint,
  category,
  owner,
  related,
  docIds,
  onChange,
  multiple = false,
  disabled,
  required
}: {
  db: Db;
  label: string;
  hint?: ReactNode;
  category: DocumentCategory;
  owner: OwnerRef;
  related: RelatedRef;
  docIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const run = useRun();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const docs = docIds.map((x) => db.documents.find((d) => d.id === x)).filter(Boolean) as TaxDocument[];

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const added: string[] = [];
    for (const file of Array.from(files).slice(0, multiple ? 5 : 1)) {
      const problem = validateUpload(file);
      if (problem) {
        setError(problem);
        continue;
      }
      const dataUrl = file.size <= 400 * 1024 ? await readAsDataUrl(file).catch(() => undefined) : undefined;
      const doc = run((d, actor: Actor) => uploadDocument(d, actor, { category, fileName: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl, owner, related }));
      if (doc) added.push(doc.id);
    }
    if (added.length) onChange(multiple ? [...docIds, ...added] : added);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-rej-fg">
              {" "}
              *
            </span>
          ) : null}
        </span>
        {!disabled && (multiple || docs.length === 0) ? (
          <button type="button" onClick={() => input.current?.click()} className="inline-flex h-8 items-center gap-2 border border-line bg-surface px-3 text-[13px] font-medium text-fg-2 hover:bg-sunk hover:text-fg" aria-describedby={`${id}-label`}>
            <Upload aria-hidden="true" className="size-4" /> {docs.length ? "Add another" : "Upload"}
          </button>
        ) : null}
        <input ref={input} type="file" className="sr-only" tabIndex={-1} accept="application/pdf,image/jpeg,image/png" multiple={multiple} onChange={(e) => void pick(e.target.files)} aria-labelledby={`${id}-label`} />
      </div>
      {docs.length ? (
        <ul className="grid gap-1.5">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border border-line-soft bg-sunk px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <Link to={`/documents/${doc.id}`} className="truncate text-brand-ink hover:underline">
                  {doc.fileName}
                </Link>
                <span className="text-xs text-muted">{CATEGORY_LABEL[doc.category]}</span>
              </span>
              <span className="flex items-center gap-2">
                <DocReviewBadge status={doc.reviewStatus} />
                {!disabled ? (
                  <button
                    type="button"
                    className="grid size-8 place-items-center text-muted hover:bg-rej-bg hover:text-rej-fg"
                    aria-label={`Remove ${doc.fileName}`}
                    onClick={() => {
                      run((d, actor) => removeDraftDocument(d, actor, doc.id));
                      onChange(docIds.filter((x) => x !== doc.id));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn("border border-dashed px-3 py-3 text-sm", required ? "border-act-line text-act-fg" : "border-line text-muted")}>{required ? "Required. " : ""}{hint ?? "PDF, JPG or PNG, up to 10 MB."}</p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-rej-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function KeyValue({ rows }: { rows: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-0.5">
          <dt className="text-[13px] text-muted">{r.label}</dt>
          <dd className="text-[15px] text-fg">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ownerName(db: Db, owner: OwnerRef) {
  return owner.kind === "INDIVIDUAL" ? db.taxpayers.find((t) => t.id === owner.id)?.fullName ?? "Unknown taxpayer" : db.companies.find((c) => c.id === owner.id)?.name ?? "Unknown company";
}

export function userName(db: Db, id?: string) {
  if (!id) return "—";
  return db.users.find((u) => u.id === id)?.name ?? (id === "system" ? "Platform" : "Unknown user");
}
