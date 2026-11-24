import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { TaxItem, TaxItemKind, TaxpayerClass, TaxRegime, TaxRuleSet, TaxTreatment } from "../../domain/types";
import { cn } from "../../lib/utils";
import {
  CITIZENSHIP_LABEL,
  DIFFERENCE_LABEL,
  describeItemTreatment,
  describeRate,
  ENTITY_LABEL,
  findTaxpayerClass,
  KIND_LABEL,
  PROFILES,
  profileLabel,
  RESIDENCY_LABEL,
  treatmentMeta,
  treatmentsFor
} from "../../services/classification";
import { Button } from "../../shared/gmc/Button";
import { Checkbox, SelectField, TextArea, TextField } from "../../shared/gmc/Form";
import { StatusBadge } from "../../shared/gmc/Layout";
import { Section, Tabs } from "../shared/ui";

/**
 * Editor for the taxpayer classes and the tax item catalogue of a draft rule set.
 * It only edits the draft: RuleSetEditor publishes it, and the admin service validates it.
 */
type TabKey = "INDIVIDUAL" | "CORPORATE" | "ITEMS";
const TABS: { key: TabKey; label: string }[] = [
  { key: "INDIVIDUAL", label: "Individuals" },
  { key: "CORPORATE", label: "Businesses" },
  { key: "ITEMS", label: "Tax item catalogue" }
];

export function ClassificationEditor({ draft, base, onClasses, onItems }: { draft: TaxRuleSet; base: TaxRuleSet; onClasses: (c: TaxpayerClass[]) => void; onItems: (i: TaxItem[]) => void }) {
  const [tab, setTab] = useState<TabKey>("INDIVIDUAL");
  const slice = (k: TabKey, r: TaxRuleSet) => JSON.stringify(k === "ITEMS" ? r.taxItems : r.taxpayerClasses.filter((c) => c.regime === k));
  return (
    <Tabs label="Classification" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, marker: slice(t.key, draft) !== slice(t.key, base) ? "unpublished changes" : undefined }))}>
      {tab === "ITEMS" ? <ItemCatalogue draft={draft} base={base} onItems={onItems} /> : <ClassSection key={tab} regime={tab} draft={draft} base={base} onClasses={onClasses} />}
    </Tabs>
  );
}

function uniqueKey(prefix: string, taken: string[]) {
  let n = 1;
  while (taken.includes(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** Percentage input that keeps what is typed ("33.") while passing the parsed value up. */
function PercentField({ label, value, onValue, hint, placeholder }: { label: string; value: number | null; onValue: (v: number | null) => void; hint?: string; placeholder?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text);
    // Resync only when the value changed from outside this field (Object.is keeps a typed "abc" as typed).
    if (!Object.is(parsed, value)) setText(value === null ? "" : String(value));
  }, [value]);
  return (
    <TextField
      label={label}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      hint={hint}
      onChange={(e) => {
        setText(e.target.value);
        onValue(e.target.value.trim() === "" ? null : Number(e.target.value));
      }}
    />
  );
}

// ---------- Taxpayer classes ----------

const REGIME_TEXT: Record<TaxRegime, { title: string; description: string }> = {
  INDIVIDUAL: { title: "Taxpayer classes: individuals", description: "Matched on citizenship and the residency GMCA has recorded. The first enabled class that matches applies, so put specific classes above general ones." },
  CORPORATE: { title: "Taxpayer classes: businesses", description: "Matched on entity type for corporate returns. Approved company incentives override the class rate for their effective period." }
};

function ClassSection({ regime, draft, base, onClasses }: { regime: TaxRegime; draft: TaxRuleSet; base: TaxRuleSet; onClasses: (c: TaxpayerClass[]) => void }) {
  const all = draft.taxpayerClasses;
  const mine = all.map((c, i) => ({ c, i })).filter((x) => x.c.regime === regime);
  const [previewYear, setPreviewYear] = useState(draft.effectiveFromYear);
  const update = (i: number, patch: Partial<TaxpayerClass>) => onClasses(all.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (pos: number, dir: -1 | 1) => {
    const a = mine[pos]!.i;
    const b = mine[pos + dir]!.i;
    const next = [...all];
    [next[a], next[b]] = [next[b]!, next[a]!];
    onClasses(next);
  };
  const add = () =>
    onClasses([
      ...all,
      { key: uniqueKey(regime === "INDIVIDUAL" ? "IND_CLASS" : "CORP_CLASS", all.map((c) => c.key)), label: "", description: "", regime, citizenship: "ANY", residency: "ANY", entityType: "ANY", rateBasis: "FLAT", flatRatePct: 0, incomeScope: "WORLDWIDE", lastIncomeYear: null, enabled: true }
    ]);
  const { title, description } = REGIME_TEXT[regime];
  return (
    <Section title={title} description={description} actions={<Button size="sm" variant="secondary" onClick={add}><Plus /> Add class</Button>}>
      <ol className="grid gap-3">
        {mine.map(({ c, i }, pos) => {
          const isNew = !base.taxpayerClasses.some((b) => b.key === c.key);
          return (
            <li key={c.key}>
              <fieldset className={cn("grid gap-4 border bg-surface p-5", c.enabled ? "border-line" : "border-dashed border-line opacity-80")}>
                <legend className="sr-only">{c.label || `Class ${pos + 1}`}</legend>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center border border-line text-xs font-medium text-muted" aria-label={`Checked ${pos + 1} of ${mine.length}`}>{pos + 1}</span>
                  <span className="min-w-0 flex-1 font-medium">{c.label || "New class"} <span className="text-sm font-normal text-muted">· {describeRate(c)}</span></span>
                  {!c.enabled ? <StatusBadge tone="neutral">Off</StatusBadge> : null}
                  <Button size="sm" variant="ghost" disabled={pos === 0} onClick={() => move(pos, -1)} aria-label={`Move ${c.label || "class"} up`}><ArrowUp /></Button>
                  <Button size="sm" variant="ghost" disabled={pos === mine.length - 1} onClick={() => move(pos, 1)} aria-label={`Move ${c.label || "class"} down`}><ArrowDown /></Button>
                  {isNew ? <Button size="sm" variant="ghost" onClick={() => onClasses(all.filter((_, j) => j !== i))}><Trash2 /> Remove</Button> : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField label="Name" value={c.label} onChange={(e) => update(i, { label: e.target.value })} />
                  {regime === "INDIVIDUAL" ? (
                    <>
                      <SelectField label="Citizenship" value={c.citizenship} onChange={(e) => update(i, { citizenship: e.target.value as TaxpayerClass["citizenship"] })}>
                        {(Object.keys(CITIZENSHIP_LABEL) as TaxpayerClass["citizenship"][]).map((k) => <option key={k} value={k}>{CITIZENSHIP_LABEL[k]}</option>)}
                      </SelectField>
                      <SelectField label="Residency recorded by GMCA" value={c.residency} onChange={(e) => update(i, { residency: e.target.value as TaxpayerClass["residency"] })}>
                        {(Object.keys(RESIDENCY_LABEL) as TaxpayerClass["residency"][]).map((k) => <option key={k} value={k}>{RESIDENCY_LABEL[k]}</option>)}
                      </SelectField>
                    </>
                  ) : (
                    <SelectField label="Entity type" value={c.entityType} onChange={(e) => update(i, { entityType: e.target.value as TaxpayerClass["entityType"] })}>
                      {(Object.keys(ENTITY_LABEL) as TaxpayerClass["entityType"][]).map((k) => <option key={k} value={k}>{ENTITY_LABEL[k]}</option>)}
                    </SelectField>
                  )}
                  <SelectField label="Rate" value={c.rateBasis} onChange={(e) => update(i, e.target.value === "FLAT" ? { rateBasis: "FLAT", flatRatePct: c.flatRatePct ?? 0 } : { rateBasis: "INDIVIDUAL_BANDS", flatRatePct: null })}>
                    <option value="INDIVIDUAL_BANDS">Income Tax Act bands</option>
                    <option value="FLAT">Flat rate</option>
                  </SelectField>
                  {c.rateBasis === "FLAT" ? <PercentField label="Flat rate %" value={c.flatRatePct} onValue={(v) => update(i, { flatRatePct: v })} hint={regime === "INDIVIDUAL" ? "Also used for monthly TDS for this class." : undefined} /> : null}
                  <TextField
                    label="Last income year covered"
                    type="number"
                    value={c.lastIncomeYear === null ? "" : String(c.lastIncomeYear)}
                    placeholder="No end year"
                    hint="For a sunset clause. Later years fall through to the next class."
                    onChange={(e) => update(i, { lastIncomeYear: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                  {regime === "INDIVIDUAL" ? (
                    <SelectField label="Income charged" value={c.incomeScope} onChange={(e) => update(i, { incomeScope: e.target.value as TaxpayerClass["incomeScope"] })} hint="GMC-source only leaves out income items marked foreign-source.">
                      <option value="WORLDWIDE">Worldwide income</option>
                      <option value="GMC_SOURCE">GMC-source income only</option>
                    </SelectField>
                  ) : null}
                </div>
                <TextArea label="Description" rows={2} value={c.description} onChange={(e) => update(i, { description: e.target.value })} />
                <Checkbox checked={c.enabled} onChange={(v) => update(i, { enabled: v })}>In use</Checkbox>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-3 border border-line bg-sunk p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm font-medium">Who gets which class</p>
          <TextField label="Income year" type="number" className="w-32" value={String(previewYear)} onChange={(e) => setPreviewYear(Number(e.target.value) || draft.effectiveFromYear)} />
        </div>
        <table className="w-full text-sm">
          <caption className="sr-only">Class each kind of taxpayer resolves to in {previewYear}</caption>
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">Taxpayer</th>
              <th scope="col" className="py-2 pr-3 font-medium">Class</th>
              <th scope="col" className="py-2 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {PROFILES.filter((p) => p.regime === regime).map((p) => {
              const hit = findTaxpayerClass(draft, p, previewYear);
              return (
                <tr key={profileLabel(p)} className="border-b border-line-soft">
                  <td className="py-2 pr-3">{profileLabel(p)}</td>
                  <td className="py-2 pr-3">{hit ? hit.label || "New class" : <StatusBadge tone="rejected">No class: can't publish</StatusBadge>}</td>
                  <td className="py-2">{hit ? describeRate(hit) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------- Tax item catalogue ----------

const KINDS: TaxItemKind[] = ["INCOME", "EXPENSE", "ASSET", "LIABILITY"];
const KEY_PREFIX: Record<TaxItemKind, string> = { INCOME: "INC", EXPENSE: "EXP", ASSET: "AST", LIABILITY: "LIA" };
const APPLIES_LABEL: Record<TaxItem["appliesTo"], string> = { INDIVIDUAL: "Individuals", CORPORATE: "Businesses", BOTH: "Individuals and businesses" };
const ORIGIN_LABEL: Record<NonNullable<TaxItem["origin"]>, string> = { GMC: "GMC source", FOREIGN: "Foreign source", EITHER: "Either" };

function ItemCatalogue({ draft, base, onItems }: { draft: TaxRuleSet; base: TaxRuleSet; onItems: (i: TaxItem[]) => void }) {
  const [kind, setKind] = useState<TaxItemKind>("INCOME");
  const all = draft.taxItems;
  const update = (i: number, patch: Partial<TaxItem>) => onItems(all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => {
    const treatment = treatmentsFor(kind)[0]!.value;
    onItems([
      ...all,
      { key: uniqueKey(KEY_PREFIX[kind], all.map((x) => x.key)), label: "", description: "", kind, appliesTo: kind === "INCOME" ? "INDIVIDUAL" : "CORPORATE", treatment, ratePct: null, allowanceMethod: treatment === "CAPITAL_ALLOWANCE" ? "STRAIGHT_LINE" : null, origin: kind === "INCOME" ? "EITHER" : null, evidenceExamples: [], enabled: true }
    ]);
  };
  const shown = all.map((item, i) => ({ item, i })).filter((x) => x.item.kind === kind);
  return (
    <Section title="Tax item catalogue" description={KIND_LABEL[kind].description} actions={<Button size="sm" variant="secondary" onClick={add}><Plus /> Add {KIND_LABEL[kind].singular}</Button>}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Item type">
        {KINDS.map((k) => (
          <Button key={k} size="sm" variant={k === kind ? "primary" : "secondary"} aria-pressed={k === kind} onClick={() => setKind(k)}>
            {KIND_LABEL[k].plural} <span className="opacity-70">{all.filter((x) => x.kind === k).length}</span>
          </Button>
        ))}
      </div>
      <ul className="grid gap-2">
        {shown.map(({ item, i }) => (
          <ItemRow key={item.key} item={item} isNew={!base.taxItems.some((b) => b.key === item.key)} onChange={(p) => update(i, p)} onRemove={() => onItems(all.filter((_, j) => j !== i))} />
        ))}
      </ul>
    </Section>
  );
}

function ItemRow({ item, isNew, onChange, onRemove }: { item: TaxItem; isNew: boolean; onChange: (p: Partial<TaxItem>) => void; onRemove: () => void }) {
  const meta = treatmentMeta(item.treatment);
  const setTreatment = (t: TaxTreatment) => onChange({ treatment: t, ratePct: null, allowanceMethod: t === "CAPITAL_ALLOWANCE" ? item.allowanceMethod ?? "STRAIGHT_LINE" : null });
  return (
    <li>
      <details className={cn("group border bg-surface", item.enabled ? "border-line" : "border-dashed border-line opacity-80")} {...(isNew ? { open: true } : {})}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
          <span className="min-w-0 flex-1 font-medium">{item.label || "New item"}</span>
          <span className="text-sm text-fg-2">{describeItemTreatment(item)}</span>
          {item.kind === "INCOME" ? <StatusBadge tone="neutral">{APPLIES_LABEL[item.appliesTo]}</StatusBadge> : null}
          {!item.enabled ? <StatusBadge tone="neutral">Off</StatusBadge> : null}
        </summary>
        <div className="grid gap-4 border-t border-line px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Name" value={item.label} onChange={(e) => onChange({ label: e.target.value })} hint={`Code ${item.key}`} />
            {item.kind === "INCOME" ? (
              <SelectField label="Applies to" value={item.appliesTo} onChange={(e) => onChange({ appliesTo: e.target.value as TaxItem["appliesTo"] })}>
                {(Object.keys(APPLIES_LABEL) as TaxItem["appliesTo"][]).map((k) => <option key={k} value={k}>{APPLIES_LABEL[k]}</option>)}
              </SelectField>
            ) : null}
            <SelectField label="Tax treatment" value={item.treatment} onChange={(e) => setTreatment(e.target.value as TaxTreatment)}>
              {treatmentsFor(item.kind).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </SelectField>
            {meta.rate ? <PercentField label={meta.rate.label} value={item.ratePct} onValue={(v) => onChange({ ratePct: v })} hint={meta.rate.hint} placeholder={meta.rate.required ? undefined : "No limit"} /> : null}
            {item.treatment === "CAPITAL_ALLOWANCE" ? (
              <SelectField label="Allowance method" value={item.allowanceMethod ?? "STRAIGHT_LINE"} onChange={(e) => onChange({ allowanceMethod: e.target.value as TaxItem["allowanceMethod"] })}>
                <option value="STRAIGHT_LINE">Straight line</option>
                <option value="REDUCING_BALANCE">Reducing balance</option>
              </SelectField>
            ) : null}
            {item.kind === "INCOME" ? (
              <SelectField label="Where it arises" value={item.origin ?? "EITHER"} onChange={(e) => onChange({ origin: e.target.value as TaxItem["origin"] })} hint="Foreign-source items are left out for classes charged on GMC-source income only.">
                {(Object.keys(ORIGIN_LABEL) as NonNullable<TaxItem["origin"]>[]).map((k) => <option key={k} value={k}>{ORIGIN_LABEL[k]}</option>)}
              </SelectField>
            ) : null}
          </div>
          <p className="border-l-2 border-line pl-3 text-sm text-fg-2">
            {meta.help} <span className="text-muted">{DIFFERENCE_LABEL[meta.difference]}.</span>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextArea label="Description" rows={2} value={item.description} onChange={(e) => onChange({ description: e.target.value })} />
            <TextArea label="Evidence examples (one per line)" rows={2} value={item.evidenceExamples.join("\n")} onChange={(e) => onChange({ evidenceExamples: e.target.value.split("\n") })} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox checked={item.enabled} onChange={(v) => onChange({ enabled: v })}>
              {item.kind === "INCOME" ? "Available to choose" : "In use"}
            </Checkbox>
            {isNew ? <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 /> Remove</Button> : null}
          </div>
        </div>
      </details>
    </li>
  );
}
