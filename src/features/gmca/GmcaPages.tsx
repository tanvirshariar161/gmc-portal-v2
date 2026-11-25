import { CheckCircle2, Download, Flag, MessageSquarePlus, Search, UserCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, navigate, useActor, useDb, useDocumentTitle, useRun } from "../../app/core";
import { canActOnAssessment } from "../../domain/permissions";
import type { Assessment, AssessmentStatus, Db, DocumentReviewStatus, Liability, OwnerRef, Payment, ResidencyStatus, TaxDocument } from "../../domain/types";
import { setResidency } from "../../services/admin";
import { formatDate, formatDateTime, formatPeriod, maskId } from "../../lib/format";
import { formatMoney, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { addAdjustment, addNote, assignToMe, caseLabel, closeRequest, completeAssessment, recordVerification, requestInformation, returnFor, startReview } from "../../services/assessment";
import { organizationsOf } from "../../services/assignments";
import { addDays, today } from "../../services/clock";
import { CATEGORY_LABEL, setDocumentReview } from "../../services/documents";
import { liabilityStatus, outstanding } from "../../services/payments";
import { Button } from "../../shared/gmc/Button";
import { SelectField, TextArea, TextField } from "../../shared/gmc/Form";
import { Alert, StatusBadge } from "../../shared/gmc/Layout";
import { DataTable } from "../../shared/gmc/Table";
import { CorporateReturnDetail } from "../employer/CorporatePages";
import { FiledDeclarations } from "../individual/IndividualPages";
import { DocumentTable, Forbidden, PaymentHistoryTable } from "../shared/TaxpayerShared";
import { AssessmentBadge, assessmentLabel, CalcBreakdown, DocLink, DocReviewBadge, KeyValue, MetricStrip, PageHeader, PaymentBadge, paymentLabel, Section, SubmissionBadge, Tabs, ownerName, userName } from "../shared/ui";

type CaseRow = { a: Assessment; name: string; reference: string; submittedAt?: string; openRequest: boolean; paymentStatus?: ReturnType<typeof liabilityStatus> };

function caseRows(db: Db): CaseRow[] {
  return db.assessments
    .map((a) => {
      const r = returnFor(db, a);
      const { name, reference } = caseLabel(db, a);
      const l = a.liabilityId ? db.liabilities.find((x) => x.id === a.liabilityId) : undefined;
      return { a, name, reference, submittedAt: r?.submittedAt, openRequest: db.infoRequests.some((q) => q.assessmentId === a.id && q.status === "OPEN"), paymentStatus: l ? liabilityStatus(db, l) : undefined };
    })
    .sort((x, y) => (y.submittedAt ?? "").localeCompare(x.submittedAt ?? ""));
}

function CaseTable({ db, rows, caption }: { db: Db; rows: CaseRow[]; caption: string }) {
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(r) => r.a.id}
      onRowClick={(r) => navigate(`/gmca/cases/${r.a.id}`)}
      minWidth="64rem"
      empty="No returns match these filters."
      columns={[
        { key: "ref", header: "Return", cell: (r) => <Link className="font-medium text-brand-ink underline-offset-4 hover:underline" to={`/gmca/cases/${r.a.id}`}>{r.reference}</Link> },
        { key: "who", header: "Taxpayer", cell: (r) => <span className="grid"><span>{r.name}</span><span className="text-xs text-muted">{r.a.returnKind === "INDIVIDUAL" ? "Individual" : "Corporate"} · {r.a.year}</span></span> },
        { key: "sub", header: "Submitted", cell: (r) => formatDate(r.submittedAt, "short") },
        { key: "status", header: "Assessment", cell: (r) => <AssessmentBadge status={r.a.status} /> },
        { key: "who2", header: "Tax officer", cell: (r) => userName(db, r.a.assignedTo) },
        { key: "req", header: "Request", cell: (r) => (r.openRequest ? <StatusBadge tone="action">Open</StatusBadge> : <span className="text-muted">—</span>) },
        { key: "pay", header: "Payment", cell: (r) => (r.paymentStatus ? <PaymentBadge status={r.paymentStatus} /> : <span className="text-muted">—</span>) }
      ]}
    />
  );
}

// ---------- Overview ----------

export function GmcaOverview() {
  useDocumentTitle("GMCA overview");
  const db = useDb();
  const actor = useActor();
  const rows = caseRows(db);
  const mine = rows.filter((r) => r.a.assignedTo === actor.id && r.a.status !== "COMPLETED");
  const stats = useStats(db);
  const attention = mine.filter((r) => r.a.status === "RESPONSE_RECEIVED" || r.a.status === "ASSIGNED");
  const orgs = organizationsOf(db, actor.id).map((id) => db.companies.find((c) => c.id === id)?.name ?? id);
  return (
    <>
      <PageHeader title="Overview" lead={`Returns, assessments and payments for financial year ${db.config.currentFilingYear} and earlier.`} actions={<Button onClick={() => navigate("/gmca/queue")}>Assessment of returns</Button>} />
      <MetricStrip
        items={[
          { label: "Registered taxpayers", value: stats.taxpayers, hint: `${db.taxpayers.length} individuals · ${db.companies.length} companies` },
          { label: "Returns submitted", value: stats.submitted },
          { label: "Under assessment", value: stats.inAssessment },
          { label: "Completed assessments", value: stats.completed }
        ]}
      />
      <MetricStrip
        items={[
          { label: "Tax collected", value: formatMoney(stats.collected), hint: "Confirmed DK Bank payments" },
          { label: "Outstanding liabilities", value: formatMoney(stats.outstanding) },
          { label: "Unpaid or failed", value: stats.unpaidCount },
          { label: "Late filings", value: "—", hint: "Not computed: deadlines are not configured" }
        ]}
      />
      <Alert tone="review" title="Your organizations">
        {orgs.length
          ? `${orgs.join(", ")}. Returns from ${orgs.length === 1 ? "this organization" : "these organizations"} and their employees are assigned to you when they're submitted.`
          : "No organization is assigned to you yet. The GMCA Tax Administrator assigns them; until then, pick up cases from the queue."}
      </Alert>
      <Section title="Needs your attention" description="Cases assigned to you that are waiting on you.">
        {attention.length ? <CaseTable db={db} rows={attention} caption="Cases needing attention" /> : <p className="border border-line bg-surface px-5 py-4 text-sm text-muted">Nothing is waiting on you right now.</p>}
      </Section>
      <Section title="Your open cases" actions={<Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to="/gmca/queue?assigned=me">See all</Link>}>
        <CaseTable db={db} rows={mine} caption="Your open cases" />
      </Section>
      <Section title="Filing progress by return type">
        <FilingBars db={db} />
      </Section>
    </>
  );
}

export function useStats(db: Db) {
  return useMemo(() => {
    const submitted = db.individualReturns.filter((r) => r.submissionStatus === "SUBMITTED").length + db.corporateReturns.filter((r) => r.submissionStatus === "SUBMITTED").length;
    const completed = db.assessments.filter((a) => a.status === "COMPLETED").length;
    const collected = db.payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amountMinor, 0);
    const out = db.liabilities.reduce((s, l) => s + outstanding(l), 0);
    const unpaidCount = db.liabilities.filter((l) => ["UNPAID", "FAILED", "PARTIALLY_PAID"].includes(liabilityStatus(db, l))).length;
    return { taxpayers: db.taxpayers.length + db.companies.length, submitted, completed, inAssessment: db.assessments.length - completed, collected, outstanding: out, unpaidCount };
  }, [db]);
}

function FilingBars({ db }: { db: Db }) {
  const statuses: AssessmentStatus[] = ["NOT_ASSIGNED", "ASSIGNED", "UNDER_REVIEW", "INFO_REQUIRED", "RESPONSE_RECEIVED", "COMPLETED"];
  const kinds = [
    { key: "INDIVIDUAL", label: "Individual" },
    { key: "CORPORATE", label: "Corporate" }
  ] as const;
  return (
    <div className="grid gap-4 border border-line bg-surface p-5">
      {kinds.map((k) => {
        const list = db.assessments.filter((a) => a.returnKind === k.key);
        return (
          <div key={k.key} className="grid gap-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{k.label} returns</span>
              <span className="text-muted">{list.length} submitted</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden bg-sunk" role="img" aria-label={`${k.label}: ${statuses.map((s) => `${list.filter((a) => a.status === s).length} ${assessmentLabel(s).toLowerCase()}`).join(", ")}`}>
              {statuses.map((s, i) => {
                const n = list.filter((a) => a.status === s).length;
                return n ? <span key={s} style={{ width: `${(n / Math.max(1, list.length)) * 100}%`, opacity: 0.35 + i * 0.13 }} className="h-full border-r-2 border-surface bg-primary" /> : null;
              })}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {statuses.map((s) => {
                const n = list.filter((a) => a.status === s).length;
                return n ? <li key={s}>{assessmentLabel(s)}: <span className="num text-fg">{n}</span></li> : null;
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Queue ----------

type AssessmentTab = "INDIVIDUAL" | "CORPORATE" | "REQUESTS";
const TAB_PARAM: Record<AssessmentTab, string> = { INDIVIDUAL: "individual", CORPORATE: "corporate", REQUESTS: "requests" };

/** Assessment of returns: individual and corporate returns and information requests, one tab each. */
export function QueuePage({ query }: { query: URLSearchParams }) {
  useDocumentTitle("Assessment of returns");
  const db = useDb();
  const fromQuery = (Object.keys(TAB_PARAM) as AssessmentTab[]).find((k) => TAB_PARAM[k] === query.get("tab")) ?? "INDIVIDUAL";
  const [tab, setTab] = useState<AssessmentTab>(fromQuery);
  const count = (k: "INDIVIDUAL" | "CORPORATE") => db.assessments.filter((a) => a.returnKind === k && a.status !== "COMPLETED").length;
  const openRequests = db.infoRequests.filter((q) => q.status !== "CLOSED").length;
  const choose = (k: AssessmentTab) => {
    setTab(k);
    navigate(`/gmca/queue?tab=${TAB_PARAM[k]}`, { replace: true });
  };
  return (
    <>
      <PageHeader title="Assessment of returns" lead="All submitted returns, centrally. You can work on cases assigned to you; pick up unassigned ones from the case page." />
      <Tabs
        label="Assessment of returns"
        value={tab}
        onChange={choose}
        tabs={[
          { key: "INDIVIDUAL", label: <>Individual <span className="text-muted">{count("INDIVIDUAL")}</span></> },
          { key: "CORPORATE", label: <>Corporate <span className="text-muted">{count("CORPORATE")}</span></> },
          { key: "REQUESTS", label: <>Information Requests <span className="text-muted">{openRequests}</span></> }
        ]}
      >
        {tab === "REQUESTS" ? <RequestsTable db={db} /> : <ReturnQueue key={tab} query={query} kind={tab} />}
      </Tabs>
    </>
  );
}

function ReturnQueue({ query, kind }: { query: URLSearchParams; kind: "INDIVIDUAL" | "CORPORATE" }) {
  const db = useDb();
  const actor = useActor();
  const [status, setStatus] = useState<string>(query.get("status") ?? "ALL");
  const [assigned, setAssigned] = useState<string>(query.get("assigned") ?? "ALL");
  const [year, setYear] = useState<string>("ALL");
  const [req, setReq] = useState<string>("ALL");
  const [pay, setPay] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const all = caseRows(db);
  const years = [...new Set(all.map((r) => r.a.year))].sort((a, b) => b - a);
  const assessors = db.users.filter((u) => u.role === "ASSESSOR");
  const rows = all.filter(
    (r) =>
      r.a.returnKind === kind &&
      (status === "ALL" || (status === "OPEN" ? r.a.status !== "COMPLETED" : r.a.status === status)) &&
      (assigned === "ALL" || (assigned === "me" ? r.a.assignedTo === actor.id : assigned === "none" ? !r.a.assignedTo : r.a.assignedTo === assigned)) &&
      (year === "ALL" || r.a.year === Number(year)) &&
      (req === "ALL" || (req === "OPEN" ? r.openRequest : !r.openRequest)) &&
      (pay === "ALL" || r.paymentStatus === pay) &&
      (!q || `${r.name} ${r.reference}`.toLowerCase().includes(q.toLowerCase()))
  );
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-5">
          <label htmlFor="q" className="sr-only">Search</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input id="q" className="control pl-9" placeholder="Search taxpayer, company or reference" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <SelectField label="Financial year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="ALL">All</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </SelectField>
        <SelectField label="Assessment status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">All</option>
          <option value="OPEN">All open</option>
          {(["NOT_ASSIGNED", "ASSIGNED", "UNDER_REVIEW", "INFO_REQUIRED", "RESPONSE_RECEIVED", "COMPLETED"] as AssessmentStatus[]).map((s) => <option key={s} value={s}>{assessmentLabel(s)}</option>)}
        </SelectField>
        <SelectField label="Tax officer" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
          <option value="ALL">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Not assigned</option>
          {assessors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </SelectField>
        <SelectField label="Information request" value={req} onChange={(e) => setReq(e.target.value)}>
          <option value="ALL">Any</option>
          <option value="OPEN">Open request</option>
          <option value="NONE">No open request</option>
        </SelectField>
        <SelectField label="Payment" value={pay} onChange={(e) => setPay(e.target.value)}>
          <option value="ALL">Any</option>
          {(["UNPAID", "PENDING", "PARTIALLY_PAID", "PAID", "FAILED"] as const).map((s) => <option key={s} value={s}>{paymentLabel(s)}</option>)}
        </SelectField>
      </div>
      <p className="text-sm text-muted" role="status">{rows.length} of {all.filter((r) => r.a.returnKind === kind).length} returns</p>
      <CaseTable db={db} rows={rows} caption={kind === "INDIVIDUAL" ? "Individual returns" : "Corporate returns"} />
    </div>
  );
}

// ---------- Case review ----------

export function CasePage({ id }: { id: string }) {
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const a = db.assessments.find((x) => x.id === id);
  const [note, setNote] = useState("");
  const [verifyNote, setVerifyNote] = useState("");
  const [adj, setAdj] = useState({ label: "", amount: "", reason: "" });
  const [reqForm, setReqForm] = useState({ message: "", docs: "", due: addDays(today(), db.config.informationRequestDays) });
  const [summary, setSummary] = useState("");
  const [confirmComplete, setConfirmComplete] = useState(false);
  useDocumentTitle(a ? `Case ${caseLabel(db, a).reference}` : "Case");
  if (!a) return <Forbidden />;
  const ret = returnFor(db, a);
  if (!ret) return <Forbidden />;
  const { name, reference } = caseLabel(db, a);
  const mine = canActOnAssessment(actor, a);
  const locked = a.status === "COMPLETED";
  const requests = db.infoRequests.filter((r) => r.assessmentId === a.id);
  const openReq = requests.find((r) => r.status === "OPEN");
  const uploaded = db.documents.filter((d) => !d.generated && ((d.related.kind === "INDIVIDUAL_RETURN" || d.related.kind === "CORPORATE_RETURN") && d.related.id === ret.id || (d.related.kind === "INFO_REQUEST" && requests.some((r) => r.id === d.related.id))));
  const trail = db.audit.filter((e) => e.entityId === a.id || e.entityId === ret.id || requests.some((r) => r.id === e.entityId) || uploaded.some((d) => d.id === e.entityId));
  const calc = ret.calculation!;
  const adjTotal = a.adjustments.reduce((s, x) => s + x.amountMinor, 0);
  const prepaid = db.liabilities.filter((l) => l.source === "INDIVIDUAL_SELF_ASSESSMENT" && l.sourceId === a.returnId).reduce((s, l) => s + l.paidMinor, 0);
  const adjMinor = adj.amount.trim().startsWith("-") ? -(parseAmountInput(adj.amount.trim().slice(1)) ?? NaN) : parseAmountInput(adj.amount) ?? NaN;
  const owner: OwnerRef = a.owner;
  const party = owner.kind === "INDIVIDUAL" ? db.taxpayers.find((t) => t.id === owner.id) : undefined;
  const company = owner.kind === "COMPANY" ? db.companies.find((c) => c.id === owner.id) : undefined;

  return (
    <>
      <PageHeader title={reference} lead={`${a.returnKind === "INDIVIDUAL" ? "Individual" : "Corporate"} Income Tax Return ${a.year} · ${name}`} back={{ to: `/gmca/queue?tab=${a.returnKind === "INDIVIDUAL" ? "individual" : "corporate"}`, label: "Assessment of returns" }} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmissionBadge status="SUBMITTED" />
        <AssessmentBadge status={a.status} />
        <span className="text-sm text-muted">Tax officer: {userName(db, a.assignedTo)}</span>
      </div>

      {!a.assignedTo && !locked ? (
        <Alert tone="review" title="Not assigned" action={<Button size="sm" onClick={() => run((d, ac) => assignToMe(d, ac, a.id), "Case assigned to you")}><UserCheck /> Assign to me</Button>}>
          Assign the case to yourself to review and assess it.
        </Alert>
      ) : null}
      {a.assignedTo && !mine && !locked ? <Alert tone="review">Assigned to {userName(db, a.assignedTo)}. You can read it, but only the assigned officer can act on it.</Alert> : null}
      {mine && (a.status === "ASSIGNED" || a.status === "RESPONSE_RECEIVED") ? (
        <Alert tone="action" title={a.status === "RESPONSE_RECEIVED" ? "The taxpayer responded" : "Ready for review"} action={<Button size="sm" onClick={() => run((d, ac) => startReview(d, ac, a.id), "Review started")}>{a.status === "RESPONSE_RECEIVED" ? "Resume review" : "Start review"}</Button>}>
          {a.status === "RESPONSE_RECEIVED" ? "Read the response and documents below, then resume the review." : "Starting the review tells the taxpayer their return is being looked at."}
        </Alert>
      ) : null}

      <div className="grid gap-10 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-10 2xl:order-1">
          <Section title={party ? "Taxpayer" : "Company"}>
            <div className="panel p-5">
              {party ? (
                <KeyValue rows={[{ label: "Name", value: party.fullName }, { label: "TIN", value: party.tin }, { label: "Category", value: party.category === "CITIZEN" ? "Bhutanese citizen" : `Foreign national (${party.nationality})` }, { label: "Identifier", value: maskId(party.identifierValue) }, { label: "Residency (recorded by GMCA)", value: party.residencyStatus.replace("_", " ").toLowerCase() }, { label: "Verified", value: <span className="flex items-center gap-2">{party.verification.provider}</span> }]} />
              ) : company ? (
                <KeyValue rows={[{ label: "Name", value: company.name }, { label: "UEN", value: company.uen }, { label: "Type", value: company.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company" }, { label: "Sector", value: company.sector }]} />
              ) : null}
            </div>
          </Section>

          {a.returnKind === "INDIVIDUAL" && "taxpayerId" in ret ? (
            <>
              <FiledDeclarations db={db} ret={ret} />
              <CalcBreakdown snapshot={calc} title="System calculation (as submitted)" />
            </>
          ) : "companyId" in ret ? (
            <CorporateReturnDetail db={db} ret={ret} staffView />
          ) : null}

          <Section title="Evidence review" description="Mark each uploaded document. This is recorded in the audit trail and shown to the taxpayer.">
            <DataTable
              caption="Uploaded documents"
              rows={uploaded}
              rowKey={(d) => d.id}
              minWidth="48rem"
              empty="No uploaded documents."
              columns={[
                { key: "f", header: "Document", cell: (d) => <DocLink doc={d}>{d.fileName}</DocLink> },
                { key: "t", header: "Type", cell: (d) => CATEGORY_LABEL[d.category] },
                { key: "s", header: "Status", cell: (d) => <DocReviewBadge status={d.reviewStatus} /> },
                {
                  key: "a",
                  header: "Mark as",
                  cell: (d: TaxDocument) =>
                    mine && !locked ? (
                      <select aria-label={`Review status for ${d.fileName}`} className="control h-8 w-44 text-sm" value={d.reviewStatus} onChange={(e) => run((db2, ac) => setDocumentReview(db2, ac, d.id, e.target.value as DocumentReviewStatus))}>
                        <option value="UPLOADED">Uploaded</option>
                        <option value="UNDER_REVIEW">Under review</option>
                        <option value="ACCEPTED">Accepted</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="EVIDENCE_REQUIRED">More evidence required</option>
                      </select>
                    ) : (
                      <span className="text-muted">—</span>
                    )
                }
              ]}
            />
          </Section>

          <Section title="Information requests">
            {requests.length === 0 ? <p className="text-sm text-muted">None sent.</p> : null}
            {requests.map((r) => (
              <div key={r.id} className="panel grid gap-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.reference}</span>
                  <StatusBadge tone={r.status === "OPEN" ? "action" : r.status === "RESPONDED" ? "review" : "neutral"}>{r.status === "OPEN" ? `Open · due ${formatDate(r.dueDate, "short")}` : r.status === "RESPONDED" ? "Responded" : "Closed"}</StatusBadge>
                </div>
                <p className="text-sm">{r.message}</p>
                {r.requiredDocuments.length ? <p className="text-xs text-muted">Requested: {r.requiredDocuments.join(", ")}</p> : null}
                {r.response ? (
                  <div className="border-t border-line-soft pt-3 text-sm">
                    <p className="text-xs text-muted">Response from {userName(db, r.response.by)}, {formatDateTime(r.response.at)}</p>
                    <p className="mt-1">{r.response.message}</p>
                    <ul className="mt-2 grid gap-1">{r.response.docIds.map((x) => { const doc = db.documents.find((dd) => dd.id === x); return doc ? <li key={x}><DocLink doc={doc}>{doc.fileName}</DocLink></li> : null; })}</ul>
                  </div>
                ) : null}
                {mine && r.status === "RESPONDED" ? <Button size="sm" variant="secondary" className="w-fit" onClick={() => run((d, ac) => closeRequest(d, ac, r.id), "Request closed")}>Close request</Button> : null}
              </div>
            ))}
          </Section>

          <Section title="Case history" description="Every action on this return, who did it and when.">
            <ol className="grid border border-line bg-surface">
              {trail.map((e) => (
                <li key={e.id} className="grid gap-0.5 border-b border-line-soft px-5 py-3 text-sm last:border-0 sm:grid-cols-[11rem_1fr]">
                  <span className="text-xs text-muted">{formatDateTime(e.at)}</span>
                  <span>
                    <span className="font-medium">{e.actorName}</span> · {e.summary}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="order-first grid content-start gap-6 md:grid-cols-2 2xl:order-2 2xl:sticky 2xl:top-6 2xl:grid-cols-1">
          <div className="grid gap-3 border border-line bg-surface p-5">
            <h2 className="font-medium">Assessment figures</h2>
            <KeyValue rows={[{ label: "System calculated tax", value: formatMoney(calc.taxMinor) }, { label: "Adjustments", value: formatMoney(adjTotal) }, { label: "Tax to assess", value: <strong>{formatMoney(Math.max(0, calc.taxMinor + adjTotal))}</strong> }, { label: "Credits (TDS)", value: formatMoney(calc.creditsMinor) }, { label: "Paid with return", value: formatMoney(prepaid) }, { label: "Balance", value: formatMoney(Math.max(0, calc.taxMinor + adjTotal) - calc.creditsMinor - prepaid) }]} />
            {a.calculationVerified ? (
              <p className={cn("text-sm", a.calculationVerified.result === "VERIFIED" ? "text-ok-fg" : "text-act-fg")}>
                {a.calculationVerified.result === "VERIFIED" ? "Calculation verified" : `Issue flagged: ${a.calculationVerified.note}`} · {userName(db, a.calculationVerified.by)}
              </p>
            ) : null}
            {a.outcome ? (
              <div className="grid gap-2 border-t border-line-soft pt-3 text-sm">
                <p className="font-medium text-ok-fg">Assessment completed {formatDate(a.outcome.at)}</p>
                <p>{a.outcome.summary}</p>
                {a.noaDocId ? <DocLink doc={db.documents.find((d) => d.id === a.noaDocId)!}>Notice of Assessment</DocLink> : null}
              </div>
            ) : null}
          </div>

          {mine && a.status === "UNDER_REVIEW" ? (
            <>
              <form className="grid gap-3 border border-line bg-surface p-5" onSubmit={(e) => e.preventDefault()}>
                <h2 className="font-medium">Verify the calculation</h2>
                <TextArea label="Note (needed to flag an issue)" rows={2} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => run((d, ac) => recordVerification(d, ac, a.id, "VERIFIED", verifyNote), "Calculation verified")}><CheckCircle2 /> Verified</Button>
                  <Button size="sm" variant="secondary" onClick={() => run((d, ac) => recordVerification(d, ac, a.id, "ISSUE_FLAGGED", verifyNote), "Issue flagged")}><Flag /> Flag issue</Button>
                </div>
              </form>

              <form
                className="grid gap-3 border border-line bg-surface p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (run((d, ac) => addAdjustment(d, ac, a.id, adj.label, adjMinor, adj.reason), "Adjustment recorded") !== undefined) setAdj({ label: "", amount: "", reason: "" });
                }}
              >
                <h2 className="font-medium">Assessment adjustment</h2>
                <p className="text-xs text-muted">Changes the assessed tax, never the taxpayer's declaration. Use − for a reduction.</p>
                <TextField label="What is adjusted" value={adj.label} onChange={(e) => setAdj({ ...adj, label: e.target.value })} />
                <TextField label={`Tax effect (${db.config.reportingCurrency})`} inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value.replace("−", "-") })} />
                <TextArea label="Reason" rows={2} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                <Button size="sm" type="submit" variant="secondary">Record adjustment</Button>
              </form>

              {!openReq ? (
                <form
                  className="grid gap-3 border border-line bg-surface p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (run((d, ac) => requestInformation(d, ac, a.id, reqForm.message, reqForm.docs.split("\n"), reqForm.due), "Request sent to the taxpayer")) setReqForm({ ...reqForm, message: "", docs: "" });
                  }}
                >
                  <h2 className="font-medium">Request additional information</h2>
                  <TextArea label="Message to the taxpayer" rows={3} value={reqForm.message} onChange={(e) => setReqForm({ ...reqForm, message: e.target.value })} />
                  <TextArea label="Documents needed (one per line)" rows={2} value={reqForm.docs} onChange={(e) => setReqForm({ ...reqForm, docs: e.target.value })} />
                  <TextField label="Respond by" type="date" value={reqForm.due} min={today()} onChange={(e) => setReqForm({ ...reqForm, due: e.target.value })} hint={`Default is ${db.config.informationRequestDays} days (demo setting, not a statutory deadline).`} />
                  <Button size="sm" type="submit" variant="secondary"><MessageSquarePlus /> Send request</Button>
                </form>
              ) : null}

              <div className="grid gap-3 border border-primary bg-surface p-5">
                <h2 className="font-medium">Complete the assessment</h2>
                <TextArea label="Outcome summary (shown on the notice)" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
                {!confirmComplete ? (
                  <Button onClick={() => setConfirmComplete(true)} disabled={!a.calculationVerified || !summary.trim()}>Complete and issue notice</Button>
                ) : (
                  <div className="grid gap-2 border border-act-line bg-act-bg p-3 text-sm text-act-fg">
                    <p>Issue a Notice of Assessment for {formatMoney(Math.max(0, calc.taxMinor + adjTotal))}? The case will be locked.</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => run((d, ac) => completeAssessment(d, ac, a.id, summary), "Assessment completed and notice issued")}>Yes, issue</Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmComplete(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {!a.calculationVerified ? <p className="text-xs text-muted">Verify the calculation first.</p> : null}
              </div>
            </>
          ) : null}

          {mine && !locked ? (
            <form
              className="grid gap-3 border border-line bg-surface p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (run((d, ac) => addNote(d, ac, a.id, note), "Note added") !== undefined) setNote("");
              }}
            >
              <h2 className="font-medium">Review notes</h2>
              <TextArea label="Add a note (internal)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" type="submit" variant="secondary">Add note</Button>
            </form>
          ) : null}
          {a.notes.length || a.adjustments.length ? (
            <div className="grid gap-3 border border-line bg-surface p-5 text-sm">
              {a.adjustments.map((x) => (
                <p key={x.id}><span className="font-medium">Adjustment · {x.label}</span> {formatMoney(x.amountMinor)}<br /><span className="text-muted">{x.reason} · {userName(db, x.by)}</span></p>
              ))}
              {a.notes.map((n) => (
                <p key={n.id}>{n.text}<br /><span className="text-xs text-muted">{userName(db, n.by)}, {formatDateTime(n.at)}</span></p>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

// ---------- Requests ----------

function RequestsTable({ db }: { db: Db }) {
  const rows = [...db.infoRequests].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">Requests sent to taxpayers and their responses. Open one to go to its return.</p>
      <DataTable
        caption="Information requests"
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/gmca/cases/${r.assessmentId}`)}
        empty="No information requests yet."
        minWidth="56rem"
        columns={[
          { key: "r", header: "Request", cell: (r) => <Link className="text-brand-ink underline-offset-4 hover:underline" to={`/gmca/cases/${r.assessmentId}`}>{r.reference}</Link> },
          { key: "w", header: "Taxpayer", cell: (r) => ownerName(db, r.owner) },
          { key: "s", header: "Sent", cell: (r) => formatDate(r.requestedAt, "short") },
          { key: "d", header: "Due", cell: (r) => <span className={cn(r.status === "OPEN" && r.dueDate < today() && "font-medium text-rej-fg")}>{formatDate(r.dueDate, "short")}{r.status === "OPEN" && r.dueDate < today() ? " (overdue)" : ""}</span> },
          { key: "b", header: "By", cell: (r) => userName(db, r.requestedBy) },
          { key: "st", header: "Status", cell: (r) => <StatusBadge tone={r.status === "OPEN" ? "action" : r.status === "RESPONDED" ? "review" : "neutral"}>{r.status === "OPEN" ? "Waiting" : r.status === "RESPONDED" ? "Response received" : "Closed"}</StatusBadge> }
        ]}
      />
    </div>
  );
}

// ---------- Taxpayers ----------

export function TaxpayersPage() {
  useDocumentTitle("Taxpayers & companies");
  const db = useDb();
  const [q, setQ] = useState("");
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const base = "/gmca/taxpayers";
  const [tab, setTab] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const people = db.taxpayers.filter((t) => match(`${t.fullName} ${t.tin}`));
  const companies = db.companies.filter((c) => match(`${c.name} ${c.uen}`));
  return (
    <>
      <PageHeader title="Taxpayers & companies" lead="Registered individuals and companies. Identifiers are masked in lists. Open a record to see its returns and payments, or to record tax residency." />
      <div className="relative max-w-sm">
        <label htmlFor="tq" className="sr-only">Search</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
        <input id="tq" className="control pl-9" placeholder="Search name, TIN or UEN" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Tabs label="Taxpayer type" value={tab} onChange={setTab} tabs={[{ key: "INDIVIDUAL", label: <>Individuals <span className="text-muted">{people.length}</span></> }, { key: "COMPANY", label: <>Companies <span className="text-muted">{companies.length}</span></> }]}>
        {tab === "INDIVIDUAL" ? (
        <DataTable
          caption="Individuals"
          rows={people}
          rowKey={(t) => t.id}
          onRowClick={(t) => navigate(`${base}/INDIVIDUAL/${t.id}`)}
          minWidth="52rem"
          columns={[
            { key: "n", header: "Name", cell: (t) => <Link className="text-brand-ink underline-offset-4 hover:underline" to={`${base}/INDIVIDUAL/${t.id}`}>{t.fullName}</Link> },
            { key: "t", header: "TIN", cell: (t) => t.tin },
            { key: "c", header: "Category", cell: (t) => (t.category === "CITIZEN" ? "Citizen" : `Foreign (${t.nationality})`) },
            { key: "r", header: "Residency", cell: (t) => t.residencyStatus.replace("_", " ").toLowerCase() },
            { key: "f", header: "Returns filed", align: "right", cell: (t) => db.individualReturns.filter((r) => r.taxpayerId === t.id && r.submissionStatus === "SUBMITTED").length }
          ]}
        />
        ) : (
        <DataTable
          caption="Companies"
          rows={companies}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`${base}/COMPANY/${c.id}`)}
          minWidth="52rem"
          columns={[
            { key: "n", header: "Name", cell: (c) => <Link className="text-brand-ink underline-offset-4 hover:underline" to={`${base}/COMPANY/${c.id}`}>{c.name}</Link> },
            { key: "u", header: "UEN", cell: (c) => c.uen },
            { key: "t", header: "Type", cell: (c) => (c.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company") },
            { key: "e", header: "Employees", align: "right", cell: (c) => db.employees.filter((e) => e.companyId === c.id && e.status !== "LEFT").length },
            { key: "d", header: "Declarations filed", align: "right", cell: (c) => db.monthlyDeclarations.filter((d) => d.companyId === c.id && d.submissionStatus === "SUBMITTED").length }
          ]}
        />
        )}
      </Tabs>
    </>
  );
}

/** Taxpayer record for tax officers, with the residency determination for individuals. */
export function OfficerTaxpayerDetail({ kind, id }: { kind: string; id: string }) {
  const db = useDb();
  const run = useRun();
  const t = kind === "INDIVIDUAL" ? db.taxpayers.find((x) => x.id === id) : undefined;
  const [status, setStatus] = useState<ResidencyStatus>(t?.residencyStatus ?? "NOT_DETERMINED");
  const [reason, setReason] = useState("");
  const slot = t ? (
    <Section title="Tax residency" description="Recorded by GMCA. It decides whether the configured non-resident treatment applies. Nationality alone must not be used.">
      <form
        className="grid max-w-2xl gap-4 border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (run((d, a) => setResidency(d, a, t.id, status, reason), "Residency recorded") !== undefined) setReason("");
        }}
      >
        <SelectField label="Residency status" value={status} onChange={(e) => setStatus(e.target.value as ResidencyStatus)}>
          <option value="NOT_DETERMINED">Not determined</option>
          <option value="RESIDENT">Resident</option>
          <option value="NON_RESIDENT">Non-resident</option>
        </SelectField>
        <TextArea label="Basis for the determination" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded in the audit log. GMCA's residency rules are still to be confirmed." />
        <div><Button type="submit">Record residency</Button></div>
      </form>
    </Section>
  ) : null;
  return <TaxpayerDetail kind={kind} id={id} adminSlot={slot} />;
}

function TaxpayerDetail({ kind, id, adminSlot }: { kind: string; id: string; adminSlot?: React.ReactNode }) {
  const db = useDb();
  const owner: OwnerRef | null = kind === "INDIVIDUAL" ? { kind: "INDIVIDUAL", id } : kind === "COMPANY" ? { kind: "COMPANY", id } : null;
  const name = owner ? ownerName(db, owner) : "";
  useDocumentTitle(name || "Taxpayer");
  if (!owner) return <Forbidden />;
  const t = owner.kind === "INDIVIDUAL" ? db.taxpayers.find((x) => x.id === id) : undefined;
  const c = owner.kind === "COMPANY" ? db.companies.find((x) => x.id === id) : undefined;
  if (!t && !c) return <Forbidden />;
  const cases = caseRows(db).filter((r) => r.a.owner.kind === owner.kind && r.a.owner.id === owner.id);
  const liabilities = db.liabilities.filter((l) => l.owner.kind === owner.kind && l.owner.id === owner.id);
  const payments = db.payments.filter((p) => liabilities.some((l) => l.id === p.liabilityId));
  return (
    <>
      <PageHeader title={name} lead={t ? `${t.tin} · ${t.category === "CITIZEN" ? "Bhutanese citizen" : `Foreign national (${t.nationality})`}` : `${c!.uen} · ${c!.sector}`} back={{ to: "/gmca/taxpayers", label: "Taxpayers & companies" }} />
      <div className="panel p-5">
        {t ? (
          <KeyValue rows={[{ label: "Identifier", value: `${t.identifierType.replace("_", " ").toLowerCase()} ${maskId(t.identifierValue)}` }, { label: "Date of birth", value: formatDate(t.dateOfBirth) }, { label: "Email", value: t.email }, { label: "Phone", value: t.phone }, { label: "Residency", value: t.residencyStatus.replace("_", " ").toLowerCase() }, { label: "Registered", value: formatDate(t.registeredAt) }]} />
        ) : (
          <KeyValue rows={[{ label: "Type", value: c!.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company" }, { label: "Address", value: c!.registeredAddress }, { label: "Representatives", value: c!.representatives.map((r) => `${r.name} (${r.designation})`).join(", ") }, { label: "Incentive", value: db.incentives.filter((i) => i.companyId === c!.id && i.status === "ACTIVE").map((i) => `${i.ratePct}% (${i.approvalReference})`).join(", ") || "None" }]} />
        )}
      </div>
      {adminSlot}
      <Section title="Returns">
        <CaseTable db={db} rows={cases} caption="Returns" />
      </Section>
      {c ? (
        <Section title="Monthly declarations">
          <DataTable caption="Declarations" rows={db.monthlyDeclarations.filter((d) => d.companyId === c.id).sort((a, b) => b.period.localeCompare(a.period))} rowKey={(d) => d.id} columns={[{ key: "p", header: "Month", cell: (d) => formatPeriod(d.period) }, { key: "r", header: "Reference", cell: (d) => d.reference ?? "—" }, { key: "n", header: "Employees", align: "right", cell: (d) => d.lines.length }, { key: "t", header: "Total", align: "right", cell: (d) => formatMoney(d.calculation?.balanceMinor ?? 0) }, { key: "s", header: "Filing", cell: (d) => <SubmissionBadge status={d.submissionStatus} /> }, { key: "pay", header: "Payment", cell: (d) => { const l = db.liabilities.find((x) => x.id === d.liabilityId); if (!l) return <span className="text-muted">—</span>; const ev = db.payments.find((p) => p.liabilityId === l.id && p.method === "EVIDENCE"); const doc = ev?.evidenceDocId ? db.documents.find((x) => x.id === ev.evidenceDocId) : undefined; return ev ? <span className="grid gap-0.5"><StatusBadge tone="review">Paid · evidence to verify</StatusBadge>{doc ? <DocLink doc={doc}>{ev.bankTransactionRef}</DocLink> : null}</span> : <PaymentBadge status={liabilityStatus(db, l)} />; } }]} />
        </Section>
      ) : null}
      <Section title="Payments">
        <PaymentHistoryTable db={db} payments={payments} />
      </Section>
    </>
  );
}

// ---------- Payments and reconciliation ----------

export function GmcaPaymentsPage() {
  useDocumentTitle("Payments & liabilities");
  const db = useDb();
  const [status, setStatus] = useState("ALL");
  const rows = db.liabilities.map((l) => ({ l, status: liabilityStatus(db, l) })).filter((r) => status === "ALL" || r.status === status).sort((a, b) => b.l.createdAt.localeCompare(a.l.createdAt));
  const payments = [...db.payments].sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  const confirmed = payments.filter((p) => p.status === "SUCCESS");
  const matched = confirmed.filter((p) => p.bankTransactionRef && db.integrationEvents.some((e) => e.provider === "DK_BANK" && e.reference === p.bankTransactionRef));
  return (
    <>
      <PageHeader title="Payments & outstanding liabilities" lead="Payment status is tracked separately from filing and assessment." />
      <MetricStrip
        items={[
          { label: "Collected", value: formatMoney(confirmed.reduce((s, p) => s + p.amountMinor, 0)) },
          { label: "Outstanding", value: formatMoney(db.liabilities.reduce((s, l) => s + outstanding(l), 0)) },
          { label: "Pending with bank", value: payments.filter((p) => p.status === "PENDING").length },
          { label: "Reconciled", value: `${matched.length} of ${confirmed.length}`, hint: "Confirmed payments matched to a bank event" }
        ]}
      />
      <Section title="Liabilities" actions={<SelectField label="Payment status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48"><option value="ALL">All</option>{(["UNPAID", "PENDING", "PARTIALLY_PAID", "PAID", "FAILED"] as const).map((s) => <option key={s} value={s}>{paymentLabel(s)}</option>)}</SelectField>}>
        <DataTable
          caption="Liabilities"
          rows={rows}
          rowKey={(r) => r.l.id}
          onRowClick={(r) => navigate(`/gmca/payments/${r.l.id}`)}
          minWidth="56rem"
          columns={[
            { key: "r", header: "Reference", cell: (r) => <Link className="font-medium text-brand-ink underline-offset-4 hover:underline" to={`/gmca/payments/${r.l.id}`}>{r.l.reference}</Link> },
            { key: "w", header: "Taxpayer", cell: (r) => ownerName(db, r.l.owner) },
            { key: "d", header: "For", cell: (r) => r.l.description },
            { key: "a", header: "Amount", align: "right", cell: (r) => formatMoney(r.l.amountMinor) },
            { key: "o", header: "Outstanding", align: "right", cell: (r) => formatMoney(outstanding(r.l)) },
            { key: "s", header: "Status", cell: (r) => <PaymentBadge status={r.status} /> }
          ]}
        />
      </Section>
      <Section title="Reconciliation" description="Each confirmed payment is matched to its DK Bank settlement event by transaction reference.">
        <DataTable
          caption="Reconciliation"
          rows={payments.slice(0, 40)}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/gmca/payments/${p.liabilityId}`)}
          minWidth="56rem"
          columns={[
            { key: "d", header: "Date", cell: (p) => formatDateTime(p.initiatedAt) },
            { key: "w", header: "Taxpayer", cell: (p) => { const l = db.liabilities.find((x) => x.id === p.liabilityId); return l ? ownerName(db, l.owner) : "—"; } },
            { key: "a", header: "Amount", align: "right", cell: (p) => formatMoney(p.amountMinor) },
            { key: "b", header: "Bank reference", cell: (p) => <span className="num text-xs">{p.bankTransactionRef ?? p.intentReference}</span> },
            { key: "s", header: "Status", cell: (p) => p.status.toLowerCase() },
            { key: "m", header: "Match", cell: (p) => (p.status === "SUCCESS" ? (matched.includes(p) ? <StatusBadge tone="approved">Matched</StatusBadge> : <StatusBadge tone="rejected">Unmatched</StatusBadge>) : <span className="text-muted">—</span>) }
          ]}
        />
      </Section>
    </>
  );
}

const SOURCE_LABEL: Record<Liability["source"], string> = {
  INDIVIDUAL_SELF_ASSESSMENT: "Individual return (tax due on filing)",
  INDIVIDUAL_ASSESSMENT: "Individual assessment",
  CORPORATE_ASSESSMENT: "Corporate assessment",
  MONTHLY_DECLARATION: "Monthly TDS & Health declaration"
};

/** One liability: what it is for, who owes it, every payment attempt and how each was reconciled. */
export function LiabilityDetail({ id }: { id: string }) {
  const db = useDb();
  const l = db.liabilities.find((x) => x.id === id);
  useDocumentTitle(l ? `Liability ${l.reference}` : "Liability");
  if (!l) return <Forbidden />;
  const status = liabilityStatus(db, l);
  const payments = db.payments.filter((p) => p.liabilityId === l.id).sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  const isMatched = (p: Payment) => !!p.bankTransactionRef && db.integrationEvents.some((e) => e.provider === "DK_BANK" && e.reference === p.bankTransactionRef);
  const caseId = l.source === "INDIVIDUAL_ASSESSMENT" || l.source === "CORPORATE_ASSESSMENT" ? l.sourceId : l.source === "INDIVIDUAL_SELF_ASSESSMENT" ? db.assessments.find((a) => a.returnId === l.sourceId)?.id : undefined;
  const decl = l.source === "MONTHLY_DECLARATION" ? db.monthlyDeclarations.find((d) => d.id === l.sourceId) : undefined;
  const ownerPath = `/gmca/taxpayers/${l.owner.kind}/${l.owner.id}`;
  const evidence = payments.filter((p) => p.method === "EVIDENCE");
  return (
    <>
      <PageHeader title={l.reference} lead={`${l.description} · ${ownerName(db, l.owner)}`} back={{ to: "/gmca/payments", label: "Payments & liabilities" }} />
      <div className="flex flex-wrap items-center gap-2">
        <PaymentBadge status={status} />
        {evidence.length ? <StatusBadge tone="review">Paid in DK Bank · evidence to verify</StatusBadge> : null}
      </div>
      <MetricStrip
        items={[
          { label: "Amount due", value: formatMoney(l.amountMinor, l.currency) },
          { label: "Paid", value: formatMoney(l.paidMinor, l.currency) },
          { label: "Outstanding", value: formatMoney(outstanding(l), l.currency) },
          { label: "Payment attempts", value: payments.length, hint: `${payments.filter((p) => p.status === "SUCCESS").length} confirmed` }
        ]}
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Liability">
          <div className="panel p-5">
            <KeyValue
              rows={[
                { label: "Taxpayer", value: <Link className="text-brand-ink underline-offset-4 hover:underline" to={ownerPath}>{ownerName(db, l.owner)}</Link> },
                { label: "Raised from", value: SOURCE_LABEL[l.source] },
                { label: "For", value: l.description },
                { label: "Raised on", value: formatDate(l.createdAt) },
                ...(decl ? [{ label: "Declaration", value: `${decl.reference ?? "—"} · ${formatPeriod(decl.period)} · ${decl.lines.length} employees` }] : [])
              ]}
            />
          </div>
        </Section>
        <Section title="Next step">
          <div className="grid content-start gap-3 border border-line bg-surface p-5 text-sm">
            {status === "PAID" ? <p>Paid in full. Check the bank reference on each payment below against the DK Bank settlement report.</p> : status === "PENDING" ? <p>DK Bank hasn't confirmed a payment yet. It updates here when the bank answers.</p> : <p>{formatMoney(outstanding(l), l.currency)} is still owed. The taxpayer can pay it from their Payments page.</p>}
            {evidence.length ? <p>The taxpayer paid in DK Bank before submitting and uploaded the receipt. Check the receipt below against the bank statement.</p> : null}
            <div className="flex flex-wrap gap-3">
              {caseId ? <Button size="sm" variant="secondary" onClick={() => navigate(`/gmca/cases/${caseId}`)}>Open the return</Button> : null}
              <Button size="sm" variant="secondary" onClick={() => navigate(ownerPath)}>Open taxpayer record</Button>
            </div>
          </div>
        </Section>
      </div>
      <Section title="Payments" description="Every attempt, including declined and pending ones.">
        <DataTable
          caption="Payment attempts"
          rows={payments}
          rowKey={(p) => p.id}
          minWidth="56rem"
          empty="No payment has been made yet."
          columns={[
            { key: "d", header: "Date", cell: (p) => formatDateTime(p.initiatedAt) },
            { key: "a", header: "Amount", align: "right", cell: (p) => formatMoney(p.amountMinor, p.currency) },
            { key: "m", header: "Method", cell: (p) => (p.method === "EVIDENCE" ? "Paid in DK Bank, receipt uploaded" : "DK Bank through the portal") },
            { key: "b", header: "Bank reference", cell: (p) => <span className="num text-xs">{p.bankTransactionRef ?? p.intentReference}</span> },
            { key: "s", header: "Status", cell: (p) => <StatusBadge tone={p.status === "SUCCESS" ? "approved" : p.status === "FAILED" ? "rejected" : "action"}>{p.status === "SUCCESS" ? "Confirmed" : p.status === "FAILED" ? `Declined${p.failureReason ? `: ${p.failureReason}` : ""}` : "Pending"}</StatusBadge> },
            { key: "r", header: "Reconciliation", cell: (p) => (p.status !== "SUCCESS" ? <span className="text-muted">—</span> : p.method === "EVIDENCE" ? <StatusBadge tone="review">To verify</StatusBadge> : isMatched(p) ? <StatusBadge tone="approved">Matched</StatusBadge> : <StatusBadge tone="rejected">Unmatched</StatusBadge>) },
            { key: "doc", header: "Document", cell: (p) => { const doc = db.documents.find((x) => x.id === (p.evidenceDocId ?? p.receiptDocId)); return doc ? <DocLink doc={doc}>{p.method === "EVIDENCE" ? "Payment receipt" : "Receipt"}</DocLink> : <span className="text-muted">—</span>; } }
          ]}
        />
      </Section>
    </>
  );
}

// ---------- Documents ----------

export function GmcaDocumentsPage() {
  useDocumentTitle("Documents & correspondence");
  const db = useDb();
  const [cat, setCat] = useState("ALL");
  const docs = db.documents.filter((d) => cat === "ALL" || d.category === cat);
  return (
    <>
      <PageHeader title="Documents & correspondence" lead="The shared document repository: taxpayer uploads and everything GMCA has issued." />
      <SelectField label="Type" value={cat} onChange={(e) => setCat(e.target.value)} className="w-72">
        <option value="ALL">All types</option>
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </SelectField>
      <DocumentTable db={db} docs={docs.slice(0, 200)} showOwner />
      {docs.length > 200 ? <p className="text-sm text-muted">Showing the latest 200 of {docs.length}.</p> : null}
    </>
  );
}

// ---------- Reports ----------

function csv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  useDocumentTitle("Reports");
  const db = useDb();
  const [year, setYear] = useState(String(db.config.currentFilingYear));
  const y = Number(year);
  const filedInd = new Set(db.individualReturns.filter((r) => r.year === y && r.submissionStatus === "SUBMITTED").map((r) => r.taxpayerId));
  const nonFilers = db.taxpayers.filter((t) => !filedInd.has(t.id));
  const assessors = db.users.filter((u) => u.role === "ASSESSOR");
  const reports = [
    {
      key: "filing",
      title: "Filing activity",
      rows: [["Return", "Taxpayer", "Year", "Submitted", "Assessment"], ...db.assessments.filter((a) => a.year === y).map((a) => { const r = returnFor(db, a); return [caseLabel(db, a).reference, caseLabel(db, a).name, a.year, r?.submittedAt?.slice(0, 10) ?? "", assessmentLabel(a.status)]; })]
    },
    { key: "nonfilers", title: "Non-filers / outstanding returns", rows: [["Taxpayer", "TIN", "Category"], ...nonFilers.map((t) => [t.fullName, t.tin, t.category])] },
    { key: "workload", title: "Assessment workload", rows: [["Tax officer", "Open", "Completed"], ...assessors.map((u) => [u.name, db.assessments.filter((a) => a.assignedTo === u.id && a.status !== "COMPLETED").length, db.assessments.filter((a) => a.assignedTo === u.id && a.status === "COMPLETED").length]), ["Not assigned", db.assessments.filter((a) => !a.assignedTo).length, 0]] },
    { key: "collected", title: "Payments collected", rows: [["Date", "Taxpayer", "Liability", "Amount", "Bank reference"], ...db.payments.filter((p) => p.status === "SUCCESS" && p.settledAt?.startsWith(year)).map((p) => { const l = db.liabilities.find((x) => x.id === p.liabilityId)!; return [p.settledAt!.slice(0, 10), ownerName(db, l.owner), l.reference, (p.amountMinor / 100).toFixed(2), p.bankTransactionRef ?? ""]; })] },
    { key: "outstanding", title: "Outstanding liabilities", rows: [["Liability", "Taxpayer", "For", "Outstanding", "Status"], ...db.liabilities.filter((l) => outstanding(l) > 0).map((l) => [l.reference, ownerName(db, l.owner), l.description, (outstanding(l) / 100).toFixed(2), paymentLabel(liabilityStatus(db, l))])] },
    { key: "taxpayers", title: "Taxpayer and company list", rows: [["Name", "Identifier", "Type"], ...db.taxpayers.map((t) => [t.fullName, t.tin, t.category === "CITIZEN" ? "Individual (citizen)" : "Individual (foreign)"]), ...db.companies.map((c) => [c.name, c.uen, c.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company"])] }
  ];
  const [open, setOpen] = useState("filing");
  const current = reports.find((r) => r.key === open)!;
  return (
    <>
      <PageHeader title="Reports" lead="Filter by financial year and export to CSV. Late-filing reports need deadline rules, which are not configured yet." />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Financial year" value={year} onChange={(e) => setYear(e.target.value)} className="w-40">
          {[db.config.currentFilingYear, db.config.currentFilingYear - 1].map((v) => <option key={v} value={v}>{v}</option>)}
        </SelectField>
      </div>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <ul className="grid content-start gap-1" role="tablist" aria-label="Reports">
          {reports.map((r) => (
            <li key={r.key}>
              <button type="button" role="tab" aria-selected={open === r.key} onClick={() => setOpen(r.key)} className={cn("flex w-full items-center justify-between border px-3 py-2 text-left text-sm", open === r.key ? "border-brand-200 bg-brand-50 font-medium text-brand-ink" : "border-transparent text-fg-2 hover:bg-sunk")}>
                {r.title} <span className="num text-xs text-muted">{r.rows.length - 1}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="grid min-w-0 content-start gap-3" role="tabpanel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-xl">{current.title}</h2>
            <Button size="sm" variant="secondary" onClick={() => download(`${current.key}-${year}.csv`, csv(current.rows))}>
              <Download /> Export CSV
            </Button>
          </div>
          <DataTable caption={current.title} rows={current.rows.slice(1).map((r, i) => ({ i, r }))} rowKey={(x) => String(x.i)} columns={current.rows[0]!.map((h, ci) => ({ key: String(ci), header: String(h), cell: (x: { r: (string | number)[] }) => String(x.r[ci]) }))} empty="No rows for this year." />
        </div>
      </div>
    </>
  );
}
