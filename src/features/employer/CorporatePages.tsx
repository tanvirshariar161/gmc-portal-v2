import { ArrowLeft, ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate, useDocumentTitle, useRun, Link } from "../../app/core";
import type { CorporateFinancials, CorporateTaxReturn, Db } from "../../domain/types";
import { formatDate, formatDateTime, formatPeriod } from "../../lib/format";
import { formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { activeIncentive, ruleSetForYear } from "../../services/calc";
import { corporateIssues, ensureCorporateDraft, saveCorporateDraft, submitCorporate } from "../../services/employer";
import { liabilityStatus, outstanding } from "../../services/payments";
import { Button } from "../../shared/gmc/Button";
import { Checkbox, TextField } from "../../shared/gmc/Form";
import { Alert } from "../../shared/gmc/Layout";
import { Stepper } from "../../shared/gmc/Stepper";
import { DataTable } from "../../shared/gmc/Table";
import { AssessmentProgress } from "../individual/IndividualPages";
import { Forbidden } from "../shared/TaxpayerShared";
import { AssessmentBadge, CalcBreakdown, DemoTag, DocLink, KeyValue, PageHeader, PaymentBadge, RecordUpload, Section, SubmissionBadge, userName } from "../shared/ui";
import { DeclarationsTable, useCompany } from "./EmployerPages";

export function CorporateListPage() {
  useDocumentTitle("Corporate income tax");
  const { db, company } = useCompany();
  const returns = db.corporateReturns.filter((r) => r.companyId === company.id).sort((a, b) => b.year - a.year);
  const years = [db.config.currentFilingYear, db.config.currentFilingYear - 1].filter((y) => !returns.some((r) => r.year === y));
  const inc = activeIncentive(db.incentives, company.id, db.config.currentFilingYear);
  return (
    <>
      <PageHeader title="Corporate Income Tax Returns" lead="Annual return with audited financial statements and a fixed asset report. GMCA assesses each return and issues a Notice of Assessment." />
      <Alert tone={inc ? "approved" : "review"} title={inc ? `Approved incentive rate: ${inc.ratePct}%` : `Standard rate: ${ruleSetForYear(db.ruleSets, db.config.currentFilingYear).corporateRatePct}%`}>
        {inc ? `Recorded by GMCA (${inc.approvalReference}), effective ${formatDate(inc.effectiveFrom)} to ${formatDate(inc.effectiveTo)}. It's applied automatically.` : "No approved incentive is recorded for this company. Incentives are approved by GMCA outside this platform."} Rates are demo configuration.
      </Alert>
      {years.length ? (
        <div className="flex flex-wrap gap-3">
          {years.map((y) => (
            <Button key={y} variant={y === db.config.currentFilingYear ? "primary" : "secondary"} onClick={() => navigate(`/company/corporate/file/${y}`)}>
              <Plus /> Start {y} return
            </Button>
          ))}
        </div>
      ) : null}
      <DataTable
        caption="Corporate returns"
        rows={returns}
        rowKey={(r) => r.id}
        empty="No corporate returns yet."
        columns={[
          { key: "y", header: "Year", cell: (r) => <span className="num font-medium">{r.year}</span> },
          { key: "ref", header: "Reference", cell: (r) => r.reference ?? "—" },
          { key: "s", header: "Submission", cell: (r) => <SubmissionBadge status={r.submissionStatus} /> },
          { key: "a", header: "Assessment", cell: (r) => { const a = db.assessments.find((x) => x.id === r.assessmentId); return a ? <AssessmentBadge status={a.status} /> : "—"; } },
          { key: "t", header: "Calculated tax", align: "right", cell: (r) => formatMoney(r.calculation?.taxMinor ?? 0) },
          { key: "o", header: <span className="sr-only">Open</span>, cell: (r) => <Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to={r.submissionStatus === "DRAFT" ? `/company/corporate/file/${r.year}` : `/company/corporate/return/${r.id}`}>{r.submissionStatus === "DRAFT" ? "Continue" : "View"}</Link> }
        ]}
      />
      <p className="text-sm text-muted">Financial schedules, allowable expenses, tax adjustments and the filing deadline are not yet specified by GMCA. Fields here are a prototype proposal, not statutory schedules.</p>
    </>
  );
}

const STEPS = [
  { key: "profile", label: "Company" },
  { key: "financials", label: "Financial information" },
  { key: "documents", label: "Documents" },
  { key: "review", label: "Calculation and review" }
] as const;
type StepKey = (typeof STEPS)[number]["key"];

export function CorporateWizardEntry({ year }: { year: number }) {
  const { db, company } = useCompany();
  const run = useRun();
  const existing = db.corporateReturns.find((r) => r.companyId === company.id && r.year === year);
  const ok = Number.isInteger(year) && year >= 2025 && year <= db.config.currentFilingYear;
  const submittedId = existing?.submissionStatus === "SUBMITTED" ? existing.id : null;
  useEffect(() => {
    if (ok && !existing) run((d, a) => ensureCorporateDraft(d, a, company.id, year));
    if (submittedId) navigate(`/company/corporate/return/${submittedId}`, { replace: true });
  }, [ok, existing, run, company.id, year, submittedId]);
  if (!ok) return <Forbidden message={`Corporate returns for ${year} can't be filed here.`} />;
  if (!existing || submittedId) return <p className="text-muted">Preparing the return…</p>;
  return <CorporateWizard db={db} ret={existing} />;
}

function CorporateWizard({ db, ret }: { db: Db; ret: CorporateTaxReturn }) {
  useDocumentTitle(`Corporate return ${ret.year}`);
  const run = useRun();
  const company = db.companies.find((c) => c.id === ret.companyId)!;
  const inc = activeIncentive(db.incentives, company.id, ret.year);
  const [step, setStep] = useState<StepKey>("profile");
  const [f, setF] = useState(() => ({
    revenue: minorToInput(ret.financials.revenueMinor || null),
    other: minorToInput(ret.financials.otherIncomeMinor || null),
    expenses: minorToInput(ret.financials.expensesMinor || null),
    adjustments: ret.financials.adjustments.map((a) => ({ id: a.id, label: a.label, amount: minorToInput(a.amountMinor) }))
  }));
  const [confirming, setConfirming] = useState(false);
  const owner = { kind: "COMPANY" as const, id: company.id };
  const parseSigned = (v: string) => (v.trim().startsWith("-") ? -(parseAmountInput(v.trim().slice(1)) ?? NaN) : parseAmountInput(v) ?? NaN);
  const financials = (): CorporateFinancials | null => {
    const revenueMinor = parseAmountInput(f.revenue || "0");
    const otherIncomeMinor = parseAmountInput(f.other || "0");
    const expensesMinor = parseAmountInput(f.expenses || "0");
    const adjustments = f.adjustments.map((a) => ({ id: a.id, label: a.label, amountMinor: parseSigned(a.amount || "0") }));
    if (revenueMinor === null || otherIncomeMinor === null || expensesMinor === null || adjustments.some((a) => Number.isNaN(a.amountMinor))) return null;
    return { revenueMinor, otherIncomeMinor, expensesMinor, adjustments };
  };
  const current = financials();
  const dirty = JSON.stringify(current) !== JSON.stringify(ret.financials);
  const save = (msg?: string) => (current ? run((d, a) => saveCorporateDraft(d, a, ret.id, { financials: current }), msg) : undefined);
  const go = (k: StepKey) => {
    if (dirty && current) save();
    setConfirming(false);
    setStep(k);
  };
  const issues = corporateIssues(ret);
  const index = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      <PageHeader title={`Corporate Income Tax Return ${ret.year}`} lead={`Draft · last saved ${formatDateTime(ret.lastSavedAt)}`} back={{ to: "/company/corporate", label: "Corporate income tax" }} actions={<Button variant="secondary" disabled={!current} onClick={() => save("Draft saved")}><Save /> Save draft</Button>} />
      <Stepper steps={[...STEPS]} current={step} onSelect={(k) => go(k as StepKey)} />

      {step === "profile" ? (
        <Section title="Company">
          <div className="panel p-5">
            <KeyValue rows={[{ label: "Name", value: company.name }, { label: company.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship number" : "UEN", value: company.uen }, { label: "Sector", value: company.sector }, { label: "Financial year", value: `${ret.year} (calendar year, a demo assumption)` }, { label: "Applicable rate", value: inc ? `${inc.ratePct}% approved incentive (${inc.approvalReference})` : `${ruleSetForYear(db.ruleSets, ret.year).corporateRatePct}% standard` }]} />
          </div>
        </Section>
      ) : null}

      {step === "financials" ? (
        <Section title="Financial information" description={`Amounts in ${db.config.reportingCurrency}, from the audited financial statements.`}>
          <div className="grid max-w-2xl gap-4">
            <TextField label="Revenue" required inputMode="decimal" value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} error={f.revenue && parseAmountInput(f.revenue) === null ? "Enter an amount like 250000.00" : undefined} />
            <TextField label="Other income" inputMode="decimal" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} error={f.other && parseAmountInput(f.other) === null ? "Enter an amount" : undefined} />
            <TextField label="Total expenses claimed" inputMode="decimal" value={f.expenses} onChange={(e) => setF({ ...f, expenses: e.target.value })} error={f.expenses && parseAmountInput(f.expenses) === null ? "Enter an amount" : undefined} />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Tax adjustments</h3>
              <Button size="sm" variant="secondary" onClick={() => setF({ ...f, adjustments: [...f.adjustments, { id: `adj-${Date.now().toString(36)}`, label: "", amount: "" }] })}>
                <Plus /> Add adjustment
              </Button>
            </div>
            <p className="text-sm text-muted">Positive amounts add back to profit, negative amounts (start with −) deduct. GMCA hasn't confirmed which adjustments are allowed.</p>
            {f.adjustments.map((a, i) => (
              <div key={a.id} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
                <TextField label={`Adjustment ${i + 1}`} value={a.label} onChange={(e) => setF({ ...f, adjustments: f.adjustments.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)) })} />
                <TextField label="Amount" inputMode="decimal" value={a.amount} onChange={(e) => setF({ ...f, adjustments: f.adjustments.map((x) => (x.id === a.id ? { ...x, amount: e.target.value.replace("−", "-") } : x)) })} />
                <Button variant="ghost" aria-label={`Remove adjustment ${i + 1}`} onClick={() => setF({ ...f, adjustments: f.adjustments.filter((x) => x.id !== a.id) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {step === "documents" ? (
        <Section title="Documents">
          <div className="grid gap-6 lg:grid-cols-2">
            <RecordUpload db={db} label="Audited financial statements" required category="AUDITED_FINANCIALS" owner={owner} related={{ kind: "CORPORATE_RETURN", id: ret.id }} docIds={ret.auditedFsDocIds} multiple onChange={(ids) => run((d, a) => saveCorporateDraft(d, a, ret.id, { auditedFsDocIds: ids }))} />
            <RecordUpload db={db} label="Fixed asset report" required category="FIXED_ASSET_REPORT" owner={owner} related={{ kind: "CORPORATE_RETURN", id: ret.id }} docIds={ret.fixedAssetDocIds} multiple onChange={(ids) => run((d, a) => saveCorporateDraft(d, a, ret.id, { fixedAssetDocIds: ids }))} />
          </div>
        </Section>
      ) : null}

      {step === "review" ? (
        <div className="grid gap-6">
          {dirty ? <Alert tone="review">Save your financial information to refresh the calculation.</Alert> : null}
          <CalcBreakdown snapshot={ret.calculation} title="Corporate tax calculation" />
          {issues.filter((i) => i.step !== "review").length ? (
            <Alert tone="action" title="Before you can submit">
              <ul className="grid gap-1">
                {issues.filter((i) => i.step !== "review").map((i) => (
                  <li key={i.message}>
                    <button type="button" className="text-left underline underline-offset-4" onClick={() => go(i.step as StepKey)}>
                      {i.message}
                    </button>
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <div className="panel grid gap-4 p-5">
            <Checkbox checked={ret.declarationAccepted} onChange={(v) => run((d, a) => saveCorporateDraft(d, a, ret.id, { declarationAccepted: v }))}>
              I confirm, as an authorised representative of {company.name}, that this return and its documents are true and complete.
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
                  <strong>Submit the {ret.year} corporate return?</strong> It will be locked and sent to GMCA for assessment.
                </p>
                <div className="flex gap-3">
                  <Button onClick={() => run((d, a) => submitCorporate(d, a, ret.id), "Corporate return submitted") && navigate(`/company/corporate/return/${ret.id}?submitted=1`)}>Yes, submit</Button>
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    Not yet
                  </Button>
                </div>
              </div>
            )}
          </div>
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
          <Button disabled={!current} onClick={() => go(STEPS[index + 1]!.key)}>
            Save and continue <ArrowRight />
          </Button>
        ) : null}
      </div>
    </>
  );
}

export function CorporateReturnDetail({ db, ret, justSubmitted, staffView }: { db: Db; ret: CorporateTaxReturn; justSubmitted?: boolean; staffView?: boolean }) {
  const a = db.assessments.find((x) => x.id === ret.assessmentId);
  const ack = ret.ackDocId ? db.documents.find((d) => d.id === ret.ackDocId) : undefined;
  const noa = a?.noaDocId ? db.documents.find((d) => d.id === a.noaDocId) : undefined;
  const l = a?.liabilityId ? db.liabilities.find((x) => x.id === a.liabilityId) : undefined;
  const receipts = l ? db.payments.filter((p) => p.liabilityId === l.id && p.receiptDocId).map((p) => db.documents.find((d) => d.id === p.receiptDocId)!) : [];
  const docs = [...ret.auditedFsDocIds, ...ret.fixedAssetDocIds].map((x) => db.documents.find((d) => d.id === x)).filter(Boolean);
  const open = a ? db.infoRequests.filter((r) => r.assessmentId === a.id && r.status === "OPEN") : [];
  return (
    <>
      {justSubmitted ? <Alert tone="approved" title="Corporate return submitted">Your reference is <strong>{ret.reference}</strong>. The return is locked and with GMCA.</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <SubmissionBadge status={ret.submissionStatus} />
        {a ? <AssessmentBadge status={a.status} /> : null}
        {l ? <PaymentBadge status={liabilityStatus(db, l)} /> : null}
        {ret.demoSeeded ? <DemoTag>Seeded history</DemoTag> : null}
      </div>
      <AssessmentProgress a={a} />
      {open.map((r) => (
        <Alert key={r.id} tone="action" title="Additional Information Required" action={!staffView ? <Button size="sm" onClick={() => navigate(`/requests/${r.id}`)}>Respond</Button> : null}>
          {r.message} Due {formatDate(r.dueDate)}.
        </Alert>
      ))}
      {a?.outcome ? (
        <div className="panel grid gap-3 p-5">
          <KeyValue rows={[{ label: "Assessed tax", value: formatMoney(a.outcome.assessedTaxMinor) }, { label: "Balance payable", value: formatMoney(a.outcome.balanceMinor) }, { label: "Outstanding now", value: l ? formatMoney(outstanding(l)) : "Nothing due" }, { label: "Assessed by", value: `${userName(db, a.outcome.by)}, ${formatDate(a.outcome.at)}` }]} />
          <p className="text-sm text-fg-2">{a.outcome.summary}</p>
          {!staffView && l && outstanding(l) > 0 && liabilityStatus(db, l) !== "PENDING" ? <Button className="w-fit" onClick={() => navigate(`/payments/${l.id}/pay`)}>Pay {formatMoney(outstanding(l))}</Button> : null}
        </div>
      ) : null}
      <Section title="Documents">
        <ul className="grid gap-2 border border-line bg-surface p-4">
          {ack ? <li><DocLink doc={ack}>Acknowledgement Certificate ({ack.reference})</DocLink></li> : null}
          {noa ? <li><DocLink doc={noa}>Notice of Assessment ({noa.reference})</DocLink></li> : <li className="text-sm text-muted">Notice of Assessment: not issued yet</li>}
          {receipts.map((d) => <li key={d.id}><DocLink doc={d}>Payment Acknowledgement ({d.reference})</DocLink></li>)}
          {docs.map((d) => <li key={d!.id}><DocLink doc={d!}>{d!.fileName}</DocLink></li>)}
        </ul>
      </Section>
      <Section title="Financial information as submitted">
        <div className="panel p-5">
          <KeyValue rows={[{ label: "Revenue", value: formatMoney(ret.financials.revenueMinor) }, { label: "Other income", value: formatMoney(ret.financials.otherIncomeMinor) }, { label: "Expenses claimed", value: formatMoney(ret.financials.expensesMinor) }, ...ret.financials.adjustments.map((x) => ({ label: `Adjustment · ${x.label}`, value: formatMoney(x.amountMinor) }))]} />
        </div>
      </Section>
      <CalcBreakdown snapshot={ret.calculation} title="Calculation submitted with the return" />
    </>
  );
}

export function CorporateReturnPage({ id, justSubmitted }: { id: string; justSubmitted: boolean }) {
  const { db, company } = useCompany();
  const ret = db.corporateReturns.find((r) => r.id === id && r.companyId === company.id);
  useDocumentTitle(ret ? `Corporate return ${ret.year}` : "Corporate return");
  if (!ret) return <Forbidden />;
  return (
    <>
      <PageHeader title={`Corporate Income Tax Return ${ret.year}`} lead={ret.reference ? `${ret.reference} · submitted ${formatDateTime(ret.submittedAt)}` : "Draft"} back={{ to: "/company/corporate", label: "Corporate income tax" }} />
      <CorporateReturnDetail db={db} ret={ret} justSubmitted={justSubmitted} />
    </>
  );
}

export function EmployerHistory() {
  useDocumentTitle("Filing history");
  const { db, company } = useCompany();
  const decls = db.monthlyDeclarations.filter((d) => d.companyId === company.id && d.submissionStatus === "SUBMITTED").sort((a, b) => b.period.localeCompare(a.period));
  const corp = db.corporateReturns.filter((r) => r.companyId === company.id && r.submissionStatus === "SUBMITTED").sort((a, b) => b.year - a.year);
  const outstandingDecls = db.monthlyDeclarations.filter((d) => d.companyId === company.id && d.submissionStatus === "DRAFT");
  return (
    <>
      <PageHeader title="Filing history" lead="Every declaration and return the company has filed, locked as submitted, with certificates and payment status." />
      {outstandingDecls.length ? (
        <Alert tone="action" title="Not yet submitted">
          {outstandingDecls.map((d) => (
            <Link key={d.id} to={`/company/payroll/${d.period}`} className="mr-3 underline">
              {formatPeriod(d.period)}
            </Link>
          ))}
        </Alert>
      ) : null}
      <Section title="Corporate income tax">
        <DataTable
          caption="Corporate returns filed"
          rows={corp}
          rowKey={(r) => r.id}
          empty="No corporate returns filed."
          columns={[
            { key: "y", header: "Year", cell: (r) => r.year },
            { key: "r", header: "Reference", cell: (r) => <Link className="text-brand-ink underline-offset-4 hover:underline" to={`/company/corporate/return/${r.id}`}>{r.reference}</Link> },
            { key: "d", header: "Filed", cell: (r) => formatDate(r.submittedAt, "short") },
            { key: "a", header: "Assessment", cell: (r) => { const a = db.assessments.find((x) => x.id === r.assessmentId); return a ? <AssessmentBadge status={a.status} /> : "—"; } },
            { key: "c", header: "Certificate", cell: (r) => { const d = db.documents.find((x) => x.id === r.ackDocId); return d ? <DocLink doc={d}>View</DocLink> : "—"; } }
          ]}
        />
      </Section>
      <Section title="Monthly TDS & health contributions">
        <DeclarationsTable db={db} decls={decls} />
      </Section>
    </>
  );
}
