import { ArrowRight, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Db, IncomeSource, IndividualTaxReturn } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { ruleSetForYear } from "../../services/calc";
import { defaultSourceClassification, individualIncomeItems } from "../../services/classification";
import { nowIso } from "../../services/clock";
import { convert, conversionDateFor } from "../../services/currency";
import { DkBankLogo } from "../../shared/gmc/DkBankLogo";
import { StatusBadge } from "../../shared/gmc/Layout";
import { RadioGroup, SelectField, TextField } from "../../shared/gmc/Form";
import { ConversionView, CurrencySelect, RecordUpload, Section } from "../shared/ui";

/** Version 2's additional income editor: each source has its own currency and its own bank statement. */
function blankSource(ret: IndividualTaxReturn, db: Db): IncomeSource {
  const cat = individualIncomeItems(ruleSetForYear(db.ruleSets, ret.year))[0]!;
  return { id: `${ret.id}-src-${Date.now().toString(36)}`, category: cat.key, description: "", payer: "", amountMinor: 0, currency: db.config.reportingCurrency, periodFrom: `${ret.year}-01-01`, periodTo: `${ret.year}-12-31`, classification: defaultSourceClassification(cat), supportingDocIds: [] };
}

/** One of the two ways to add income: a large, clearly labelled choice. */
function AddOption({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group grid content-start gap-3 border border-line bg-surface p-5 text-left transition-colors hover:border-primary hover:bg-brand-50 focus-visible:shadow-[0_0_0_3px_var(--ring)] focus-visible:outline-none">
      <span className="flex min-h-9 items-center">{icon}</span>
      <span className="grid gap-1">
        <span className="flex items-center gap-2 font-medium text-fg">
          {title} <ArrowRight aria-hidden="true" className="size-4 text-brand-ink transition-transform group-hover:translate-x-0.5" />
        </span>
        <span className="text-sm text-muted">{body}</span>
      </span>
    </button>
  );
}

export function AdditionalIncome({ db, ret, sources, setSources, onDocsChanged, onSync, owner }: { db: Db; ret: IndividualTaxReturn; sources: IncomeSource[]; setSources: (s: IncomeSource[]) => void; onDocsChanged: (s: IncomeSource[]) => void; onSync: () => IncomeSource[] | undefined; owner: { kind: "INDIVIDUAL"; id: string } }) {
  const rules = ruleSetForYear(db.ruleSets, ret.year);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(sources.map((s) => [s.id, minorToInput(s.amountMinor || null)])));
  const update = (id: string, patch: Partial<IncomeSource>) => setSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <Section
      title="Additional income sources"
      description="Income other than your GMC employment: rent, business, dividends, interest, foreign work and similar. Each source has its own currency and is backed by a bank statement."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <AddOption
          icon={<DkBankLogo />}
          title={sources.some((s) => s.statementSource === "DK_BANK") ? "Sync statement from DK Bank again" : "Sync statement from DK Bank"}
          body={`Bring in the income credits on your DK Bank statement for ${ret.year}. The statement is attached for you.`}
          onClick={() => {
            const next = onSync();
            if (next) setAmounts(Object.fromEntries(next.map((s) => [s.id, amounts[s.id] ?? minorToInput(s.amountMinor || null)])));
          }}
        />
        <AddOption
          icon={<span className="grid size-9 place-items-center bg-brand-50 text-brand-ink"><Upload aria-hidden="true" className="size-5" /></span>}
          title="Bank statement upload"
          body="Enter an income source yourself and upload a statement from any bank."
          onClick={() => {
            const s = { ...blankSource(ret, db), statementSource: "UPLOAD" as const };
            setAmounts({ ...amounts, [s.id]: "" });
            setSources([...sources, s]);
          }}
        />
      </div>
      {sources.length === 0 ? <p className="border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No additional income added. If you only earned employment income in GMC, continue to the next step.</p> : null}
      {sources.map((s, i) => {
        const preview = convert(db.config, s.amountMinor, s.currency, conversionDateFor(db.config, s.periodTo || `${ret.year}-12-31`, nowIso().slice(0, 10)));
        const amountError = amounts[s.id] !== undefined && amounts[s.id] !== "" && parseAmountInput(amounts[s.id]!) === null ? "Enter an amount like 1250.00" : undefined;
        return (
          <fieldset key={s.id} className="grid gap-5 border border-line bg-surface p-5">
            <legend className="sr-only">Income source {i + 1}</legend>
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex flex-wrap items-center gap-2 font-medium">
                <span>
                  Income source {i + 1}
                  {s.description ? <span className="font-normal text-muted"> · {s.description}</span> : null}
                </span>
                {s.statementSource === "DK_BANK" ? (
                  <StatusBadge tone="neutral">
                    <RefreshCw aria-hidden="true" className="size-3" /> From DK Bank
                  </StatusBadge>
                ) : null}
              </h3>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm text-rej-fg hover:underline"
                onClick={() => {
                  if (window.confirm("Remove this income source and its bank statement link?")) onDocsChanged(sources.filter((x) => x.id !== s.id));
                }}
              >
                <Trash2 className="size-4" /> Remove
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Category"
                value={s.category}
                onChange={(e) => {
                  const cat = rules.taxItems.find((c) => c.key === e.target.value);
                  update(s.id, { category: e.target.value, classification: cat ? defaultSourceClassification(cat) : s.classification });
                }}
              >
                {/* A category switched off after this source was entered stays selectable for it. */}
                {rules.taxItems.filter((c) => c.key === s.category || individualIncomeItems(rules).includes(c)).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </SelectField>
              <TextField label="Description" required value={s.description} onChange={(e) => update(s.id, { description: e.target.value })} placeholder="For example: Apartment rent, Sarpang" />
              <TextField label="Paid by" value={s.payer} onChange={(e) => update(s.id, { payer: e.target.value })} />
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-3">
                <TextField
                  label="Amount"
                  required
                  inputMode="decimal"
                  value={amounts[s.id] ?? ""}
                  error={amountError}
                  onChange={(e) => {
                    setAmounts({ ...amounts, [s.id]: e.target.value });
                    update(s.id, { amountMinor: parseAmountInput(e.target.value) ?? 0 });
                  }}
                />
                <CurrencySelect db={db} value={s.currency} onChange={(c) => update(s.id, { currency: c })} />
              </div>
              <TextField label="Period from" type="date" value={s.periodFrom} onChange={(e) => update(s.id, { periodFrom: e.target.value })} />
              <TextField label="Period to" type="date" value={s.periodTo} onChange={(e) => update(s.id, { periodTo: e.target.value })} />
            </div>
            <RadioGroup
              legend="Treatment"
              name={`cls-${s.id}`}
              value={s.classification}
              onChange={(v) => update(s.id, { classification: v })}
              options={[
                { value: "TAXABLE", label: "Taxable" },
                { value: "EXEMPT", label: "Exempt" }
              ]}
            />
            <div className={cn("grid gap-1 border px-4 py-3 text-sm", preview.status === "PENDING" ? "border-act-line bg-act-bg" : "border-line-soft bg-sunk")}>
              <span className="text-muted">In the reporting currency ({db.config.reportingCurrency})</span>
              <ConversionView conversion={preview} />
              {preview.status === "CONVERTED" && preview.currency !== preview.reportingCurrency ? <span className="text-xs text-muted">Converted at the rate in force on {formatDate(preview.conversionDate)} (end of the income period, a demo rule). Demo rates are not official GMCA rates.</span> : null}
              {preview.status === "PENDING" ? <span className="text-xs text-act-fg">GMCA hasn't configured a rate for {s.currency}. You can save the draft, but you can't submit until a rate exists or you choose another currency.</span> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <RecordUpload
                db={db}
                label="Bank statement for this source"
                required
                hint="Show the payments for this source only."
                category="BANK_STATEMENT"
                owner={owner}
                related={{ kind: "INDIVIDUAL_RETURN", id: ret.id, incomeSourceId: s.id }}
                docIds={s.bankStatementDocId ? [s.bankStatementDocId] : []}
                onChange={(ids) => onDocsChanged(sources.map((x) => (x.id === s.id ? { ...x, bankStatementDocId: ids[0] } : x)))}
              />
              <RecordUpload
                db={db}
                label="Other supporting documents (optional)"
                category="INCOME_SUPPORTING"
                owner={owner}
                related={{ kind: "INDIVIDUAL_RETURN", id: ret.id, incomeSourceId: s.id }}
                docIds={s.supportingDocIds}
                multiple
                onChange={(ids) => onDocsChanged(sources.map((x) => (x.id === s.id ? { ...x, supportingDocIds: ids } : x)))}
              />
            </div>
          </fieldset>
        );
      })}
      <p className="text-sm text-muted">Categories and their default treatment are configured by GMCA administrators and are not a definitive statutory list.</p>
    </Section>
  );
}

