import { AlertTriangle, ArrowLeft, ArrowRight, CalendarCheck2, Landmark, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, navigate, useActor, useDb, useDocumentTitle, useRun } from "../../app/core";
import type { Db, IncomeSource, IndividualTaxReturn, ReliefClaim, CalculationSnapshot, TaxRuleSet } from "../../domain/types";
import { formatDate, formatPeriod, maskId } from "../../lib/format";
import { formatAmount, formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { bandBreakdown, bracketFor, ruleSetForYear } from "../../services/calc";
import { classForTaxpayer } from "../../services/classification";
import { ensureDraftReturn, payAndSubmit, previewCalculation, saveDraft, selfAssessmentFor, submitReturn, validateReturn } from "../../services/individual";
import { Button } from "../../shared/gmc/Button";
import { Checkbox, TextArea, TextField } from "../../shared/gmc/Form";
import { Alert, DataList, Money, PageIntro, StatusBadge } from "../../shared/gmc/Layout";
import { SalaryBreakdown } from "../../shared/gmc/SalaryBreakdown";
import { Stepper } from "../../shared/gmc/Stepper";
import { Forbidden } from "../shared/TaxpayerShared";
import { DemoTag, RecordUpload } from "../shared/ui";
import { AdditionalIncome } from "./AdditionalIncome";

/** Version 1's filing flow and presentation, on version 2's data model and services. */
type StepKey = "about" | "income" | "reliefs" | "tax" | "review";

function stepsFor(year: number): { key: StepKey; label: string; title: string; lead: string }[] {
  return [
    { key: "about", label: "About you", title: "About you", lead: "Your identity comes from a verified record. Check it before you continue." },
    { key: "income", label: "Income", title: "Your income", lead: `Your employer's figures are filled in. Add anything else you earned in ${year}.` },
    { key: "reliefs", label: "Reliefs", title: "Reliefs", lead: "Reliefs reduce the income you're taxed on. Claim the ones you're due and attach evidence." },
    { key: "tax", label: "Your tax", title: "Your tax", lead: "This is exactly how your tax is worked out, band by band." },
    { key: "review", label: "Review", title: "Check, pay and submit", lead: "Check each section and declare. If you have tax to pay, you pay it first; your return then goes to GMCA." }
  ];
}

export function ReturnWizardEntry({ year, step }: { year: number; step?: string }) {
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const existing = db.individualReturns.find((r) => r.taxpayerId === actor.taxpayerId && r.year === year);
  const ok = Number.isInteger(year) && year >= 2025 && year <= db.config.currentFilingYear;
  const submittedId = existing?.submissionStatus === "SUBMITTED" ? existing.id : null;
  useEffect(() => {
    if (ok && !existing) run((d, a) => ensureDraftReturn(d, a, year));
    if (submittedId) navigate(`/returns/${submittedId}`, { replace: true });
  }, [ok, existing, run, year, submittedId]);
  if (!ok) return <Forbidden message={`Returns for ${year} can't be filed here.`} />;
  if (!existing || submittedId) return <p className="text-muted">Preparing your return…</p>;
  return <ReturnWizard key={existing.id} db={db} ret={existing} stepKey={(step as StepKey) || "about"} />;
}

function FilingYearBanner({ db, year }: { db: Db; year: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-brand-200 bg-brand-50 px-5 py-3" role="note" aria-label="Year being filed">
      <span className="flex items-center gap-3">
        <CalendarCheck2 className="size-5 text-brand-ink" aria-hidden="true" />
        <span className="font-serif text-xl leading-tight text-fg">Filing for YA {year + 1}</span>
      </span>
      <span className="text-sm text-fg-2">
        Income earned 1 January – 31 December {year} · due {formatDate(`${year + 1}-${db.config.filingDeadlineMonthDay}`)}
      </span>
    </div>
  );
}

function resultLabel(balance: number) {
  return balance > 0 ? "To pay" : balance < 0 ? "Credit" : "Nothing to pay";
}

function ReturnWizard({ db, ret, stepKey }: { db: Db; ret: IndividualTaxReturn; stepKey: StepKey }) {
  useDocumentTitle(`YA ${ret.year + 1} return`);
  const run = useRun();
  const steps = stepsFor(ret.year);
  const step = steps.find((s) => s.key === stepKey) ?? steps[0]!;
  const index = steps.indexOf(step);
  const [sources, setSources] = useState<IncomeSource[]>(ret.incomeSources);
  const [reliefs, setReliefs] = useState<ReliefClaim[]>(ret.reliefs);
  const [declared, setDeclared] = useState(ret.declarationAccepted);
  const [showIssues, setShowIssues] = useState(false);
  const owner = { kind: "INDIVIDUAL" as const, id: ret.taxpayerId };

  const prepay = selfAssessmentFor(db, ret.id);
  const pending = prepay ? db.payments.find((p) => p.liabilityId === prepay.id && p.status === "PENDING") : undefined;
  const preview = useMemo(() => previewCalculation(db, ret, sources, reliefs), [db, ret, sources, reliefs]);
  const issues = useMemo(() => validateReturn(db, { ...ret, incomeSources: preview.sources, reliefs, declarationAccepted: declared }), [db, ret, preview.sources, reliefs, declared]);
  const stepIssues = issues.filter((i) => i.step === step.key);
  const strip = (xs: IncomeSource[]) => JSON.stringify(xs.map(({ conversion: _c, ...rest }) => rest));
  const dirty = strip(sources) !== strip(ret.incomeSources) || JSON.stringify(reliefs) !== JSON.stringify(ret.reliefs) || declared !== ret.declarationAccepted;

  const save = (patch?: { incomeSources?: IncomeSource[]; reliefs?: ReliefClaim[] }) =>
    pending ? undefined : run((d, a) => saveDraft(d, a, ret.id, { incomeSources: patch?.incomeSources ?? sources, reliefs: patch?.reliefs ?? reliefs, declarationAccepted: declared }));

  // Autosave shortly after typing stops, as in version 1.
  const timer = useRef<number>();
  useEffect(() => {
    if (!dirty || pending) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(), 800);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, reliefs, declared]);

  useEffect(() => setShowIssues(false), [stepKey]);

  const go = (key: StepKey) => {
    if (dirty) save();
    navigate(`/returns/file/${ret.year}/${key}`);
  };
  const next = () => {
    if (stepIssues.length) {
      setShowIssues(true);
      window.setTimeout(() => document.getElementById("step-issues")?.focus(), 0);
      return;
    }
    go(steps[index + 1]!.key);
  };
  const withPanel = step.key === "about" || step.key === "income" || step.key === "reliefs";
  const rules = preview.rules;

  return (
    <div className="grid gap-10">
      <FilingYearBanner db={db} year={ret.year} />
      <Stepper steps={steps} current={step.key} onSelect={(k) => go(k as StepKey)} />
      {pending ? (
        <Alert tone="review" title="Your payment is pending with DK Bank" action={<Button size="sm" variant="secondary" onClick={() => navigate(`/payments/receipt/${pending.id}`)}>Check status</Button>}>
          The return is locked until the bank confirms. It is submitted automatically once the payment goes through.
        </Alert>
      ) : null}
      <div className={cn("grid gap-10", withPanel && "lg:grid-cols-[minmax(0,1fr)_19rem]")}>
        <div className="grid min-w-0 content-start gap-8">
          <PageIntro size="md" eyebrow={`Step ${index + 1} · YA ${ret.year + 1} return`} title={step.title} lead={step.lead} />
          <div aria-hidden="true" className="h-px bg-line-soft" />
          {showIssues && stepIssues.length ? (
            <div id="step-issues" tabIndex={-1}>
              <Alert tone="rejected" title="Fix these before you continue">
                <ul className="list-disc pl-5">
                  {stepIssues.map((i) => (
                    <li key={i.message}>{i.message}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          ) : null}

          {step.key === "about" ? <AboutStep db={db} ret={ret} /> : null}
          {step.key === "income" ? (
            <div className="grid gap-10">
              <EmploymentSection db={db} ret={ret} rules={rules} onRefresh={() => run((d, a) => saveDraft(d, a, ret.id, { refreshEmployment: true }), "Employer figures refreshed")} />
              <AdditionalIncome
                db={db}
                ret={ret}
                sources={sources}
                setSources={setSources}
                onDocsChanged={(nextSources) => {
                  setSources(nextSources);
                  save({ incomeSources: nextSources });
                }}
                owner={owner}
              />
            </div>
          ) : null}
          {step.key === "reliefs" ? (
            <ReliefsStep
              db={db}
              ret={ret}
              rules={rules}
              snapshot={preview.snapshot}
              reliefs={reliefs}
              setReliefs={setReliefs}
              onDocsChanged={(nextReliefs) => {
                setReliefs(nextReliefs);
                save({ reliefs: nextReliefs });
              }}
              owner={owner}
            />
          ) : null}
          {step.key === "tax" ? <TaxStep db={db} ret={ret} rules={rules} snapshot={preview.snapshot} /> : null}
          {step.key === "review" ? (
            <ReviewStep
              db={db}
              ret={ret}
              rules={rules}
              snapshot={preview.snapshot}
              sources={preview.sources}
              reliefs={reliefs}
              issues={issues}
              steps={steps}
              declared={declared}
              setDeclared={setDeclared}
              locked={!!pending}
              onEdit={go}
              onSubmit={() => {
                const balance = preview.snapshot.balanceMinor;
                if (db.config.payBeforeSubmit && balance > 0) {
                  const p = run((d, a) => {
                    saveDraft(d, a, ret.id, { incomeSources: sources, reliefs, declarationAccepted: declared });
                    return payAndSubmit(d, a, ret.id);
                  });
                  if (p) navigate(`/bank/${p.id}`);
                  return;
                }
                const done = run((d, a) => {
                  saveDraft(d, a, ret.id, { incomeSources: sources, reliefs, declarationAccepted: declared });
                  return submitReturn(d, a, ret.id);
                }, "Return submitted");
                if (done) navigate(`/returns/${ret.id}?submitted=1`);
              }}
            />
          ) : null}

          {step.key !== "review" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-6">
              <Button variant="secondary" onClick={() => (index > 0 ? go(steps[index - 1]!.key) : navigate("/returns"))}>
                <ArrowLeft /> Back
              </Button>
              <span className="text-xs text-muted" aria-live="polite">
                {dirty ? "Saving…" : `Saved ${new Date(ret.lastSavedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
              </span>
              <Button size="lg" onClick={next}>
                Next: {steps[index + 1]!.label} <ArrowRight />
              </Button>
            </div>
          ) : null}
        </div>
        {withPanel ? <LivePanel snapshot={preview.snapshot} /> : null}
      </div>
    </div>
  );
}

/** Estimated tax while filling in: side panel on desktop, sticky bar on phones. */
function LivePanel({ snapshot }: { snapshot: CalculationSnapshot }) {
  const f = snapshot.figures!;
  const tone = snapshot.balanceMinor > 0 ? "text-act-fg" : snapshot.balanceMinor < 0 ? "text-ok-fg" : "text-fg";
  return (
    <>
      <aside aria-label="Estimated tax" className="sticky top-6 hidden h-max border border-line bg-surface lg:block">
        <div className="border-b border-line-soft px-5 py-3 text-[13px] font-medium uppercase tracking-[0.12em] text-muted">Your estimate</div>
        <dl className="grid gap-3 px-5 py-4 text-sm" aria-live="polite">
          {[
            ["Chargeable income", f.chargeableMinor],
            ["Tax for the year", snapshot.taxMinor],
            ["Already deducted", snapshot.creditsMinor]
          ].map(([label, v]) => (
            <div key={label as string} className="flex justify-between gap-3">
              <dt className="text-fg-2">{label}</dt>
              <dd>
                <Money cents={v as number} />
              </dd>
            </div>
          ))}
          <div className="mt-1 grid gap-1 border-t border-line-soft pt-3">
            <dt className="text-fg-2">{resultLabel(snapshot.balanceMinor)}</dt>
            <dd className={cn("font-serif text-[2rem] leading-none", tone)}>
              <Money cents={Math.abs(snapshot.balanceMinor)} />
            </dd>
          </div>
        </dl>
        {snapshot.warnings.length ? <p className="border-t border-line-soft px-5 py-3 text-xs text-act-fg">{snapshot.warnings[0]}</p> : null}
        <p className="border-t border-line-soft px-5 py-3 text-xs text-muted">An estimate. GMCA assesses every return.</p>
      </aside>
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-line bg-surface px-4 py-3 shadow-pop lg:hidden" aria-live="polite">
        <span className="text-sm text-fg-2">
          Estimate · chargeable <Money cents={f.chargeableMinor} />
        </span>
        <span className={cn("text-right font-medium", tone)}>
          <span className="block text-xs font-normal text-muted">{resultLabel(snapshot.balanceMinor)}</span>
          <Money cents={Math.abs(snapshot.balanceMinor)} />
        </span>
      </div>
    </>
  );
}

/* ---------- About you ---------- */

function AboutStep({ db, ret }: { db: Db; ret: IndividualTaxReturn }) {
  const t = db.taxpayers.find((x) => x.id === ret.taxpayerId)!;
  const source = t.verification.provider === "NDI" ? "NDI" : "Immigration System";
  return (
    <div className="grid gap-8">
      <section className="panel p-6" aria-labelledby="who">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="who" className="font-serif text-xl">
            You
          </h2>
          <span className="flex items-center gap-2">
            <StatusBadge tone="neutral">From {source}</StatusBadge>
            <DemoTag>Simulated</DemoTag>
          </span>
        </div>
        <DataList
          className="mt-2"
          rows={[
            { label: "Name", value: t.fullName },
            { label: "TIN", value: <span className="num">{t.tin}</span> },
            { label: t.identifierType === "CID" ? "CID" : t.identifierType === "WORK_PERMIT" ? "Work permit" : "Passport", value: <span className="num">{maskId(t.identifierValue)}</span> },
            { label: "Date of birth", value: formatDate(t.dateOfBirth) },
            { label: "Nationality", value: t.nationality }
          ]}
        />
      </section>
      <section className="panel p-6" aria-labelledby="residency">
        <h2 id="residency" className="font-serif text-xl">
          Tax residency
        </h2>
        <DataList
          className="mt-2"
          rows={[
            {
              label: "Recorded by GMCA",
              value: t.residencyStatus === "NOT_DETERMINED" ? "Not yet determined" : t.residencyStatus === "RESIDENT" ? "Resident" : "Non-resident",
              hint: "Residency decides whether non-resident treatment applies. Nationality alone does not."
            },
            ...(t.employmentSummary ? [{ label: "Employment (Immigration record)", value: `${t.employmentSummary.position}, ${t.employmentSummary.employer}` }] : [])
          ]}
        />
      </section>
      <section className="panel p-6" aria-labelledby="contact">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="contact" className="font-serif text-xl">
            Contact details
          </h2>
          <Link to="/profile" className="text-sm text-brand-ink underline-offset-4 hover:underline">
            Change in My profile
          </Link>
        </div>
        <DataList className="mt-2" rows={[{ label: "Email", value: t.email }, { label: "Mobile", value: t.phone }, { label: "Address", value: t.address || "—" }]} />
      </section>
      <p className="text-sm text-muted">
        Something wrong with your verified details?{" "}
        <Link to="/profile" className="text-brand-ink underline underline-offset-4">
          Send a correction request
        </Link>
        . You can carry on with your return meanwhile.
      </p>
    </div>
  );
}

/* ---------- Income ---------- */

function EmploymentSection({ db, ret, rules, onRefresh }: { db: Db; ret: IndividualTaxReturn; rules: TaxRuleSet; onRefresh: () => void }) {
  return (
    <section className="grid gap-4" aria-labelledby="employment">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="employment" className="font-serif text-xl">
          Employment income
        </h2>
        <Button variant="link" onClick={onRefresh}>
          Refresh from employer declarations
        </Button>
      </div>
      {ret.employment.length === 0 ? <p className="text-sm text-muted">No employer has declared income for you in {ret.year}. If you were employed in GMC, ask your employer to file its monthly declarations.</p> : null}
      {ret.employment.map((e) => {
        const company = db.companies.find((c) => c.id === e.companyId);
        return (
          <div key={e.employerName} className="panel grid gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="font-medium">{e.employerName}</span>
                <span className="num text-sm text-muted">
                  {company ? `UEN ${company.uen} · ` : ""}
                  {e.months} {e.months === 1 ? "month" : "months"} reported in {ret.year}
                </span>
              </div>
              <StatusBadge tone="neutral">Reported by employer</StatusBadge>
            </div>
            <SalaryBreakdown gross={e.grossMinor} tds={e.tdsMinor} health={e.healthMinor} healthPct={rules.healthRatePct} />
            <p className="text-xs text-muted">
              Think a figure is wrong? Ask your employer to correct its monthly declaration.{" "}
              <Link to="/income" className="text-brand-ink underline underline-offset-4">
                See month by month
              </Link>
            </p>
          </div>
        );
      })}
    </section>
  );
}

/* ---------- Reliefs ---------- */

function ReliefRow({ title, cap, amount, children, status }: { title: string; cap: string; amount?: number; status?: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel grid gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted">{cap}</p>
        </div>
        <div className="flex items-center gap-3">
          {status}
          {amount !== undefined ? <Money cents={amount} className="text-lg font-medium" /> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function ReliefsStep({ db, ret, rules, snapshot, reliefs, setReliefs, onDocsChanged, owner }: { db: Db; ret: IndividualTaxReturn; rules: TaxRuleSet; snapshot: CalculationSnapshot; reliefs: ReliefClaim[]; setReliefs: (r: ReliefClaim[]) => void; onDocsChanged: (r: ReliefClaim[]) => void; owner: { kind: "INDIVIDUAL"; id: string } }) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(reliefs.map((r) => [r.id, minorToInput(r.declaredMinor || null)])));
  const allowed = (id: string) => {
    const line = snapshot.lines.find((l) => l.key === `rel-${id}`);
    return line ? -line.amountMinor : undefined;
  };
  return (
    <div className="grid gap-4">
      {rules.reliefs
        .filter((r) => r.enabled)
        .map((rule) => {
          const claim = reliefs.find((c) => c.reliefKey === rule.key);
          return (
            <ReliefRow
              key={rule.key}
              title={rule.label}
              cap={`${rule.description}${rule.capMinor !== null ? ` Up to ${formatMoney(rule.capMinor)}.` : ""}`}
              amount={claim ? allowed(claim.id) : undefined}
              status={claim ? <StatusBadge tone="review">Claimed, GMCA reviews evidence</StatusBadge> : undefined}
            >
              <Checkbox
                checked={!!claim}
                onChange={(on) => {
                  if (on) {
                    const id = `${ret.id}-rel-${rule.key.toLowerCase()}`;
                    setAmounts({ ...amounts, [id]: "" });
                    setReliefs([...reliefs, { id, reliefKey: rule.key, declaredMinor: 0, note: "", docIds: [] }]);
                  } else onDocsChanged(reliefs.filter((c) => c.reliefKey !== rule.key));
                }}
              >
                Claim {rule.label.toLowerCase()}
              </Checkbox>
              {claim ? (
                <div className="grid gap-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField
                      label={`Amount you're claiming (${db.config.reportingCurrency})`}
                      prefix={db.config.reportingCurrency === "USD" ? "$" : undefined}
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
                  </div>
                  <RecordUpload db={db} label={`Evidence: ${rule.evidenceExamples.join(", ") || "supporting document"}`} required category="RELIEF_EVIDENCE" owner={owner} related={{ kind: "INDIVIDUAL_RETURN", id: ret.id, reliefId: claim.id }} docIds={claim.docIds} multiple onChange={(ids) => onDocsChanged(reliefs.map((c) => (c.id === claim.id ? { ...c, docIds: ids } : c)))} />
                </div>
              ) : null}
            </ReliefRow>
          );
        })}
      <p className="text-xs text-muted">
        Total reliefs <Money cents={snapshot.figures!.reliefsMinor} />. Uploading evidence doesn't approve a relief: GMCA may review it, so keep the originals. Relief categories and limits are demo configuration.
      </p>
    </div>
  );
}

/* ---------- Your tax ---------- */

function TdsWorking({ db, ret, rules }: { db: Db; ret: IndividualTaxReturn; rules: TaxRuleSet }) {
  const taxpayer = db.taxpayers.find((t) => t.id === ret.taxpayerId)!;
  const ids = new Set(db.employees.filter((e) => e.taxpayerId === ret.taxpayerId).map((e) => e.id));
  const months = db.monthlyDeclarations
    .filter((d) => d.submissionStatus === "SUBMITTED" && d.period.startsWith(`${ret.year}-`))
    .flatMap((d) => d.lines.filter((l) => ids.has(l.employeeId)).map((l) => ({ period: d.period, gross: l.conversion?.reportingMinor ?? 0, tds: l.tdsMinor })));
  const total = months.reduce((s, m) => s + m.tds, 0);
  const pay = months.reduce((s, m) => s + m.gross, 0);
  const cls = classForTaxpayer(rules, taxpayer, ret.year);
  const rows = rules.tdsBands.map((b) => {
    const inBracket = months.filter((m) => bracketFor(m.gross, rules.tdsBands) === b);
    return { b, pay: inBracket.reduce((s, m) => s + m.gross, 0), tds: inBracket.reduce((s, m) => s + m.tds, 0), count: inBracket.length };
  });
  const whole = (m: number) => `$${Math.round(m / 100).toLocaleString("en-US")}`;
  return (
    <section className="grid gap-4" aria-labelledby="tds-h">
      <h2 id="tds-h" className="font-serif text-xl">
        Tax your employer deducted (TDS)
      </h2>
      {months.length === 0 ? (
        <p className="text-sm text-muted">No employer has declared TDS for you in {ret.year}.</p>
      ) : cls.rateBasis === "FLAT" ? (
        <p className="border border-line bg-sunk px-5 py-4 text-[15px] leading-relaxed text-fg-2">
          Your employer deducted <strong className="text-fg">{cls.flatRatePct}%</strong> from your {formatMoney(pay)} pay in {ret.year}, the flat rate for your taxpayer class ({cls.label}).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] sm:text-sm">
            <caption className="sr-only">TDS by monthly pay bracket</caption>
            <thead>
              <tr className="bg-primary text-white">
                <th scope="col" className="h-10 px-2 text-left font-medium sm:px-3">Monthly pay</th>
                <th scope="col" className="h-10 px-2 text-right font-medium sm:px-3">Rate</th>
                <th scope="col" className="h-10 px-2 text-right font-medium sm:px-3">
                  <span className="sm:hidden">Pay</span>
                  <span className="hidden sm:inline">Pay in bracket</span>
                </th>
                <th scope="col" className="h-10 px-2 text-right font-medium sm:px-3">TDS</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((r, i) => (
                <tr key={r.b.fromMinor} className={cn("border-b border-line bg-surface", r.count === 0 && "text-muted")}>
                  <td className="px-2 py-2 sm:px-3">
                    {r.b.toMinor === null ? `Over ${whole(r.b.fromMinor)}` : i === 0 ? `Up to ${whole(r.b.toMinor)}` : `Over ${whole(r.b.fromMinor)} to ${whole(r.b.toMinor)}`}
                    {r.count ? <span className="text-muted"> · {r.count} {r.count === 1 ? "month" : "months"}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right sm:px-3">{r.b.ratePct}%</td>
                  <td className="px-2 py-2 text-right sm:px-3">{formatMoney(r.pay)}</td>
                  <td className="px-2 py-2 text-right sm:px-3">{formatMoney(r.tds)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunk font-medium">
                <td className="px-2 py-2.5 sm:px-3" colSpan={3}>
                  Deducted in {ret.year} ({months.length} {months.length === 1 ? "month" : "months"}, {formatPeriod(months[0]!.period)} onwards)
                </td>
                <td className="num px-2 py-2.5 text-right sm:px-3">{formatMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-sm text-muted">Each month's pay is taxed at the rate for the bracket it falls in (GMCA TDS table). TDS is tax paid in advance: your tax for the year is worked out below, and what your employer deducted is taken off.</p>
    </section>
  );
}

function TaxStep({ db, ret, rules, snapshot }: { db: Db; ret: IndividualTaxReturn; rules: TaxRuleSet; snapshot: CalculationSnapshot }) {
  const f = snapshot.figures!;
  const bands = bandBreakdown(f.chargeableMinor, rules.individualBands);
  const whole = (m: number) => `$${Math.round(m / 100).toLocaleString("en-US")}`;
  const reliefLines = snapshot.lines.filter((l) => l.key.startsWith("rel-"));
  return (
    <div className="grid gap-8">
      <TdsWorking db={db} ret={ret} rules={rules} />
      <section className="grid gap-6" aria-labelledby="tax-h">
        <h2 id="tax-h" className="font-serif text-xl">
          Tax for the year
        </h2>
        <dl className="grid border border-line sm:grid-cols-3">
          {[
            ["Assessable income", f.taxableMinor],
            ["Reliefs", f.reliefsMinor],
            ["Chargeable income", f.chargeableMinor]
          ].map(([label, value], i) => (
            <div key={label as string} className={cn("grid gap-1 px-5 py-4", i > 0 && "border-t border-line sm:border-l sm:border-t-0")}>
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="font-serif text-2xl">
                <Money cents={value as number} />
              </dd>
            </div>
          ))}
        </dl>
        {f.exemptMinor ? <p className="text-sm text-muted">Exempt income of {formatMoney(f.exemptMinor)} is declared but not taxed. GMCA may review the treatment.</p> : null}
        {reliefLines.length ? (
          <div>
            <h3 className="mb-2 text-sm font-medium">Reliefs applied</h3>
            <ul className="grid gap-1 text-[15px]">
              {reliefLines.map((r) => (
                <li key={r.key} className="flex justify-between gap-4 border-b border-line-soft py-1.5">
                  <span className="text-fg-2">{r.label.replace("Less relief · ", "")}</span>
                  <Money cents={-r.amountMinor} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {f.taxpayerClass && f.taxpayerClass.flatRatePct !== null ? (
          <p className="border border-line bg-sunk px-5 py-4 text-[15px] leading-relaxed text-fg-2">
            Your income is taxed at <strong className="text-fg">{f.taxpayerClass.flatRatePct}%</strong>, the flat rate for your taxpayer class ({f.taxpayerClass.label}). The class follows the residency GMCA has recorded for you, and its rate is demo configuration.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] sm:text-sm">
              <caption className="sr-only">Tax by band, GMC Income Tax Act 2025</caption>
              <thead>
                <tr className="bg-primary text-white">
                  <th scope="col" className="h-10 px-2 text-left font-medium sm:px-3">Band</th>
                  <th scope="col" className="h-10 px-2 text-right font-medium sm:px-3">Rate</th>
                  <th scope="col" className="h-10 px-2 text-right font-medium sm:px-3">
                    <span className="sm:hidden">In band</span>
                    <span className="hidden sm:inline">Income in band</span>
                  </th>
                  <th scope="col" className="h-10 px-2 text-right font-medium sm:px-3">Tax</th>
                </tr>
              </thead>
              <tbody className="num">
                {bands.map((b) => (
                  <tr key={b.band.fromMinor} className={cn("border-b border-line bg-surface", b.inBandMinor === 0 && "text-muted")}>
                    <td className="px-2 py-2 sm:px-3">{b.band.toMinor === null ? `Over ${whole(b.band.fromMinor)}` : `${whole(b.band.fromMinor)} – ${whole(b.band.toMinor)}`}</td>
                    <td className="px-2 py-2 text-right sm:px-3">{b.band.ratePct}%</td>
                    <td className="px-2 py-2 text-right sm:px-3">{formatMoney(b.inBandMinor)}</td>
                    <td className="px-2 py-2 text-right sm:px-3">{formatMoney(b.taxMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-sunk font-medium">
                  <td className="px-2 py-2.5 sm:px-3" colSpan={3}>
                    Tax for the year
                  </td>
                  <td className="num px-2 py-2.5 text-right sm:px-3">{formatMoney(snapshot.taxMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <dl className="grid gap-2 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-2">Tax for the year</dt>
            <dd>
              <Money cents={snapshot.taxMinor} />
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-2">Tax your employers already deducted</dt>
            <dd>
              <Money cents={-snapshot.creditsMinor} />
            </dd>
          </div>
        </dl>
        <ResultBanner balance={snapshot.balanceMinor} />
        {snapshot.warnings.map((w) => (
          <p key={w} className="text-sm text-act-fg">
            {w}
          </p>
        ))}
        <p className="text-sm text-muted">
          Bands from the GMC Income Tax Act 2025 (rule set {snapshot.ruleSetVersion}). This is an estimate: GMCA assesses your return and issues a Notice of Assessment.
          {snapshot.balanceMinor < 0 ? " How a credit is refunded or carried forward is not yet configured." : ""}
        </p>
      </section>
    </div>
  );
}

function ResultBanner({ balance }: { balance: number }) {
  const tone = balance > 0 ? "border-act-line bg-act-bg text-act-fg" : balance < 0 ? "border-ok-line bg-ok-bg text-ok-fg" : "border-line bg-sunk text-fg-2";
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border px-5 py-4", tone)}>
      <span className="text-[15px] font-medium">{resultLabel(balance)}</span>
      <span className="font-serif text-[2rem] leading-none">
        <Money cents={Math.abs(balance)} />
      </span>
    </div>
  );
}

/* ---------- Review, declare, pay and submit ---------- */

function ReviewStep({
  db,
  ret,
  rules,
  snapshot,
  sources,
  reliefs,
  issues,
  steps,
  declared,
  setDeclared,
  locked,
  onEdit,
  onSubmit
}: {
  db: Db;
  ret: IndividualTaxReturn;
  rules: TaxRuleSet;
  snapshot: CalculationSnapshot;
  sources: IncomeSource[];
  reliefs: ReliefClaim[];
  issues: { step: string; message: string }[];
  steps: { key: StepKey; label: string }[];
  declared: boolean;
  setDeclared: (v: boolean) => void;
  locked: boolean;
  onEdit: (key: StepKey) => void;
  onSubmit: () => void;
}) {
  const [tried, setTried] = useState(false);
  const t = db.taxpayers.find((x) => x.id === ret.taxpayerId)!;
  const f = snapshot.figures!;
  const balance = snapshot.balanceMinor;
  const payFirst = db.config.payBeforeSubmit && balance > 0;
  const blocking = issues.filter((i) => i.step !== "review");
  const sections: { key: StepKey; title: string; rows: { label: ReactNode; value: ReactNode; hint?: ReactNode }[] }[] = [
    {
      key: "about",
      title: "About you",
      rows: [
        { label: "Name", value: t.fullName },
        { label: "TIN", value: t.tin },
        { label: "Tax residency", value: t.residencyStatus === "NOT_DETERMINED" ? "Not yet determined" : t.residencyStatus === "RESIDENT" ? "Resident" : "Non-resident" }
      ]
    },
    {
      key: "income",
      title: "Income",
      rows: [
        ...ret.employment.map((e) => ({ label: e.employerName, value: <Money cents={e.grossMinor} />, hint: `Employment, ${e.months} months · TDS ${formatMoney(e.tdsMinor)}` })),
        ...sources.map((s) => {
          const doc = db.documents.find((d) => d.id === s.bankStatementDocId);
          return {
            label: s.description || "Untitled income",
            value: s.conversion?.reportingMinor != null ? (s.classification === "EXEMPT" ? <>Exempt (<Money cents={s.conversion.reportingMinor} />)</> : <Money cents={s.conversion.reportingMinor} />) : <span className="text-act-fg">Conversion pending</span>,
            hint: `${s.currency !== db.config.reportingCurrency ? `${formatAmount(s.amountMinor, s.currency)} · ` : ""}Bank statement: ${doc ? doc.fileName : "missing"}`
          };
        }),
        ...(ret.employment.length + sources.length === 0 ? [{ label: "Income", value: "None declared" }] : [])
      ]
    },
    {
      key: "reliefs",
      title: "Reliefs",
      rows: reliefs.length
        ? reliefs.map((r) => {
            const line = snapshot.lines.find((l) => l.key === `rel-${r.id}`);
            return { label: rules.reliefs.find((x) => x.key === r.reliefKey)?.label ?? r.reliefKey, value: <Money cents={line ? -line.amountMinor : r.declaredMinor} />, hint: `${r.docIds.length} evidence file${r.docIds.length === 1 ? "" : "s"}` };
          })
        : [{ label: "Reliefs", value: "None" }]
    },
    {
      key: "tax",
      title: "Your tax",
      rows: [
        { label: "Chargeable income", value: <Money cents={f.chargeableMinor} /> },
        { label: "Tax for the year", value: <Money cents={snapshot.taxMinor} /> },
        { label: "Already deducted", value: <Money cents={snapshot.creditsMinor} /> },
        { label: resultLabel(balance), value: <Money cents={Math.abs(balance)} className="font-medium" /> }
      ]
    }
  ];

  return (
    <div className="grid gap-6">
      {blocking.length ? (
        <Alert tone="rejected" title="Fix these before you submit">
          <ul className="grid gap-1">
            {blocking.map((i) => (
              <li key={i.message}>
                {i.message}{" "}
                <button type="button" className="font-medium text-rej-fg underline underline-offset-4" onClick={() => onEdit(i.step as StepKey)}>
                  Go to {steps.find((s) => s.key === i.step)?.label}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {sections.map((s) => (
        <section key={s.key} className="panel px-6 py-4" aria-labelledby={`rev-${s.key}`}>
          <div className="flex items-center justify-between gap-3">
            <h2 id={`rev-${s.key}`} className="font-serif text-xl">
              {s.title}
            </h2>
            <Button variant="link" onClick={() => onEdit(s.key)} aria-label={`Edit ${s.title}`}>
              <Pencil /> Edit
            </Button>
          </div>
          <DataList rows={s.rows} />
        </section>
      ))}
      {payFirst ? (
        <Alert tone="action" title={`You have ${formatMoney(balance)} to pay`}>
          Pay through DK Bank (simulated) and your return is submitted to GMCA as soon as the payment is confirmed. If GMCA's assessment changes your tax, you'll get a notice asking only for the difference.
        </Alert>
      ) : balance < 0 ? (
        <Alert tone="review" title={`Estimated credit of ${formatMoney(-balance)}`}>
          GMCA confirms the amount when it assesses your return. Refund and carry-forward rules are not yet configured.
        </Alert>
      ) : null}
      <section className="grid gap-4 border border-line bg-sunk p-6" aria-labelledby="declare">
        <h2 id="declare" className="font-serif text-xl">
          Declaration
        </h2>
        <Checkbox checked={declared} onChange={setDeclared}>
          I declare that the information in this return is true and complete to the best of my knowledge. I understand that an incorrect return can lead to a penalty.
        </Checkbox>
        {tried && !declared ? (
          <p className="flex items-center gap-1.5 text-xs text-rej-fg">
            <AlertTriangle className="size-3.5" aria-hidden="true" /> Tick the declaration to submit.
          </p>
        ) : null}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => onEdit("tax")}>
          <ArrowLeft /> Back
        </Button>
        <Button
          size="lg"
          disabled={blocking.length > 0 || locked}
          onClick={() => {
            setTried(true);
            if (!declared) return;
            onSubmit();
          }}
        >
          {payFirst ? (
            <>
              <Landmark /> Pay my tax
            </>
          ) : (
            "Submit my return"
          )}
        </Button>
      </div>
    </div>
  );
}
