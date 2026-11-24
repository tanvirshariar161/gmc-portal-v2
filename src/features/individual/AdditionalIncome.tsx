import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Db, IncomeSource, IndividualTaxReturn } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { ruleSetForYear } from "../../services/calc";
import { nowIso } from "../../services/clock";
import { convert, conversionDateFor } from "../../services/currency";
import { Button } from "../../shared/gmc/Button";
import { RadioGroup, SelectField, TextField } from "../../shared/gmc/Form";
import { ConversionView, CurrencySelect, RecordUpload, Section } from "../shared/ui";

/** Version 2's additional income editor: each source has its own currency and its own bank statement. */
function blankSource(ret: IndividualTaxReturn, db: Db): IncomeSource {
  const cat = ruleSetForYear(db.ruleSets, ret.year).incomeCategories[0]!;
  return { id: `${ret.id}-src-${Date.now().toString(36)}`, category: cat.key, description: "", payer: "", amountMinor: 0, currency: db.config.reportingCurrency, periodFrom: `${ret.year}-01-01`, periodTo: `${ret.year}-12-31`, classification: cat.defaultClassification, supportingDocIds: [] };
}

export function AdditionalIncome({ db, ret, sources, setSources, onDocsChanged, owner }: { db: Db; ret: IndividualTaxReturn; sources: IncomeSource[]; setSources: (s: IncomeSource[]) => void; onDocsChanged: (s: IncomeSource[]) => void; owner: { kind: "INDIVIDUAL"; id: string } }) {
  const rules = ruleSetForYear(db.ruleSets, ret.year);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(sources.map((s) => [s.id, minorToInput(s.amountMinor || null)])));
  const update = (id: string, patch: Partial<IncomeSource>) => setSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <Section
      title="Additional income sources"
      description="Income other than your GMC employment: rent, business, dividends, interest, foreign work and similar. Each source has its own currency and needs its own bank statement."
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const s = blankSource(ret, db);
            setAmounts({ ...amounts, [s.id]: "" });
            setSources([...sources, s]);
          }}
        >
          <Plus /> Add income source
        </Button>
      }
    >
      {sources.length === 0 ? <p className="border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No additional income added. If you only earned employment income in GMC, continue to the next step.</p> : null}
      {sources.map((s, i) => {
        const preview = convert(db.config, s.amountMinor, s.currency, conversionDateFor(db.config, s.periodTo || `${ret.year}-12-31`, nowIso().slice(0, 10)));
        const amountError = amounts[s.id] !== undefined && amounts[s.id] !== "" && parseAmountInput(amounts[s.id]!) === null ? "Enter an amount like 1250.00" : undefined;
        return (
          <fieldset key={s.id} className="grid gap-5 border border-line bg-surface p-5">
            <legend className="sr-only">Income source {i + 1}</legend>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">
                Income source {i + 1}
                {s.description ? <span className="font-normal text-muted"> · {s.description}</span> : null}
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
                  const cat = rules.incomeCategories.find((c) => c.key === e.target.value);
                  update(s.id, { category: e.target.value, classification: cat?.defaultClassification ?? s.classification });
                }}
              >
                {rules.incomeCategories.map((c) => (
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

