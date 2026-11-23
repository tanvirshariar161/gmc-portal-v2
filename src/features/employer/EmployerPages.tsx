import { ArrowRight, Plus, Save, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, navigate, useActor, useDb, useDocumentTitle, useRun } from "../../app/core";
import type { Db, Employee, EmployerMonthlyDeclaration } from "../../domain/types";
import { formatDate, formatDateTime, formatPeriod, maskId } from "../../lib/format";
import { formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { activeIncentive, ruleSetForYear } from "../../services/calc";
import { addEmployee, declarationIssues, employedInPeriod, ensureDeclaration, saveDeclarationLines, submitDeclaration, updateEmployee, verifyEmployee, type EmployeeInput } from "../../services/employer";
import { liabilityStatus, outstanding } from "../../services/payments";
import { Button } from "../../shared/gmc/Button";
import { RadioGroup, SelectField, TextField } from "../../shared/gmc/Form";
import { Alert, StatusBadge } from "../../shared/gmc/Layout";
import { DataTable } from "../../shared/gmc/Table";
import { openRequestsFor } from "../shared/queries";
import { Forbidden } from "../shared/TaxpayerShared";
import { AssessmentBadge, CalcBreakdown, ConversionView, CurrencySelect, DemoTag, KeyValue, MetricStrip, PageHeader, PaymentBadge, Section, SubmissionBadge, userName } from "../shared/ui";

export function useCompany() {
  const db = useDb();
  const actor = useActor();
  const company = db.companies.find((c) => c.id === actor.companyId)!;
  return { db, actor, company };
}

function prevPeriod(period: string) {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// ---------- Overview ----------

export function EmployerOverview() {
  useDocumentTitle("Company overview");
  const { db, company } = useCompany();
  const period = db.config.currentPayrollPeriod;
  const decls = db.monthlyDeclarations.filter((d) => d.companyId === company.id);
  const current = decls.find((d) => d.period === period);
  const last = decls.filter((d) => d.submissionStatus === "SUBMITTED").sort((a, b) => b.period.localeCompare(a.period))[0];
  const owner = { kind: "COMPANY" as const, id: company.id };
  const liabilities = db.liabilities.filter((l) => l.owner.kind === "COMPANY" && l.owner.id === company.id);
  const due = liabilities.reduce((s, l) => s + outstanding(l), 0);
  const active = db.employees.filter((e) => e.companyId === company.id && e.status !== "LEFT");
  const inc = activeIncentive(db.incentives, company.id, db.config.currentFilingYear);
  const corp = db.corporateReturns.filter((r) => r.companyId === company.id).sort((a, b) => b.year - a.year)[0];
  const corpA = corp?.assessmentId ? db.assessments.find((a) => a.id === corp.assessmentId) : undefined;
  const requests = openRequestsFor(db, owner);
  const calc = (current ?? last)?.calculation;

  return (
    <>
      <PageHeader title={company.name} lead={`${company.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "UEN"} ${company.uen} · ${company.sector}`} />
      {requests.map((r) => (
        <Alert key={r.id} tone="action" title="GMCA needs more information" action={<Button size="sm" onClick={() => navigate(`/requests/${r.id}`)}>Respond</Button>}>
          {r.message.slice(0, 160)} Respond by <strong>{formatDate(r.dueDate)}</strong>.
        </Alert>
      ))}
      <section className="grid border border-line bg-surface lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-between gap-6 p-6 sm:p-8">
          <div className="grid gap-2">
            <p className="text-sm text-muted">Monthly TDS & Health Contributions</p>
            <h2 className="font-serif text-[1.75rem] leading-tight">{formatPeriod(period)}</h2>
            <div className="flex flex-wrap gap-2">{current ? <SubmissionBadge status={current.submissionStatus} /> : <StatusBadge tone="neutral">Not started</StatusBadge>}</div>
            <p className="max-w-xl pt-2 text-[15px] text-fg-2">{current?.submissionStatus === "SUBMITTED" ? `Submitted ${formatDateTime(current.submittedAt)} as ${current.reference}.` : `${active.length} employees on the directory. Enter each employee's pay in the currency they are paid in.`}</p>
          </div>
          <div>
            <Button size="lg" onClick={() => navigate(`/company/payroll/${period}`)}>
              {current?.submissionStatus === "SUBMITTED" ? "View declaration" : current ? "Continue declaration" : "Start declaration"} <ArrowRight />
            </Button>
          </div>
        </div>
        <div className="grid content-start gap-3 border-t border-line bg-sunk p-6 sm:p-8 lg:border-l lg:border-t-0">
          <p className="text-sm font-medium">{current ? formatPeriod(current.period) : last ? `Last filed: ${formatPeriod(last.period)}` : "No declarations yet"}</p>
          {calc ? (
            <KeyValue
              rows={[
                { label: "Employees included", value: String((current ?? last)!.lines.length) },
                { label: `Total remuneration (${db.config.reportingCurrency})`, value: formatMoney(calc.lines.find((l) => l.key === "gross")?.amountMinor ?? 0) },
                { label: "TDS", value: formatMoney(calc.lines.find((l) => l.key === "tds")?.amountMinor ?? 0) },
                { label: "Health contributions", value: formatMoney(calc.lines.find((l) => l.key === "health")?.amountMinor ?? 0) }
              ]}
            />
          ) : null}
        </div>
      </section>
      <MetricStrip
        items={[
          { label: "Outstanding to pay", value: formatMoney(due), hint: due ? <Link className="text-brand-ink underline" to="/payments">Go to payments</Link> : "Nothing outstanding" },
          { label: "Active employees", value: active.length },
          { label: "Declarations filed", value: decls.filter((d) => d.submissionStatus === "SUBMITTED").length },
          { label: "Corporate tax rate", value: inc ? `${inc.ratePct}%` : `${ruleSetForYear(db.ruleSets, db.config.currentFilingYear).corporateRatePct}%`, hint: inc ? `Approved incentive ${inc.approvalReference}` : "Standard demo rate" }
        ]}
      />
      <Section title="Corporate income tax" actions={<Link to="/company/corporate" className="text-sm text-brand-ink underline-offset-4 hover:underline">Corporate returns</Link>}>
        <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
          {corp ? (
            <>
              <div className="grid gap-1">
                <p className="font-medium">Financial year {corp.year}</p>
                <p className="text-sm text-muted">{corp.reference ?? "Draft"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SubmissionBadge status={corp.submissionStatus} />
                {corpA ? <AssessmentBadge status={corpA.status} /> : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No corporate return yet.</p>
          )}
        </div>
      </Section>
      <Section title="Recent declarations">
        <DeclarationsTable db={db} decls={decls.sort((a, b) => b.period.localeCompare(a.period)).slice(0, 4)} />
      </Section>
    </>
  );
}

export function DeclarationsTable({ db, decls }: { db: Db; decls: EmployerMonthlyDeclaration[] }) {
  return (
    <DataTable
      caption="Monthly declarations"
      rows={decls}
      rowKey={(d) => d.id}
      empty="No declarations yet."
      minWidth="48rem"
      columns={[
        { key: "p", header: "Month", cell: (d) => <Link className="font-medium text-brand-ink underline-offset-4 hover:underline" to={`/company/payroll/${d.period}`}>{formatPeriod(d.period)}</Link> },
        { key: "r", header: "Reference", cell: (d) => <span className="num">{d.reference ?? "—"}</span> },
        { key: "n", header: "Employees", align: "right", cell: (d) => d.lines.length },
        { key: "t", header: "TDS + health", align: "right", cell: (d) => formatMoney(d.calculation?.balanceMinor ?? 0) },
        { key: "s", header: "Filing", cell: (d) => <SubmissionBadge status={d.submissionStatus} /> },
        { key: "pay", header: "Payment", cell: (d) => { const l = d.liabilityId ? db.liabilities.find((x) => x.id === d.liabilityId) : undefined; return l ? <PaymentBadge status={liabilityStatus(db, l)} /> : <span className="text-muted">—</span>; } }
      ]}
    />
  );
}

// ---------- Company profile ----------

export function CompanyProfile() {
  useDocumentTitle("Company profile");
  const { db, company } = useCompany();
  const incentives = db.incentives.filter((i) => i.companyId === company.id);
  return (
    <>
      <PageHeader title="Company profile" lead="Registration details come from the Corporate Registration System and can't be edited here." />
      <Section title="Registration" actions={<span className="flex items-center gap-2 text-sm text-muted">Verified <DemoTag>Simulated registry</DemoTag></span>}>
        <div className="panel p-5">
          <KeyValue
            rows={[
              { label: "Registered name", value: company.name },
              { label: company.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship number" : "UEN", value: company.uen },
              { label: "Account type", value: company.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company" },
              { label: "Sector", value: company.sector },
              { label: "Registered address", value: company.registeredAddress },
              { label: "Incorporated", value: formatDate(company.incorporatedOn) },
              { label: "Registry reference", value: <span className="num text-sm">{company.verification.reference}</span> }
            ]}
          />
        </div>
      </Section>
      <Section title="Representatives">
        <DataTable caption="Representatives" rows={company.representatives} rowKey={(r) => r.email} columns={[{ key: "n", header: "Name", cell: (r) => r.name }, { key: "d", header: "Designation", cell: (r) => r.designation }, { key: "e", header: "Email", cell: (r) => r.email }, { key: "p", header: "Phone", cell: (r) => r.phone }]} />
      </Section>
      <Section title="Approved tax incentives" description="GMCA evaluates and approves incentives outside this platform. Once recorded here, the rate is applied automatically to corporate tax calculations in its effective period.">
        <DataTable
          caption="Incentives"
          rows={incentives}
          rowKey={(i) => i.id}
          empty="No incentive recorded. The standard corporate rate applies."
          columns={[
            { key: "r", header: "Rate", cell: (i) => <strong>{i.ratePct}%</strong> },
            { key: "p", header: "Effective", cell: (i) => `${formatDate(i.effectiveFrom, "short")} – ${formatDate(i.effectiveTo, "short")}` },
            { key: "a", header: "Approval reference", cell: (i) => i.approvalReference },
            { key: "s", header: "Status", cell: (i) => <StatusBadge tone={i.status === "ACTIVE" ? "approved" : "neutral"}>{i.status === "ACTIVE" ? "Active" : "Revoked"}</StatusBadge> },
            { key: "by", header: "Recorded by", cell: (i) => `${userName(db, i.recordedBy)}, ${formatDate(i.recordedAt, "short")}` }
          ]}
        />
      </Section>
    </>
  );
}

// ---------- Employee directory ----------

const STATUS_TONE = { ACTIVE: "approved", ON_LEAVE: "review", LEFT: "neutral" } as const;
const STATUS_LABEL = { ACTIVE: "Active", ON_LEAVE: "On leave", LEFT: "Left" } as const;
const VERIFY_TONE = { VERIFIED: "approved", NOT_VERIFIED: "action", NO_MATCH: "rejected" } as const;
const VERIFY_LABEL = { VERIFIED: "Verified", NOT_VERIFIED: "Not verified", NO_MATCH: "No match" } as const;

export function EmployeesPage() {
  useDocumentTitle("Employee directory");
  const { db, company } = useCompany();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"ALL" | Employee["status"]>("ALL");
  const [cat, setCat] = useState<"ALL" | Employee["category"]>("ALL");
  const rows = db.employees.filter((e) => e.companyId === company.id && (status === "ALL" || e.status === status) && (cat === "ALL" || e.category === cat) && (!q || e.fullName.toLowerCase().includes(q.toLowerCase()) || e.identifierValue.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHeader
        title="Employee directory"
        lead="Bhutanese employees are identified by Citizenship ID, foreign employees by work permit or passport. Foreign employees are checked against the simulated Immigration System."
        actions={
          <Button onClick={() => navigate("/company/employees/new")}>
            <UserPlus /> Add employee
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <label htmlFor="emp-search" className="sr-only">
            Search employees
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input id="emp-search" className="control pl-9" placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-40">
          <option value="ALL">All</option>
          <option value="ACTIVE">Active</option>
          <option value="ON_LEAVE">On leave</option>
          <option value="LEFT">Left</option>
        </SelectField>
        <SelectField label="Identity" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} className="w-48">
          <option value="ALL">All</option>
          <option value="CITIZEN">Bhutanese</option>
          <option value="FOREIGN">Foreign national</option>
        </SelectField>
      </div>
      <DataTable
        caption="Employees"
        rows={rows}
        rowKey={(e) => e.id}
        minWidth="56rem"
        empty="No employees match."
        columns={[
          { key: "n", header: "Name", cell: (e) => <Link className="font-medium text-brand-ink underline-offset-4 hover:underline" to={`/company/employees/${e.id}`}>{e.fullName}</Link> },
          { key: "id", header: "Identifier", cell: (e) => <span className="grid"><span className="num">{maskId(e.identifierValue)}</span><span className="text-xs text-muted">{e.identifierType === "CID" ? "Citizenship ID" : e.identifierType === "WORK_PERMIT" ? "Work permit" : "Passport"}</span></span> },
          { key: "p", header: "Position", cell: (e) => e.position },
          { key: "c", header: "Pay currency", cell: (e) => e.defaultCurrency },
          { key: "s", header: "Employment", cell: (e) => <StatusBadge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</StatusBadge> },
          { key: "v", header: "Verification", cell: (e) => <StatusBadge tone={VERIFY_TONE[e.verification.status]}>{VERIFY_LABEL[e.verification.status]}</StatusBadge> }
        ]}
      />
    </>
  );
}

const blankEmployee = (currency: string): EmployeeInput => ({ fullName: "", category: "CITIZEN", identifierType: "CID", identifierValue: "", position: "", startDate: "", status: "ACTIVE", defaultCurrency: currency });

export function EmployeeEditor({ id }: { id?: string }) {
  const { db, company } = useCompany();
  const run = useRun();
  const existing = id ? db.employees.find((e) => e.id === id && e.companyId === company.id) : undefined;
  const [form, setForm] = useState<EmployeeInput>(() => (existing ? { fullName: existing.fullName, category: existing.category, identifierType: existing.identifierType, identifierValue: existing.identifierValue, position: existing.position, startDate: existing.startDate, endDate: existing.endDate, status: existing.status, defaultCurrency: existing.defaultCurrency } : blankEmployee(db.config.reportingCurrency)));
  useDocumentTitle(existing ? existing.fullName : "Add employee");
  if (id && !existing) return <Forbidden />;
  const history = existing
    ? db.monthlyDeclarations
        .filter((d) => d.companyId === company.id)
        .flatMap((d) => d.lines.filter((l) => l.employeeId === existing.id).map((l) => ({ d, l })))
        .sort((a, b) => b.d.period.localeCompare(a.d.period))
    : [];
  const set = (patch: Partial<EmployeeInput>) => setForm({ ...form, ...patch });
  return (
    <>
      <PageHeader title={existing ? existing.fullName : "Add employee"} back={{ to: "/company/employees", label: "Employee directory" }} />
      {existing ? (
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={VERIFY_TONE[existing.verification.status]}>{VERIFY_LABEL[existing.verification.status]}</StatusBadge>
          <span className="text-sm text-muted">
            {existing.verification.provider === "IMMIGRATION" ? "Immigration System" : "Citizen record"} <DemoTag>Simulated</DemoTag> {existing.verification.checkedAt ? `· checked ${formatDateTime(existing.verification.checkedAt)}` : ""}
          </span>
          <Button size="sm" variant="secondary" onClick={() => run((d, a) => verifyEmployee(d, a, existing.id), "Verification refreshed")}>
            Check again
          </Button>
        </div>
      ) : null}
      <form
        className="grid max-w-3xl gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = existing ? run((d, a) => updateEmployee(d, a, existing.id, form), "Employee updated") : run((d, a) => addEmployee(d, a, company.id, form), "Employee added");
          if (saved && !existing) navigate(`/company/employees/${saved.id}`, { replace: true });
        }}
      >
        <TextField label="Full name" required value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
        <RadioGroup
          legend="Employee is"
          name="category"
          value={form.category}
          onChange={(v) => set({ category: v, identifierType: v === "CITIZEN" ? "CID" : "WORK_PERMIT" })}
          options={[
            { value: "CITIZEN", label: "Bhutanese citizen" },
            { value: "FOREIGN", label: "Foreign national" }
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {form.category === "FOREIGN" ? (
            <SelectField label="Identifier type" value={form.identifierType} onChange={(e) => set({ identifierType: e.target.value as EmployeeInput["identifierType"] })}>
              <option value="WORK_PERMIT">Work permit</option>
              <option value="PASSPORT">Passport</option>
            </SelectField>
          ) : null}
          <TextField label={form.identifierType === "CID" ? "Citizenship ID" : form.identifierType === "WORK_PERMIT" ? "Work permit number" : "Passport number"} required value={form.identifierValue} onChange={(e) => set({ identifierValue: form.identifierType === "CID" ? e.target.value.replace(/\D/g, "").slice(0, 11) : e.target.value.toUpperCase() })} hint={form.category === "FOREIGN" ? "Demo records: WP-DEMO-2026-0003, DEMO-TH-5521" : "11 digits"} />
          <TextField label="Position" value={form.position} onChange={(e) => set({ position: e.target.value })} />
          <CurrencySelect db={db} label="Usual pay currency" value={form.defaultCurrency} onChange={(c) => set({ defaultCurrency: c })} />
          <TextField label="Start date" type="date" required value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          <SelectField label="Employment status" value={form.status} onChange={(e) => set({ status: e.target.value as Employee["status"] })}>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="LEFT">Left</option>
          </SelectField>
          <TextField label="End date" type="date" value={form.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || undefined })} hint={form.status === "LEFT" ? "Required when the employee has left" : "Leave empty if still employed"} />
        </div>
        <p className="text-sm text-muted">How joiners, leavers and partial months are treated is still to be confirmed by GMCA; the prototype includes anyone employed on any day of the month.</p>
        <div>
          <Button type="submit">
            <Save /> {existing ? "Save changes" : "Add and verify"}
          </Button>
        </div>
      </form>
      {existing ? (
        <Section title="Remuneration history">
          <DataTable
            caption="Remuneration history"
            rows={history}
            rowKey={(r) => r.d.id}
            empty="Not on any declaration yet."
            columns={[
              { key: "p", header: "Month", cell: (r) => formatPeriod(r.d.period) },
              { key: "a", header: "Remuneration", align: "right", cell: (r) => <ConversionView conversion={r.l.conversion} compact /> },
              { key: "t", header: "TDS", align: "right", cell: (r) => formatMoney(r.l.tdsMinor) },
              { key: "h", header: "Health", align: "right", cell: (r) => formatMoney(r.l.healthMinor) },
              { key: "s", header: "Filing", cell: (r) => <SubmissionBadge status={r.d.submissionStatus} /> }
            ]}
          />
        </Section>
      ) : null}
    </>
  );
}

// ---------- Monthly declarations ----------

export function PayrollPage() {
  useDocumentTitle("Monthly TDS & Health Contributions");
  const { db, company } = useCompany();
  const [period, setPeriod] = useState(db.config.currentPayrollPeriod);
  const decls = db.monthlyDeclarations.filter((d) => d.companyId === company.id).sort((a, b) => b.period.localeCompare(a.period));
  const rules = ruleSetForYear(db.ruleSets, Number(period.slice(0, 4)));
  return (
    <>
      <PageHeader title="Monthly TDS & Health Contributions" lead={`Declare each employee's pay for the month. TDS (${rules.tdsMethod === "BRACKET_WHOLE_AMOUNT" ? "bracket rate on the whole month" : "progressive"}) and the ${rules.healthRatePct}% health contribution are calculated from demo rules. Social security is not collected: GMC follows a clean wage policy.`} />
      <div className="flex flex-wrap items-end gap-3 border border-line bg-surface p-5">
        <TextField label="Filing month" type="month" value={period} max={db.config.currentPayrollPeriod} onChange={(e) => setPeriod(e.target.value)} className="w-56" />
        <Button onClick={() => navigate(`/company/payroll/${period}`)}>
          Open declaration <ArrowRight />
        </Button>
        <p className="w-full text-sm text-muted">The filing window isn't restricted: the interim portal's 8th–15th window is not carried over. The monthly deadline is still to be confirmed.</p>
      </div>
      <Section title="Declarations">
        <DeclarationsTable db={db} decls={decls} />
      </Section>
    </>
  );
}

export function DeclarationPage({ period }: { period: string }) {
  useDocumentTitle(`Declaration ${period}`);
  const { db, company } = useCompany();
  const run = useRun();
  const decl = db.monthlyDeclarations.find((d) => d.companyId === company.id && d.period === period);
  const valid = /^\d{4}-\d{2}$/.test(period) && period <= db.config.currentPayrollPeriod;
  if (!valid) return <Forbidden message="Choose a month up to the current payroll period." />;
  if (!decl) {
    const eligible = db.employees.filter((e) => e.companyId === company.id && e.status !== "LEFT" && employedInPeriod(e, period));
    return (
      <>
        <PageHeader title={`Declaration for ${formatPeriod(period)}`} back={{ to: "/company/payroll", label: "Monthly TDS & Health" }} />
        <div className="panel grid gap-4 p-6">
          <p className="text-[15px]">{eligible.length} employees were employed during {formatPeriod(period)}. Amounts and currencies are copied from {formatPeriod(prevPeriod(period))} where available, so you only change what's different.</p>
          <div>
            <Button onClick={() => run((d, a) => ensureDeclaration(d, a, company.id, period))}>
              <Plus /> Start declaration
            </Button>
          </div>
        </div>
      </>
    );
  }
  return <DeclarationEditor key={decl.id} db={db} decl={decl} />;
}

function DeclarationEditor({ db, decl }: { db: Db; decl: EmployerMonthlyDeclaration }) {
  const run = useRun();
  const locked = decl.submissionStatus === "SUBMITTED";
  const [lines, setLines] = useState(() => decl.lines.map((l) => ({ employeeId: l.employeeId, amount: minorToInput(l.amountMinor || null), currency: l.currency })));
  const [confirming, setConfirming] = useState(false);
  const dirty = lines.some((l) => {
    const o = decl.lines.find((x) => x.employeeId === l.employeeId)!;
    return (parseAmountInput(l.amount) ?? 0) !== o.amountMinor || l.currency !== o.currency;
  });
  const badAmount = lines.some((l) => l.amount !== "" && parseAmountInput(l.amount) === null);
  const issues = declarationIssues(decl);
  const ack = decl.ackDocId ? db.documents.find((d) => d.id === decl.ackDocId) : undefined;
  const l = decl.liabilityId ? db.liabilities.find((x) => x.id === decl.liabilityId) : undefined;
  const save = (msg?: string) => run((d, a) => saveDeclarationLines(d, a, decl.id, lines.map((x) => ({ employeeId: x.employeeId, amountMinor: parseAmountInput(x.amount) ?? 0, currency: x.currency }))), msg);
  const byCurrency = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of decl.lines) m.set(x.currency, (m.get(x.currency) ?? 0) + 1);
    return [...m.entries()].map(([c, n]) => `${n} in ${c}`).join(", ");
  }, [decl.lines]);

  return (
    <>
      <PageHeader
        title={`Declaration for ${formatPeriod(decl.period)}`}
        lead={locked ? `${decl.reference} · submitted ${formatDateTime(decl.submittedAt)} by ${userName(db, decl.submittedBy)}` : `Draft · last saved ${formatDateTime(decl.lastSavedAt)} · ${byCurrency}`}
        back={{ to: "/company/payroll", label: "Monthly TDS & Health" }}
        actions={!locked ? <Button variant="secondary" disabled={badAmount} onClick={() => save("Draft saved")}><Save /> Save draft</Button> : null}
      />
      <div className="flex flex-wrap gap-2">
        <SubmissionBadge status={decl.submissionStatus} />
        {l ? <PaymentBadge status={liabilityStatus(db, l)} /> : null}
      </div>
      {locked ? (
        <Alert tone="approved" title="Declaration submitted" action={<div className="flex gap-2">{ack ? <Button size="sm" variant="secondary" onClick={() => navigate(`/documents/${ack.id}`)}>Certificate</Button> : null}{l && outstanding(l) > 0 && liabilityStatus(db, l) !== "PENDING" ? <Button size="sm" onClick={() => navigate(`/payments/${l.id}/pay`)}>Pay {formatMoney(outstanding(l))}</Button> : null}</div>}>
          This declaration is locked. Each employee's income now shows in their own tax account.
        </Alert>
      ) : null}
      <DataTable
        caption="Employee remuneration"
        rows={decl.lines}
        rowKey={(x) => x.employeeId}
        minWidth="54rem"
        columns={[
          { key: "n", header: "Employee", cell: (x) => { const e = db.employees.find((y) => y.id === x.employeeId); return <span className="grid"><span className="font-medium">{x.employeeName}</span><span className="text-xs text-muted">{e?.category === "FOREIGN" ? "Foreign national" : "Bhutanese"} · {maskId(e?.identifierValue ?? "")}</span></span>; } },
          {
            key: "a",
            header: "Remuneration (original)",
            cell: (x) => {
              const row = lines.find((y) => y.employeeId === x.employeeId)!;
              if (locked) return <span className="num">{formatMoney(x.amountMinor, x.currency)}</span>;
              const bad = row.amount !== "" && parseAmountInput(row.amount) === null;
              return (
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor={`amt-${x.employeeId}`}>Amount for {x.employeeName}</label>
                  <input id={`amt-${x.employeeId}`} inputMode="decimal" aria-invalid={bad || undefined} className="control h-9 w-32 text-right num" value={row.amount} onChange={(e) => setLines(lines.map((y) => (y.employeeId === x.employeeId ? { ...y, amount: e.target.value } : y)))} />
                  <label className="sr-only" htmlFor={`cur-${x.employeeId}`}>Currency for {x.employeeName}</label>
                  <select id={`cur-${x.employeeId}`} className="control h-9 w-24" value={row.currency} onChange={(e) => setLines(lines.map((y) => (y.employeeId === x.employeeId ? { ...y, currency: e.target.value } : y)))}>
                    {db.config.currencies.filter((c) => c.enabled || c.code === row.currency).map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </div>
              );
            }
          },
          { key: "c", header: `In ${db.config.reportingCurrency}`, align: "right", cell: (x) => <ConversionView conversion={x.conversion} compact /> },
          { key: "t", header: "TDS", align: "right", cell: (x) => <span className="grid"><span>{formatMoney(x.tdsMinor)}</span><span className="text-xs text-muted">{x.tdsNote}</span></span> },
          { key: "h", header: "Health", align: "right", cell: (x) => formatMoney(x.healthMinor) }
        ]}
        foot={["Total", "", formatMoney(decl.calculation?.lines.find((x) => x.key === "gross")?.amountMinor ?? 0), formatMoney(decl.calculation?.lines.find((x) => x.key === "tds")?.amountMinor ?? 0), formatMoney(decl.calculation?.lines.find((x) => x.key === "health")?.amountMinor ?? 0)]}
      />
      {!locked && dirty ? <Alert tone="review">You've changed amounts or currencies. Save to recalculate TDS and health contributions.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <CalcBreakdown snapshot={decl.calculation} title="Declaration totals" />
        {!locked ? (
          <div className="grid content-start gap-4 border border-line bg-surface p-5">
            <h3 className="font-medium">Submit</h3>
            {issues.length ? (
              <ul className="grid gap-1 text-sm text-act-fg">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Ready to submit. You'll get a reference and certificate, and the total becomes payable.</p>
            )}
            {!confirming ? (
              <Button disabled={dirty || issues.length > 0} onClick={() => setConfirming(true)}>
                Submit declaration
              </Button>
            ) : (
              <div className="grid gap-3 border border-act-line bg-act-bg p-3">
                <p className="text-sm text-act-fg">Submit {formatPeriod(decl.period)} for {decl.lines.length} employees? It will be locked.</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => run((d, a) => submitDeclaration(d, a, decl.id), "Declaration submitted")}>
                    Yes, submit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                    Not yet
                  </Button>
                </div>
              </div>
            )}
            {dirty ? (
              <Button variant="secondary" disabled={badAmount} onClick={() => save("Recalculated")}>
                Save and recalculate
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

