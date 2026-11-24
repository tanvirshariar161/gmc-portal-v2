import { ArrowRight, CalendarClock, FileCheck2, FileText, History, MessageSquareWarning, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, navigate, useActor, useDb, useDocumentTitle, useRun } from "../../app/core";
import type { Assessment, Db, IndividualTaxReturn } from "../../domain/types";
import { formatDate, formatDateTime, formatPeriod, maskId } from "../../lib/format";
import { formatAmount, formatMoney } from "../../lib/money";
import { requestCorrection, updateContact } from "../../services/registration";
import { returnScope } from "../../services/individual";
import { liabilityStatus, outstanding } from "../../services/payments";
import { BalanceSheetView } from "../shared/BalanceSheet";
import { Button } from "../../shared/gmc/Button";
import { TextArea, TextField } from "../../shared/gmc/Form";
import { ActionCard, Alert, EmptyState, Eyebrow, IconTile, StatusBadge } from "../../shared/gmc/Layout";
import { cn } from "../../lib/utils";
import { ruleSetForYear } from "../../services/calc";
import { DataTable } from "../../shared/gmc/Table";
import { openRequestsFor, ownerOf, paymentsFor } from "../shared/queries";
import { Forbidden } from "../shared/TaxpayerShared";
import { AssessmentBadge, CalcBreakdown, ConversionView, DocLink, KeyValue, MetricStrip, PageHeader, PaymentBadge, Section, SubmissionBadge, userName } from "../shared/ui";

function useTaxpayer() {
  const db = useDb();
  const actor = useActor();
  const taxpayer = db.taxpayers.find((t) => t.id === actor.taxpayerId)!;
  return { db, actor, taxpayer };
}

const RESIDENCY_LABEL = { NOT_DETERMINED: "Not yet determined by GMCA", RESIDENT: "Resident (recorded by GMCA)", NON_RESIDENT: "Non-resident (recorded by GMCA)" } as const;

function assessmentFor(db: Db, r: IndividualTaxReturn): Assessment | undefined {
  return r.assessmentId ? db.assessments.find((a) => a.id === r.assessmentId) : undefined;
}

// ---------- Overview ----------

export function IndividualOverview() {
  useDocumentTitle("Overview");
  const { db, taxpayer } = useTaxpayer();
  const owner = { kind: "INDIVIDUAL" as const, id: taxpayer.id };
  const year = db.config.currentFilingYear;
  const returns = db.individualReturns.filter((r) => r.taxpayerId === taxpayer.id).sort((a, b) => b.year - a.year);
  const current = returns.find((r) => r.year === year);
  const requests = openRequestsFor(db, owner);
  const liabilities = db.liabilities.filter((l) => l.owner.kind === "INDIVIDUAL" && l.owner.id === taxpayer.id);
  const due = liabilities.reduce((s, l) => s + outstanding(l), 0);
  const payments = paymentsFor(db, owner);
  const lastPaid = payments.find((p) => p.status === "SUCCESS");
  const currentAssessment = current && assessmentFor(db, current);
  const filed = current?.submissionStatus === "SUBMITTED";
  const ya = year + 1;
  const deadline = `${ya}-${db.config.filingDeadlineMonthDay}`;
  const daysLeft = Math.ceil((Date.parse(`${deadline}T23:59:59`) - Date.now()) / 86_400_000);

  return (
    <>
      <PageHeader title={`Hello, ${taxpayer.fullName.split(" ")[0]}`} lead={`${taxpayer.tin} · ${taxpayer.category === "CITIZEN" ? "Bhutanese citizen" : `Foreign national (${taxpayer.nationality})`}`} />

      {requests.map((r) => (
        <Alert key={r.id} tone="action" title="GMCA needs more information" action={<Button size="sm" onClick={() => navigate(`/requests/${r.id}`)}>Respond</Button>}>
          {r.message.slice(0, 140)}
          {r.message.length > 140 ? "…" : ""} Respond by <strong>{formatDate(r.dueDate)}</strong>.
        </Alert>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <ActionCard
          href={filed ? `/returns/${current!.id}` : `/returns/file/${year}`}
          onNavigate={navigate}
          filled={!filed}
          icon={filed ? FileCheck2 : CalendarClock}
          eyebrow={filed ? `Submitted ${formatDate(current!.submittedAt, "short")}` : daysLeftLabel(daysLeft)}
          title={filed ? <>Your YA {ya} return is with GMCA</> : <>File your YA {ya} return by {formatDate(deadline)}</>}
          body={
            filed
              ? currentAssessment?.status === "COMPLETED"
                ? "GMCA has assessed it. Your Notice of Assessment is ready."
                : `Reference ${current!.reference}. GMCA will tell you here when it has been assessed.`
              : taxpayer.category === "FOREIGN"
                ? "Your employer's figures are already in. Check them, claim any reliefs you're due, and submit."
                : "Your employer's figures are already in. Add anything else you earned and the reliefs you're due."
          }
          cta={filed ? "View your return" : current ? "Continue your return" : "Start your return"}
        />
        <IncomeCard db={db} taxpayerId={taxpayer.id} year={year} />
      </div>

      <MetricStrip
        items={[
          { label: "Outstanding (assessed)", value: formatMoney(due), hint: due ? <Link className="text-brand-ink underline" to="/payments">Pay now</Link> : "Nothing to pay" },
          { label: "Returns filed", value: returns.filter((r) => r.submissionStatus === "SUBMITTED").length },
          { label: "Open requests", value: requests.length },
          { label: "Last payment", value: lastPaid ? formatAmount(lastPaid.amountMinor, lastPaid.currency) : "—", hint: lastPaid ? formatDate(lastPaid.settledAt, "short") : undefined }
        ]}
      />

      <Section title="Your returns" actions={<Link to="/history" className="inline-flex items-center gap-1.5 text-sm text-brand-ink underline-offset-4 hover:underline"><History className="size-4" /> Tax history and certificates</Link>}>
        <ReturnsTable db={db} returns={returns} />
      </Section>
    </>
  );
}

function daysLeftLabel(days: number) {
  if (days > 1) return `${days} days left`;
  if (days === 1) return "1 day left";
  if (days === 0) return "Due today";
  return `${-days} days overdue`;
}

/** Employment income for the year as employers declared it, month by month. */
export function employerIncome(db: Db, taxpayerId: string, year: number) {
  const ids = new Set(db.employees.filter((e) => e.taxpayerId === taxpayerId).map((e) => e.id));
  let gross = 0;
  let tds = 0;
  let health = 0;
  let months = 0;
  for (const d of db.monthlyDeclarations) {
    if (d.submissionStatus !== "SUBMITTED" || !d.period.startsWith(`${year}-`)) continue;
    for (const l of d.lines) {
      if (!ids.has(l.employeeId)) continue;
      gross += l.conversion?.reportingMinor ?? 0;
      tds += l.tdsMinor;
      health += l.healthMinor;
      months += 1;
    }
  }
  return { gross, tds, health, net: gross - tds - health, months };
}

function IncomeCard({ db, taxpayerId, year }: { db: Db; taxpayerId: string; year: number }) {
  const inc = employerIncome(db, taxpayerId, year);
  const rules = ruleSetForYear(db.ruleSets, year);
  const fig = (label: string, minor: number, tone?: "deduct" | "net") => (
    <div className="grid gap-1">
      <dt className="text-[15px] text-fg-2">{label}</dt>
      <dd className={cn("num whitespace-nowrap font-serif text-[1.25rem] leading-tight sm:text-[1.5rem] 2xl:text-[1.75rem]", tone === "net" ? "text-brand-ink" : "text-fg")}>{formatMoney(tone === "deduct" ? -minor : minor)}</dd>
    </div>
  );
  return (
    <section className="grid min-h-[210px] content-between gap-7 border border-line bg-surface p-7 sm:p-8" aria-labelledby="income-card-title">
      <div className="flex gap-5">
        <IconTile icon={Wallet} size={52} />
        <div className="grid gap-2">
          <Eyebrow>Reported by your employer</Eyebrow>
          <h2 id="income-card-title" className="font-serif text-[1.625rem] leading-tight text-fg sm:text-[1.875rem]">
            Your {year} income
          </h2>
        </div>
      </div>
      {inc.months ? (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-6">
          {fig("Gross salary", inc.gross)}
          {fig("Tax deducted", inc.tds, "deduct")}
          {fig(`Health contribution (${rules.healthRatePct}%)`, inc.health, "deduct")}
          {fig("Net salary", inc.net, "net")}
        </dl>
      ) : (
        <p className="text-[15px] text-muted">No employer has reported income for {year} yet. It appears here as soon as your employer files its monthly declaration.</p>
      )}
      <Link to="/income" className="group flex items-center justify-end gap-2 font-medium text-fg transition-[gap] hover:gap-3">
        See month by month <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}

function ReturnsTable({ db, returns }: { db: Db; returns: IndividualTaxReturn[] }) {
  return (
    <DataTable
      caption="Individual returns"
      rows={returns}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(r.submissionStatus === "DRAFT" ? `/returns/file/${r.year}` : `/returns/${r.id}`)}
      empty="No returns yet."
      columns={[
        { key: "year", header: "Year", cell: (r) => <span className="num font-medium">{r.year}</span> },
        { key: "ref", header: "Reference", cell: (r) => <span className="num">{r.reference ?? "—"}</span> },
        { key: "sub", header: "Submission", cell: (r) => <SubmissionBadge status={r.submissionStatus} /> },
        { key: "asm", header: "Assessment", cell: (r) => { const a = assessmentFor(db, r); return a ? <AssessmentBadge status={a.status} /> : <span className="text-muted">—</span>; } },
        {
          key: "pay",
          header: "Payment",
          cell: (r) => {
            const a = assessmentFor(db, r);
            const l = a?.liabilityId ? db.liabilities.find((x) => x.id === a.liabilityId) : undefined;
            return l ? <PaymentBadge status={liabilityStatus(db, l)} /> : <span className="text-muted">{a?.status === "COMPLETED" ? "Nothing due" : "—"}</span>;
          }
        },
        { key: "open", header: <span className="sr-only">Open</span>, cell: (r) => <Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to={r.submissionStatus === "DRAFT" ? `/returns/file/${r.year}` : `/returns/${r.id}`}>{r.submissionStatus === "DRAFT" ? "Continue" : "View"}</Link> }
      ]}
    />
  );
}

export function ReturnsPage() {
  useDocumentTitle("Tax returns");
  const { db, taxpayer } = useTaxpayer();
  const returns = db.individualReturns.filter((r) => r.taxpayerId === taxpayer.id).sort((a, b) => b.year - a.year);
  const year = db.config.currentFilingYear;
  const hasCurrent = returns.some((r) => r.year === year);
  const requests = openRequestsFor(db, { kind: "INDIVIDUAL", id: taxpayer.id });
  return (
    <>
      <PageHeader title="Individual Income Tax Returns" lead="File the current year, follow GMCA's assessment, and answer requests." actions={!hasCurrent ? <Button onClick={() => navigate(`/returns/file/${year}`)}>Start {year} return</Button> : null} />
      {requests.length ? (
        <Section title="Additional Information Required">
          <ul className="grid gap-2">
            {requests.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`} className="flex items-center gap-3 border border-act-line bg-act-bg px-4 py-3 text-sm text-act-fg hover:underline">
                  <MessageSquareWarning className="size-4" /> {r.reference} · respond by {formatDate(r.dueDate)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <ReturnsTable db={db} returns={returns} />
    </>
  );
}

// ---------- Return detail (read-only once submitted) ----------

const TIMELINE = ["Submitted", "Assigned", "Under review", "Assessment completed"] as const;

export function AssessmentProgress({ a }: { a?: Assessment }) {
  const reached = !a ? 0 : a.status === "NOT_ASSIGNED" ? 1 : a.status === "ASSIGNED" ? 2 : a.status === "COMPLETED" ? 4 : 3;
  return (
    <ol className="grid gap-0 border border-line bg-surface sm:grid-cols-4">
      {TIMELINE.map((label, i) => {
        const done = i < reached;
        const info = i === 2 && (a?.status === "INFO_REQUIRED" || a?.status === "RESPONSE_RECEIVED");
        return (
          <li key={label} className={`grid gap-1 border-line-soft px-4 py-3 ${i ? "border-t sm:border-l sm:border-t-0" : ""}`}>
            <span className={`text-xs font-medium uppercase tracking-[0.1em] ${done ? "text-brand-ink" : "text-muted"}`}>Step {i + 1}</span>
            <span className={done ? "font-medium text-fg" : "text-muted"}>{label}</span>
            {info ? <span className="text-xs text-act-fg">{a?.status === "INFO_REQUIRED" ? "Waiting for your information" : "Your response is with GMCA"}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ReturnDetail({ id, justSubmitted }: { id: string; justSubmitted: boolean }) {
  const db = useDb();
  const actor = useActor();
  const ret = db.individualReturns.find((r) => r.id === id);
  useDocumentTitle(ret ? `Return ${ret.year}` : "Return");
  if (!ret || (actor.role === "INDIVIDUAL" && ret.taxpayerId !== actor.taxpayerId)) return <Forbidden />;
  if (ret.submissionStatus === "DRAFT") {
    return (
      <Alert tone="review" title="This return is still a draft" action={<Button size="sm" onClick={() => navigate(`/returns/file/${ret.year}`)}>Continue</Button>}>
        Submitted returns open here in read-only form.
      </Alert>
    );
  }
  const a = assessmentFor(db, ret);
  const ack = ret.ackDocId ? db.documents.find((d) => d.id === ret.ackDocId) : undefined;
  const noa = a?.noaDocId ? db.documents.find((d) => d.id === a.noaDocId) : undefined;
  const l = a?.liabilityId ? db.liabilities.find((x) => x.id === a.liabilityId) : undefined;
  const paidWith = db.liabilities.filter((x) => x.source === "INDIVIDUAL_SELF_ASSESSMENT" && x.sourceId === ret.id).map((x) => x.id);
  const receipts = db.payments.filter((p) => (p.liabilityId === l?.id || paidWith.includes(p.liabilityId)) && p.receiptDocId).map((p) => db.documents.find((d) => d.id === p.receiptDocId)!);
  const requests = a ? db.infoRequests.filter((r) => r.assessmentId === a.id) : [];
  return (
    <>
      <PageHeader title={`Individual Income Tax Return ${ret.year}`} lead={`${ret.reference} · submitted ${formatDateTime(ret.submittedAt)}`} back={{ to: "/returns", label: "Tax returns" }} />
      {justSubmitted ? (
        <Alert tone="approved" title="Return submitted" action={ack ? <Button size="sm" onClick={() => navigate(`/documents/${ack.id}`)}>View certificate</Button> : null}>
          Your reference is <strong>{ret.reference}</strong>. GMCA will assess it and tell you here. The return is now locked.
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmissionBadge status={ret.submissionStatus} />
        {a ? <AssessmentBadge status={a.status} /> : null}
        {l ? <PaymentBadge status={liabilityStatus(db, l)} /> : null}
      </div>
      <AssessmentProgress a={a} />

      {requests.filter((r) => r.status === "OPEN").map((r) => (
        <Alert key={r.id} tone="action" title="Additional Information Required" action={actor.role === "INDIVIDUAL" ? <Button size="sm" onClick={() => navigate(`/requests/${r.id}`)}>Respond</Button> : null}>
          {r.message} Due {formatDate(r.dueDate)}.
        </Alert>
      ))}

      {a?.outcome ? (
        <Section title="Assessment">
          <div className="panel grid gap-4 p-5">
            <KeyValue
              rows={[
                { label: "Assessed tax", value: formatMoney(a.outcome.assessedTaxMinor) },
                { label: "Tax credits (TDS)", value: formatMoney(a.outcome.creditsMinor) },
                ...(a.outcome.prepaidMinor ? [{ label: "Paid with the return", value: formatMoney(a.outcome.prepaidMinor) }] : []),
                { label: a.outcome.balanceMinor >= 0 ? "Balance payable" : "Credit", value: <strong>{formatMoney(a.outcome.balanceMinor)}</strong> },
                { label: "Outstanding now", value: l ? formatMoney(outstanding(l)) : "Nothing due" },
                { label: "Assessed by", value: `${userName(db, a.outcome.by)}, ${formatDate(a.outcome.at)}` }
              ]}
            />
            <p className="text-sm text-fg-2">{a.outcome.summary}</p>
            {l && outstanding(l) > 0 && actor.role === "INDIVIDUAL" && liabilityStatus(db, l) !== "PENDING" ? (
              <Button className="w-fit" onClick={() => navigate(`/payments/${l.id}/pay`)}>
                Pay {formatMoney(outstanding(l))}
              </Button>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title="Documents">
        <ul className="grid gap-2 border border-line bg-surface p-4">
          {ack ? <li><DocLink doc={ack}>Acknowledgement Certificate ({ack.reference})</DocLink></li> : null}
          {noa ? <li><DocLink doc={noa}>Notice of Assessment ({noa.reference})</DocLink></li> : <li className="text-sm text-muted">Notice of Assessment: not issued yet</li>}
          {receipts.map((d) => (
            <li key={d.id}>
              <DocLink doc={d}>Payment Acknowledgement ({d.reference})</DocLink>
            </li>
          ))}
          {requests.map((r) => (r.letterDocId ? <li key={r.id}><Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to={`/requests/${r.id}`}>Information request {r.reference} ({r.status.toLowerCase()})</Link></li> : null))}
        </ul>
      </Section>

      <FiledDeclarations db={db} ret={ret} />
      <CalcBreakdown snapshot={ret.calculation} title="Calculation submitted with the return" />
    </>
  );
}

/** The declarations exactly as submitted. Used by the taxpayer and by GMCA assessors. */
export function FiledDeclarations({ db, ret }: { db: Db; ret: IndividualTaxReturn }) {
  const rules = db.ruleSets.find((r) => r.id === ret.calculation?.ruleSetId);
  return (
    <>
      <Section title="Employment income" description="Reported by employers in their monthly declarations.">
        <DataTable
          caption="Employment income"
          rows={ret.employment}
          rowKey={(e) => e.employerName}
          empty="No employer declarations for this year."
          columns={[
            { key: "emp", header: "Employer", cell: (e) => e.employerName },
            { key: "m", header: "Months", align: "right", cell: (e) => e.months },
            { key: "g", header: "Gross", align: "right", cell: (e) => formatMoney(e.grossMinor, e.currency) },
            { key: "t", header: "TDS", align: "right", cell: (e) => formatMoney(e.tdsMinor, e.currency) }
          ]}
        />
      </Section>
      {ret.incomeSources.length || returnScope(db, ret).additionalIncome ? (
      <Section title="Additional income sources">
        <DataTable
          caption="Additional income"
          rows={ret.incomeSources}
          rowKey={(s) => s.id}
          minWidth="52rem"
          empty="No additional income declared."
          columns={[
            { key: "d", header: "Source", cell: (s) => <span className="grid"><span>{s.description}</span><span className="text-xs text-muted">{rules?.taxItems.find((c) => c.key === s.category)?.label ?? s.category} · {s.payer}</span></span> },
            { key: "p", header: "Period", cell: (s) => <span className="text-xs">{formatDate(s.periodFrom, "short")} – {formatDate(s.periodTo, "short")}</span> },
            { key: "c", header: "Treatment", cell: (s) => (s.classification === "EXEMPT" ? "Exempt" : "Taxable") },
            { key: "a", header: "Amount", align: "right", cell: (s) => <ConversionView conversion={s.conversion} /> },
            { key: "b", header: "Bank statement", cell: (s) => { const doc = db.documents.find((x) => x.id === s.bankStatementDocId); return doc ? <span className="grid"><DocLink doc={doc}>{doc.fileName}</DocLink>{s.statementSource === "DK_BANK" ? <span className="text-xs text-muted">Synced from DK Bank</span> : null}</span> : <span className="text-rej-fg">Missing</span>; } }
          ]}
        />
      </Section>
      ) : null}
      {ret.balanceSheet?.length || returnScope(db, ret).balanceSheet ? (
        <Section title="Assets and liabilities">
          <BalanceSheetView db={db} rules={rules} lines={ret.balanceSheet ?? []} />
        </Section>
      ) : null}
      <Section title="Reliefs claimed">
        <DataTable
          caption="Reliefs"
          rows={ret.reliefs}
          rowKey={(r) => r.id}
          empty="No reliefs claimed."
          columns={[
            { key: "r", header: "Relief", cell: (r) => rules?.reliefs.find((x) => x.key === r.reliefKey)?.label ?? r.reliefKey },
            { key: "a", header: "Claimed", align: "right", cell: (r) => formatMoney(r.declaredMinor) },
            { key: "e", header: "Evidence", cell: (r) => <span className="grid gap-1">{r.docIds.map((x) => { const doc = db.documents.find((d) => d.id === x); return doc ? <DocLink key={x} doc={doc}>{doc.fileName}</DocLink> : null; })}</span> }
          ]}
        />
      </Section>
    </>
  );
}

// ---------- Tax history ----------

export function IndividualHistory() {
  useDocumentTitle("Tax history");
  const { db, taxpayer } = useTaxpayer();
  const returns = db.individualReturns.filter((r) => r.taxpayerId === taxpayer.id && r.submissionStatus === "SUBMITTED").sort((a, b) => b.year - a.year);
  return (
    <>
      <PageHeader title="Tax history" lead="Every return you've filed, kept exactly as submitted. Open a year to see its declarations, calculation and certificates." />
      {returns.length === 0 ? (
        <EmptyState icon={FileText} title="No filed returns yet">Returns appear here once you submit them.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {returns.map((r) => {
            const a = assessmentFor(db, r);
            const l = a?.liabilityId ? db.liabilities.find((x) => x.id === a.liabilityId) : undefined;
            const ack = r.ackDocId ? db.documents.find((d) => d.id === r.ackDocId) : undefined;
            const noa = a?.noaDocId ? db.documents.find((d) => d.id === a.noaDocId) : undefined;
            const payIds = db.liabilities.filter((x) => x.id === l?.id || (x.source === "INDIVIDUAL_SELF_ASSESSMENT" && x.sourceId === r.id)).map((x) => x.id);
            const receipt = db.payments.filter((p) => payIds.includes(p.liabilityId) && p.receiptDocId).map((p) => db.documents.find((d) => d.id === p.receiptDocId)).find(Boolean);
            const prepaid = db.liabilities.filter((x) => x.source === "INDIVIDUAL_SELF_ASSESSMENT" && x.sourceId === r.id).reduce((sum, x) => sum + x.paidMinor, 0);
            return (
              <article key={r.id} className="grid gap-4 border border-line bg-surface p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <h2 className="font-serif text-[1.5rem] leading-tight">Financial year {r.year}</h2>
                    <p className="text-sm text-muted">
                      Individual Income Tax Return · {r.reference} · filed {formatDate(r.submittedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SubmissionBadge status={r.submissionStatus} />
                    {a ? <AssessmentBadge status={a.status} /> : null}
                    {l ? <PaymentBadge status={liabilityStatus(db, l)} /> : null}
                  </div>
                </div>
                <KeyValue
                  rows={[
                    { label: "Calculated tax (on return)", value: r.calculation ? formatMoney(r.calculation.taxMinor) : "—" },
                    { label: "TDS / tax credits", value: r.calculation ? formatMoney(r.calculation.creditsMinor) : "—" },
                    { label: "Assessed tax", value: a?.outcome ? formatMoney(a.outcome.assessedTaxMinor) : "Not assessed yet" },
                    { label: "Paid / outstanding", value: `${formatMoney(prepaid + (l?.paidMinor ?? 0))} paid · ${formatMoney(l ? outstanding(l) : 0)} outstanding` }
                  ]}
                />
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft pt-4 text-sm">
                  <Link to={`/returns/${r.id}`} className="font-medium text-brand-ink underline-offset-4 hover:underline">
                    Open return (read-only)
                  </Link>
                  {ack ? <DocLink doc={ack}>Acknowledgement Certificate</DocLink> : null}
                  {noa ? <DocLink doc={noa}>Notice of Assessment</DocLink> : null}
                  {receipt ? <DocLink doc={receipt}>Payment Acknowledgement</DocLink> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------- Income ----------

export function IncomePage() {
  useDocumentTitle("My income");
  const { db, taxpayer } = useTaxpayer();
  const employeeIds = new Set(db.employees.filter((e) => e.taxpayerId === taxpayer.id).map((e) => e.id));
  const rows = db.monthlyDeclarations
    .filter((d) => d.submissionStatus === "SUBMITTED")
    .flatMap((d) => d.lines.filter((l) => employeeIds.has(l.employeeId)).map((l) => ({ decl: d, line: l })))
    .sort((a, b) => b.decl.period.localeCompare(a.decl.period));
  const sources = db.individualReturns.filter((r) => r.taxpayerId === taxpayer.id).flatMap((r) => r.incomeSources.map((s) => ({ ret: r, s })));
  return (
    <>
      <PageHeader title="My income" lead="Employment income your employers have declared to GMCA, and the other income you have declared on your returns." />
      <Section title="Employment income reported by employers" description="Taken from each employer's monthly TDS declaration. You don't need to declare it again.">
        <DataTable
          caption="Employer-reported income"
          rows={rows}
          rowKey={(r) => `${r.decl.id}-${r.line.employeeId}`}
          minWidth="48rem"
          empty="No employer has declared income for you yet."
          columns={[
            { key: "m", header: "Month", cell: (r) => formatPeriod(r.decl.period) },
            { key: "e", header: "Employer", cell: (r) => db.companies.find((c) => c.id === r.decl.companyId)?.name },
            { key: "g", header: "Remuneration", align: "right", cell: (r) => <ConversionView conversion={r.line.conversion} compact /> },
            { key: "t", header: "TDS", align: "right", cell: (r) => formatMoney(r.line.tdsMinor) },
            { key: "h", header: "Health contribution", align: "right", cell: (r) => formatMoney(r.line.healthMinor) }
          ]}
        />
      </Section>
      <Section title="Additional income you declared">
        <DataTable
          caption="Declared income"
          rows={sources}
          rowKey={(r) => r.s.id}
          minWidth="44rem"
          empty="No additional income declared yet."
          columns={[
            { key: "y", header: "Year", cell: (r) => r.ret.year },
            { key: "d", header: "Source", cell: (r) => r.s.description || "Untitled" },
            { key: "c", header: "Treatment", cell: (r) => (r.s.classification === "EXEMPT" ? "Exempt" : "Taxable") },
            { key: "a", header: "Amount", align: "right", cell: (r) => <ConversionView conversion={r.s.conversion} compact /> },
            { key: "s", header: "Return", cell: (r) => <SubmissionBadge status={r.ret.submissionStatus} /> }
          ]}
        />
      </Section>
    </>
  );
}

// ---------- Profile ----------

export function ProfilePage() {
  useDocumentTitle("My profile");
  const { db, taxpayer } = useTaxpayer();
  const run = useRun();
  const [contact, setContact] = useState({ email: taxpayer.email, phone: taxpayer.phone, address: taxpayer.address });
  const [correction, setCorrection] = useState("");
  const v = taxpayer.verification;
  const employers = db.employees.filter((e) => e.taxpayerId === taxpayer.id);
  return (
    <>
      <PageHeader title="My profile" lead="Your identity comes from a verified record. You can change your contact details; anything else needs a correction request to GMCA." />
      <Section title="Identity" actions={<span className="flex items-center gap-2 text-sm text-muted">Verified by {v.provider === "NDI" ? "NDI" : "Immigration System"}</span>}>
        <div className="panel p-5">
          <KeyValue
            rows={[
              { label: "Full name", value: taxpayer.fullName },
              { label: "Taxpayer Identification Number", value: taxpayer.tin },
              { label: taxpayer.identifierType === "CID" ? "Citizenship ID" : taxpayer.identifierType === "WORK_PERMIT" ? "Work permit" : "Passport", value: maskId(taxpayer.identifierValue) },
              { label: "Date of birth", value: formatDate(taxpayer.dateOfBirth) },
              { label: "Nationality", value: taxpayer.nationality },
              { label: "Tax residency", value: RESIDENCY_LABEL[taxpayer.residencyStatus] },
              { label: "Verification reference", value: <span className="num text-sm">{v.reference ?? "—"}</span> },
              { label: "Registered", value: formatDate(taxpayer.registeredAt) }
            ]}
          />
        </div>
        <p className="text-sm text-muted">Residency is recorded by GMCA. It decides whether any non-resident treatment applies; nationality alone does not.</p>
      </Section>
      <Section title="Employment">
        <div className="panel grid gap-4 p-5">
          {taxpayer.employmentSummary ? (
            <KeyValue rows={[{ label: "Employer (from Immigration record)", value: taxpayer.employmentSummary.employer }, { label: "Position", value: taxpayer.employmentSummary.position }, { label: "Since", value: formatDate(taxpayer.employmentSummary.since) }, ...(taxpayer.employmentSummary.permitExpiry ? [{ label: "Work permit valid until", value: formatDate(taxpayer.employmentSummary.permitExpiry) }] : [])]} />
          ) : null}
          {employers.length ? (
            <ul className="grid gap-1 text-sm">
              {employers.map((e) => (
                <li key={e.id}>
                  Listed by <strong>{db.companies.find((c) => c.id === e.companyId)?.name}</strong> as {e.position} since {formatDate(e.startDate)} ({e.status.toLowerCase().replace("_", " ")})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No employer has listed you yet.</p>
          )}
        </div>
      </Section>
      <Section title="Contact details">
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run((d, a) => updateContact(d, a, contact), "Contact details saved");
          }}
        >
          <TextField label="Email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <TextField label="Mobile number" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          <TextField label="Address" value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} />
          <div>
            <Button type="submit">Save contact details</Button>
          </div>
        </form>
      </Section>
      <Section title="Something wrong with your verified details?">
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (run((d, a) => requestCorrection(d, a, correction), "Correction request sent to GMCA") !== undefined) setCorrection("");
          }}
        >
          <TextArea label="Describe the correction" rows={3} value={correction} onChange={(e) => setCorrection(e.target.value)} hint="GMCA reviews it against the source record. The correction workflow itself is still to be confirmed." />
          <div>
            <Button type="submit" variant="secondary">
              Send correction request
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}
