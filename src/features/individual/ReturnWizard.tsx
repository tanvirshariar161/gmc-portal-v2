import { ArrowLeft, ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, navigate, useActor, useDb, useDocumentTitle, useRun } from "../../app/core";
import type { Db, IncomeSource, IndividualTaxReturn, ReliefClaim } from "../../domain/types";
import { formatDate, formatDateTime, maskId } from "../../lib/format";
import { formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { ruleSetForYear } from "../../services/calc";
import { nowIso } from "../../services/clock";
import { convert, conversionDateFor } from "../../services/currency";
import { ensureDraftReturn, saveDraft, submitReturn, validateReturn } from "../../services/individual";
import { Button } from "../../shared/gmc/Button";
import { Checkbox, RadioGroup, SelectField, TextArea, TextField } from "../../shared/gmc/Form";
import { Alert } from "../../shared/gmc/Layout";
import { Stepper } from "../../shared/gmc/Stepper";
import { DataTable } from "../../shared/gmc/Table";
import { Forbidden } from "../shared/TaxpayerShared";
import { CalcBreakdown, ConversionView, CurrencySelect, DemoTag, KeyValue, PageHeader, RecordUpload, Section } from "../shared/ui";
import { FiledDeclarations } from "./IndividualPages";

const STEPS = [
  { key: "personal", label: "Personal information" },
  { key: "employment", label: "Employment income" },
  { key: "income", label: "Additional income" },
  { key: "reliefs", label: "Reliefs" },
  { key: "calculation", label: "Calculation" },
  { key: "review", label: "Review and declare" }
] as const;
type StepKey = (typeof STEPS)[number]["key"];

/** Opens (or creates) the draft for the year, then hands over to the editor. */
export function ReturnWizardEntry({ year }: { year: number }) {
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const existing = db.individualReturns.find((r) => r.taxpayerId === actor.taxpayerId && r.year === year);
  const submittedId = existing?.submissionStatus === "SUBMITTED" ? existing.id : null;
  useEffect(() => {
    if (!existing && year <= db.config.currentFilingYear) run((d, a) => ensureDraftReturn(d, a, year));
    if (submittedId) navigate(`/returns/${submittedId}`, { replace: true });
  }, [existing, run, year, submittedId, db.config.currentFilingYear]);
  if (!Number.isInteger(year) || year < 2025 || year > db.config.currentFilingYear) return <Forbidden message={`Returns for ${year} can't be filed here.`} />;
  if (!existing) return <p className="text-muted">Preparing your return…</p>;
  if (submittedId) return null;
  return <ReturnWizard ret={existing} />;
}

function ReturnWizard({ ret }: { ret: IndividualTaxReturn }) {
  useDocumentTitle(`${ret.year} return`);
  const db = useDb();
  const run = useRun();
  const taxpayer = db.taxpayers.find((t) => t.id === ret.taxpayerId)!;
  const rules = ruleSetForYear(db.ruleSets, ret.year);
  const [step, setStep] = useState<StepKey>("personal");
  const [sources, setSources] = useState<IncomeSource[]>(ret.incomeSources);
  const [reliefs, setReliefs] = useState<ReliefClaim[]>(ret.reliefs);
  const [declared, setDeclared] = useState(ret.declarationAccepted);
  const [confirming, setConfirming] = useState(false);
  const owner = { kind: "INDIVIDUAL" as const, id: ret.taxpayerId };
  const dirty = JSON.stringify(sources) !== JSON.stringify(ret.incomeSources) || JSON.stringify(reliefs) !== JSON.stringify(ret.reliefs) || declared !== ret.declarationAccepted;
  const issues = useMemo(() => validateReturn(db, ret), [db, ret]);

  const save = (patch?: { incomeSources?: IncomeSource[]; reliefs?: ReliefClaim[] }, message?: string) => run((d, a) => saveDraft(d, a, ret.id, { incomeSources: patch?.incomeSources ?? sources, reliefs: patch?.reliefs ?? reliefs, declarationAccepted: declared }), message);
  const go = (key: StepKey) => {
    if (dirty) save();
    setConfirming(false);
    setStep(key);
    window.scrollTo({ top: 0 });
  };
  const index = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      <PageHeader
        title={`Individual Income Tax Return ${ret.year}`}
        lead={<>Draft · last saved {formatDateTime(ret.lastSavedAt)}. Your progress is kept on every step.</>}
        back={{ to: "/returns", label: "Tax returns" }}
        actions={
          <Button variant="secondary" onClick={() => save(undefined, "Draft saved")}>
            <Save /> Save draft
          </Button>
        }
      />
      <Stepper steps={[...STEPS]} current={step} onSelect={(k) => go(k as StepKey)} />

      {step === "personal" ? (
        <Section title="Personal information" description="From your verified record. To change it, send a correction request from My profile.">
          <div className="panel p-5">
            <KeyValue
              rows={[
                { label: "Name", value: taxpayer.fullName },
                { label: "TIN", value: taxpayer.tin },
                { label: taxpayer.identifierType === "CID" ? "Citizenship ID" : taxpayer.identifierType === "WORK_PERMIT" ? "Work permit" : "Passport", value: maskId(taxpayer.identifierValue) },
                { label: "Nationality", value: taxpayer.nationality },
                { label: "Tax residency", value: taxpayer.residencyStatus === "NOT_DETERMINED" ? "Not yet determined by GMCA" : taxpayer.residencyStatus === "RESIDENT" ? "Resident" : "Non-resident (recorded by GMCA)" },
                { label: "Verified through", value: <span className="flex items-center gap-2">{taxpayer.verification.provider === "NDI" ? "NDI" : "Immigration System"} <DemoTag>Simulated</DemoTag></span> },
                ...(taxpayer.employmentSummary ? [{ label: "Employment (Immigration record)", value: `${taxpayer.employmentSummary.position}, ${taxpayer.employmentSummary.employer}` }] : [])
              ]}
            />
          </div>
          <Link to="/profile" className="w-fit text-sm text-brand-ink underline underline-offset-4">
            Request a correction
          </Link>
        </Section>
      ) : null}

      {step === "employment" ? <EmploymentStep db={db} ret={ret} onRefresh={() => run((d, a) => saveDraft(d, a, ret.id, { refreshEmployment: true }), "Employer figures refreshed")} /> : null}

      {step === "income" ? (
        <IncomeStep
          db={db}
          ret={ret}
          sources={sources}
          setSources={setSources}
          onDocsChanged={(next) => {
            setSources(next);
            save({ incomeSources: next });
          }}
          owner={owner}
        />
      ) : null}

      {step === "reliefs" ? (
        <ReliefStep
          db={db}
          ret={ret}
          reliefs={reliefs}
          setReliefs={setReliefs}
          onDocsChanged={(next) => {
            setReliefs(next);
            save({ reliefs: next });
          }}
          owner={owner}
        />
      ) : null}

      {step === "calculation" ? (
        <Section title="Tax calculation" description="Worked out from your declarations by the shared calculation engine. This is an estimate until GMCA assesses your return.">
          {dirty ? <Alert tone="review">You have unsaved changes. Save to refresh the calculation.</Alert> : null}
          <CalcBreakdown snapshot={ret.calculation} />
          <p className="text-sm text-muted">
            Rule set {rules.version}. Tax bands, relief limits and the non-resident rate are demo configuration set by a GMCA administrator, not confirmed GMCA rules. Carry-forward of excess TDS is {rules.excessCreditCarryForward === null ? "not configured" : rules.excessCreditCarryForward ? "configured" : "not allowed"}.
          </p>
        </Section>
      ) : null}

      {step === "review" ? (
        <div className="grid gap-8">
          {issues.filter((i) => i.step !== "review").length ? (
            <Alert tone="action" title="Before you can submit">
              <ul className="grid gap-1">
                {issues
                  .filter((i) => i.step !== "review")
                  .map((i) => (
                    <li key={i.message}>
                      <button type="button" className="text-left underline underline-offset-4" onClick={() => go(i.step as StepKey)}>
                        {i.message}
                      </button>
                    </li>
                  ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="approved" title="Everything required is in place" />
          )}
          <FiledDeclarations db={db} ret={ret} />
          <CalcBreakdown snapshot={ret.calculation} />
          <Section title="Declaration">
            <div className="panel grid gap-4 p-5">
              <Checkbox
                checked={declared}
                onChange={(v) => {
                  setDeclared(v);
                  run((d, a) => saveDraft(d, a, ret.id, { incomeSources: sources, reliefs, declarationAccepted: v }));
                }}
              >
                I declare that the information in this return is true, correct and complete to the best of my knowledge.
              </Checkbox>
              {!confirming ? (
                <div>
                  <Button disabled={issues.length > 0 || dirty} onClick={() => setConfirming(true)}>
                    Submit return
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 border border-act-line bg-act-bg p-4">
                  <p className="text-sm text-act-fg">
                    <strong>Submit your {ret.year} return?</strong> Once submitted it is locked and goes to GMCA for assessment. An amendment process is not yet defined.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => {
                        const done = run((d, a) => submitReturn(d, a, ret.id), "Return submitted");
                        if (done) navigate(`/returns/${ret.id}?submitted=1`);
                      }}
                    >
                      Yes, submit
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirming(false)}>
                      Not yet
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-6">
        {index > 0 ? (
          <Button variant="secondary" onClick={() => go(STEPS[index - 1]!.key)}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <span />
        )}
        {index < STEPS.length - 1 ? (
          <Button onClick={() => go(STEPS[index + 1]!.key)}>
            Save and continue <ArrowRight />
          </Button>
        ) : null}
      </div>
    </>
  );
}

function EmploymentStep({ db, ret, onRefresh }: { db: Db; ret: IndividualTaxReturn; onRefresh: () => void }) {
  return (
    <Section
      title="Employment income"
      description="Your employers report your pay and the TDS they deducted every month. These figures are used as they are, so don't add them again as additional income."
      actions={
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          Refresh from employer declarations
        </Button>
      }
    >
      <DataTable
        caption="Employment income from employers"
        rows={ret.employment}
        rowKey={(e) => e.employerName}
        empty="No employer has declared income for you this year. If you were employed, ask your employer to file its monthly declaration."
        columns={[
          { key: "e", header: "Employer", cell: (e) => e.employerName },
          { key: "m", header: "Months reported", align: "right", cell: (e) => e.months },
          { key: "g", header: "Gross remuneration", align: "right", cell: (e) => formatMoney(e.grossMinor, e.currency) },
          { key: "t", header: "TDS deducted", align: "right", cell: (e) => formatMoney(e.tdsMinor, e.currency) }
        ]}
        foot={["Total", "", formatMoney(ret.employment.reduce((s, e) => s + e.grossMinor, 0)), formatMoney(ret.employment.reduce((s, e) => s + e.tdsMinor, 0))]}
      />
      <p className="text-sm text-muted">Amounts are in the reporting currency ({db.config.reportingCurrency}), converted by your employer's declaration at demo rates. Think a figure is wrong? Ask your employer to correct its declaration; the correction process is still to be confirmed.</p>
    </Section>
  );
}

function blankSource(ret: IndividualTaxReturn, db: Db): IncomeSource {
  const cat = ruleSetForYear(db.ruleSets, ret.year).incomeCategories[0]!;
  return { id: `${ret.id}-src-${Date.now().toString(36)}`, category: cat.key, description: "", payer: "", amountMinor: 0, currency: db.config.reportingCurrency, periodFrom: `${ret.year}-01-01`, periodTo: `${ret.year}-12-31`, classification: cat.defaultClassification, supportingDocIds: [] };
}

function IncomeStep({ db, ret, sources, setSources, onDocsChanged, owner }: { db: Db; ret: IndividualTaxReturn; sources: IncomeSource[]; setSources: (s: IncomeSource[]) => void; onDocsChanged: (s: IncomeSource[]) => void; owner: { kind: "INDIVIDUAL"; id: string } }) {
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

function ReliefStep({ db, ret, reliefs, setReliefs, onDocsChanged, owner }: { db: Db; ret: IndividualTaxReturn; reliefs: ReliefClaim[]; setReliefs: (r: ReliefClaim[]) => void; onDocsChanged: (r: ReliefClaim[]) => void; owner: { kind: "INDIVIDUAL"; id: string } }) {
  const rules = ruleSetForYear(db.ruleSets, ret.year);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(reliefs.map((r) => [r.id, minorToInput(r.declaredMinor || null)])));
  return (
    <Section title="Tax reliefs and deductions" description="Claim only what applies to you and attach evidence. GMCA reviews the evidence; uploading a document doesn't approve the relief.">
      <div className="grid gap-4">
        {rules.reliefs
          .filter((r) => r.enabled)
          .map((rule) => {
            const claim = reliefs.find((c) => c.reliefKey === rule.key);
            return (
              <div key={rule.key} className={cn("grid gap-4 border p-5", claim ? "border-brand-200 bg-surface" : "border-line bg-surface")}>
                <Checkbox
                  checked={!!claim}
                  hint={`${rule.description} ${rule.capMinor !== null ? `Demo limit ${formatMoney(rule.capMinor)}.` : ""} Evidence, for example: ${rule.evidenceExamples.join(", ")}.`}
                  onChange={(on) => {
                    if (on) {
                      const id = `${ret.id}-rel-${rule.key.toLowerCase()}`;
                      setAmounts({ ...amounts, [id]: "" });
                      setReliefs([...reliefs, { id, reliefKey: rule.key, declaredMinor: 0, note: "", docIds: [] }]);
                    } else onDocsChanged(reliefs.filter((c) => c.reliefKey !== rule.key));
                  }}
                >
                  <span className="font-medium">{rule.label}</span>
                </Checkbox>
                {claim ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label={`Amount claimed (${db.config.reportingCurrency})`}
                      inputMode="decimal"
                      required
                      value={amounts[claim.id] ?? ""}
                      error={amounts[claim.id] && parseAmountInput(amounts[claim.id]!) === null ? "Enter an amount like 1500.00" : undefined}
                      onChange={(e) => {
                        setAmounts({ ...amounts, [claim.id]: e.target.value });
                        setReliefs(reliefs.map((c) => (c.id === claim.id ? { ...c, declaredMinor: parseAmountInput(e.target.value) ?? 0 } : c)));
                      }}
                    />
                    <TextArea label="Note for GMCA (optional)" rows={2} value={claim.note} onChange={(e) => setReliefs(reliefs.map((c) => (c.id === claim.id ? { ...c, note: e.target.value } : c)))} />
                    <div className="sm:col-span-2">
                      <RecordUpload db={db} label="Evidence" required category="RELIEF_EVIDENCE" owner={owner} related={{ kind: "INDIVIDUAL_RETURN", id: ret.id, reliefId: claim.id }} docIds={claim.docIds} multiple onChange={(ids) => onDocsChanged(reliefs.map((c) => (c.id === claim.id ? { ...c, docIds: ids } : c)))} />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>
      <p className="text-sm text-muted">Relief categories, limits and evidence requirements are demo configuration pending GMCA confirmation.</p>
    </Section>
  );
}
