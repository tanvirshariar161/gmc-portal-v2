import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BalanceSheetLine, Db, OwnerRef, RelatedRef, TaxRegime, TaxRuleSet } from "../../domain/types";
import { formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { GROUPS, itemsFor, lineGroup, totals, type BalanceSheetGroup } from "../../services/balanceSheet";
import { Button } from "../../shared/gmc/Button";
import { SelectField, TextField } from "../../shared/gmc/Form";
import { DataTable } from "../../shared/gmc/Table";
import { DocLink, RecordUpload } from "./ui";

/** Assets, investments and liabilities on 31 December, in the reporting currency. Used by individual and corporate returns. */
export function BalanceSheetEditor({
  db,
  rules,
  regime,
  year,
  owner,
  related,
  lines,
  setLines,
  onDocsChanged
}: {
  db: Db;
  rules: TaxRuleSet;
  regime: TaxRegime;
  year: number;
  owner: OwnerRef;
  related: RelatedRef;
  lines: BalanceSheetLine[];
  setLines: (l: BalanceSheetLine[]) => void;
  /** Called when a document changes, so the row is saved straight away. */
  onDocsChanged: (l: BalanceSheetLine[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, minorToInput(l.valueMinor || null)])));
  const cur = db.config.reportingCurrency;
  const update = (id: string, patch: Partial<BalanceSheetLine>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const add = (group: BalanceSheetGroup) => {
    const first = itemsFor(rules, regime, group)[0];
    if (!first) return;
    const id = `bs-${Date.now().toString(36)}`;
    setValues({ ...values, [id]: "" });
    setLines([...lines, { id, itemKey: first.key, description: "", valueMinor: 0, docIds: [] }]);
  };
  const t = totals(rules, lines);

  return (
    <div className="grid gap-8">
      <p className="text-[15px] text-fg-2">
        Values are in {cur} on 31 December {year}. GMCA uses them to check your return; they don't change your tax.
      </p>
      {GROUPS.map((g) => {
        const rows = lines.filter((l) => lineGroup(rules, l) === g.key);
        const choices = itemsFor(rules, regime, g.key);
        return (
          <section key={g.key} className="grid gap-3" aria-labelledby={`bs-${g.key}`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid gap-0.5">
                <h2 id={`bs-${g.key}`} className="font-serif text-xl">
                  {g.title}
                </h2>
                <p className="text-sm text-muted">{g.description}</p>
              </div>
              <Button size="sm" variant="secondary" disabled={!choices.length} onClick={() => add(g.key)}>
                <Plus /> Add {g.singular}
              </Button>
            </div>
            {rows.length === 0 ? <p className="border border-dashed border-line px-4 py-4 text-center text-sm text-muted">No {g.title.toLowerCase()} added.</p> : null}
            {rows.map((l, i) => {
              const bad = values[l.id] !== undefined && values[l.id] !== "" && parseAmountInput(values[l.id]!) === null;
              const item = rules.taxItems.find((x) => x.key === l.itemKey);
              return (
                <fieldset key={l.id} className="grid gap-4 border border-line bg-surface p-4 sm:p-5">
                  <legend className="sr-only">
                    {g.title} row {i + 1}
                  </legend>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium">
                      {g.singular[0]!.toUpperCase() + g.singular.slice(1)} {i + 1}
                      {l.description ? <span className="font-normal text-muted"> · {l.description}</span> : null}
                    </h3>
                    <button type="button" className="inline-flex items-center gap-1.5 text-sm text-rej-fg hover:underline" onClick={() => onDocsChanged(lines.filter((x) => x.id !== l.id))}>
                      <Trash2 aria-hidden="true" className="size-4" /> Remove
                    </button>
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    <SelectField label="Type" value={l.itemKey} onChange={(e) => update(l.id, { itemKey: e.target.value })}>
                      {itemsFor(rules, regime, g.key, [l.itemKey]).map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.label}
                        </option>
                      ))}
                    </SelectField>
                    <TextField label="Description" required value={l.description} onChange={(e) => update(l.id, { description: e.target.value })} placeholder={g.key === "INVESTMENT" ? "For example: Fixed deposit, DK Bank" : g.key === "LIABILITY" ? "For example: Home loan, BNB" : "For example: House in Gelephu"} />
                    <TextField
                      label={`Value (${cur})`}
                      required
                      inputMode="decimal"
                      prefix={cur === "BTN" ? "Nu" : cur === "USD" ? "$" : undefined}
                      value={values[l.id] ?? ""}
                      error={bad ? "Enter an amount like 25000" : undefined}
                      onChange={(e) => {
                        setValues({ ...values, [l.id]: e.target.value });
                        update(l.id, { valueMinor: parseAmountInput(e.target.value) ?? 0 });
                      }}
                    />
                  </div>
                  {g.key === "INVESTMENT" ? (
                    <RecordUpload
                      db={db}
                      label="Document for this investment"
                      hint={item?.evidenceExamples.length ? `For example: ${item.evidenceExamples.join(", ").toLowerCase()}. PDF, JPG or PNG.` : "A statement or certificate. PDF, JPG or PNG."}
                      category="ASSET_EVIDENCE"
                      owner={owner}
                      related={related}
                      docIds={l.docIds}
                      multiple
                      onChange={(ids) => onDocsChanged(lines.map((x) => (x.id === l.id ? { ...x, docIds: ids } : x)))}
                    />
                  ) : null}
                </fieldset>
              );
            })}
          </section>
        );
      })}
      <BalanceSheetTotals t={t} />
    </div>
  );
}

function BalanceSheetTotals({ t }: { t: ReturnType<typeof totals> }) {
  return (
    <dl className="grid border border-line sm:grid-cols-4">
      {[
        ["Assets", t.assets],
        ["Investments", t.investments],
        ["Liabilities", -t.liabilities],
        ["Net worth", t.net]
      ].map(([label, v], i) => (
        <div key={label as string} className={i > 0 ? "grid gap-1 border-t border-line px-5 py-4 sm:border-l sm:border-t-0" : "grid gap-1 px-5 py-4"}>
          <dt className="text-sm text-muted">{label}</dt>
          <dd className={i === 3 ? "num font-serif text-2xl" : "num text-lg"}>{formatMoney(v as number)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Read-only, as submitted. */
export function BalanceSheetView({ db, rules, lines }: { db: Db; rules: TaxRuleSet | undefined; lines: BalanceSheetLine[] }) {
  const rows = GROUPS.flatMap((g) => lines.filter((l) => lineGroup(rules, l) === g.key).map((l) => ({ ...l, group: g })));
  return (
    <div className="grid gap-4">
      <DataTable
        caption="Assets and liabilities"
        rows={rows}
        rowKey={(l) => l.id}
        minWidth="40rem"
        empty="No assets or liabilities declared."
        columns={[
          { key: "g", header: "Group", cell: (l) => l.group.title },
          { key: "d", header: "Item", cell: (l) => <span className="grid"><span>{l.description}</span><span className="text-xs text-muted">{rules?.taxItems.find((x) => x.key === l.itemKey)?.label ?? l.itemKey}</span></span> },
          { key: "v", header: "Value", align: "right", cell: (l) => <span className="num">{formatMoney(l.group.key === "LIABILITY" ? -l.valueMinor : l.valueMinor)}</span> },
          { key: "doc", header: "Documents", cell: (l) => (l.docIds.length ? <span className="grid gap-1">{l.docIds.map((x) => { const doc = db.documents.find((d) => d.id === x); return doc ? <DocLink key={x} doc={doc}>{doc.fileName}</DocLink> : null; })}</span> : <span className="text-muted">—</span>) }
        ]}
      />
      {rows.length ? <BalanceSheetTotals t={totals(rules, lines)} /> : null}
    </div>
  );
}
