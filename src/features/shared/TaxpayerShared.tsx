import { Download, FileText, Inbox, Landmark, Lock, Printer, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, navigate, useActor, useDb, useDocumentTitle, useRun, useSession } from "../../app/core";
import { canViewOwner, requireDocument } from "../../domain/permissions";
import { ServiceError, type Actor } from "../../domain/store";
import type { Db, Payment, TaxDocument } from "../../domain/types";
import { formatDate, formatDateTime, formatPeriod } from "../../lib/format";
import { formatAmount, formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { caseLabel, respondToRequest } from "../../services/assessment";
import { CATEGORY_LABEL } from "../../services/documents";
import { initiatePayment, liabilityStatus, outstanding, recheckPayment, settlePayment } from "../../services/payments";
import { Button } from "../../shared/gmc/Button";
import { TextArea, TextField } from "../../shared/gmc/Form";
import { Alert, EmptyState, StatusBadge } from "../../shared/gmc/Layout";
import { DkBankLogo } from "../../shared/gmc/DkBankLogo";
import { DemoQr } from "../../shared/gmc/Qr";
import { DataTable } from "../../shared/gmc/Table";
import { DocReviewBadge, KeyValue, MetricStrip, PageHeader, PaymentBadge, RecordUpload, Section, ownerName, userName } from "./ui";
import { documentsFor, isRead, liabilitiesFor, notificationsFor, ownerOf, paymentsFor } from "./queries";

// ---------- Payments ----------

export function PaymentsPage() {
  useDocumentTitle("Payments");
  const db = useDb();
  const actor = useActor();
  const owner = ownerOf(actor)!;
  const rows = liabilitiesFor(db, owner);
  const payments = paymentsFor(db, owner);
  const due = rows.reduce((s, r) => s + r.outstanding, 0);
  return (
    <>
      <PageHeader title={actor.role === "EMPLOYER" ? "Payments" : "Tax payments"} lead="Amounts GMCA has assessed or you have declared, and every payment attempt. A payment only counts once the bank confirms it." />
      <MetricStrip
        items={[
          { label: "Outstanding", value: formatMoney(due) },
          { label: "Open liabilities", value: rows.filter((r) => r.outstanding > 0).length },
          { label: "Payments confirmed", value: payments.filter((p) => p.status === "SUCCESS").length }
        ]}
      />
      <Section title="Liabilities">
        <DataTable
          caption="Liabilities"
          rows={rows}
          rowKey={(r) => r.liability.id}
          empty="Nothing is owed. Assessed balances and monthly declarations appear here."
          columns={[
            { key: "ref", header: "Reference", cell: (r) => <span className="num">{r.liability.reference}</span> },
            { key: "desc", header: "For", cell: (r) => r.liability.description },
            { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.liability.amountMinor, r.liability.currency) },
            { key: "out", header: "Outstanding", align: "right", cell: (r) => formatMoney(r.outstanding, r.liability.currency) },
            { key: "status", header: "Status", cell: (r) => <PaymentBadge status={r.status} /> },
            {
              key: "act",
              header: <span className="sr-only">Action</span>,
              cell: (r) =>
                r.outstanding > 0 && r.status !== "PENDING" ? (
                  <Button size="sm" onClick={() => navigate(`/payments/${r.liability.id}/pay`)}>
                    Pay
                  </Button>
                ) : r.status === "PENDING" ? (
                  <Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to={`/payments/receipt/${payments.find((p) => p.liabilityId === r.liability.id && p.status === "PENDING")?.id}`}>
                    Check status
                  </Link>
                ) : null
            }
          ]}
        />
      </Section>
      <Section title="Payment history">
        <PaymentHistoryTable db={db} payments={payments} />
      </Section>
    </>
  );
}

export function PaymentHistoryTable({ db, payments }: { db: Db; payments: Payment[] }) {
  return (
    <DataTable
      caption="Payment attempts"
      rows={payments}
      rowKey={(p) => p.id}
      empty="No payments yet."
      columns={[
        { key: "date", header: "Started", cell: (p) => formatDateTime(p.initiatedAt) },
        { key: "for", header: "For", cell: (p) => db.liabilities.find((l) => l.id === p.liabilityId)?.reference },
        { key: "amount", header: "Amount", align: "right", cell: (p) => formatAmount(p.amountMinor, p.currency) },
        { key: "status", header: "Bank result", cell: (p) => <AttemptBadge p={p} /> },
        { key: "ref", header: "Bank reference", cell: (p) => <span className="num text-xs">{p.bankTransactionRef ?? p.intentReference}</span> },
        { key: "receipt", header: <span className="sr-only">Receipt</span>, cell: (p) => (p.method === "EVIDENCE" ? (p.evidenceDocId ? <Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to={`/documents/${p.evidenceDocId}`}>Uploaded receipt</Link> : null) : <Link className="text-sm text-brand-ink underline-offset-4 hover:underline" to={`/payments/receipt/${p.id}`}>{p.status === "SUCCESS" ? "Acknowledgement" : "Details"}</Link>) }
      ]}
    />
  );
}

function AttemptBadge({ p }: { p: Payment }) {
  const map = { INITIATED: ["neutral", "Not completed"], PENDING: ["review", "Pending"], SUCCESS: ["approved", "Confirmed"], FAILED: ["rejected", "Failed"] } as const;
  if (p.method === "EVIDENCE") return <StatusBadge tone="review">Paid · evidence uploaded</StatusBadge>;
  const [tone, label] = map[p.status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function PayPage({ liabilityId }: { liabilityId: string }) {
  useDocumentTitle("Pay");
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const l = db.liabilities.find((x) => x.id === liabilityId);
  const [amount, setAmount] = useState(() => minorToInput(l ? outstanding(l) : 0));
  if (!l || !canViewOwner(actor, l.owner) || actor.role === "ASSESSOR") return <Forbidden />;
  const due = outstanding(l);
  const parsed = parseAmountInput(amount);
  return (
    <>
      <PageHeader title="Review and pay" back={{ to: "/payments", label: "Payments" }} />
      <div className="grid max-w-2xl gap-6">
        <div className="panel p-5">
          <KeyValue
            rows={[
              { label: "Liability", value: l.reference },
              { label: "For", value: l.description },
              { label: "Total", value: formatMoney(l.amountMinor, l.currency) },
              { label: "Already paid", value: formatMoney(l.paidMinor, l.currency) },
              { label: "Outstanding", value: <strong>{formatMoney(due, l.currency)}</strong> },
              { label: "Status", value: <PaymentBadge status={liabilityStatus(db, l)} /> }
            ]}
          />
        </div>
        <TextField label={`Amount to pay (${l.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={parsed === null || parsed <= 0 || parsed > due ? "Enter an amount up to the outstanding balance." : undefined} hint="Part payments are allowed in this demo. Whether GMCA accepts part payments is to be confirmed." />
        <Alert tone="action" title="Simulated DK Bank">
          You'll go to a demo bank screen. No real bank is contacted and no money moves.
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={parsed === null || parsed <= 0 || parsed > due}
            onClick={() => {
              const p = run((d, a) => initiatePayment(d, a, l.id, parsed!));
              if (p) navigate(`/bank/${p.id}`);
            }}
          >
            <Landmark /> Continue to DK Bank
          </Button>
          <Button variant="secondary" onClick={() => history.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * The simulated DK Bank handoff, as in version 1: a short "connecting" screen, then the bank's
 * approval page, then a wait while the bank confirms. Controlled outcomes keep the demo deterministic.
 */
export function BankPage({ paymentId }: { paymentId: string }) {
  useDocumentTitle("DK Bank");
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const [phase, setPhase] = useState<"connecting" | "approve" | "confirming">("connecting");
  const [choice, setChoice] = useState<"SUCCESS" | "PENDING" | "FAILURE">("SUCCESS");
  const p = db.payments.find((x) => x.id === paymentId);
  const l = p && db.liabilities.find((x) => x.id === p.liabilityId);
  const open = p?.status === "INITIATED";
  useEffect(() => {
    if (!open || phase !== "connecting") return;
    const t = window.setTimeout(() => setPhase("approve"), 700);
    return () => window.clearTimeout(t);
  }, [open, phase]);
  useEffect(() => {
    if (!open || phase !== "confirming") return;
    const t = window.setTimeout(() => {
      if (run((d, a) => settlePayment(d, a, paymentId, choice))) navigate(`/payments/receipt/${paymentId}`, { replace: true });
      else setPhase("approve");
    }, 600);
    return () => window.clearTimeout(t);
  }, [open, phase, choice, paymentId, run]);
  if (!p || !l || !canViewOwner(actor, l.owner)) return <Forbidden />;
  if (!open) {
    return (
      <Alert tone="review" title="This bank session is closed" action={<Link to={`/payments/receipt/${p.id}`} className="underline">See result</Link>}>
        Start a new payment from Payments if you need to try again.
      </Alert>
    );
  }
  const ret = l.source === "INDIVIDUAL_SELF_ASSESSMENT" ? db.individualReturns.find((r) => r.id === l.sourceId) : undefined;
  const purpose = ret ? `Income tax, YA ${ret.year + 1} (income year ${ret.year})` : l.description;
  const forced = db.config.integrations.dkBank;
  const decide = (o: typeof choice) => {
    setChoice(o);
    setPhase("confirming");
  };
  const cancel = () => navigate(ret ? `/returns/file/${ret.year}/review` : "/payments");

  if (phase === "connecting") {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-6">
        <section className="panel grid justify-items-center gap-5 p-8 text-center sm:p-10" aria-live="polite">
          <span className="grid size-16 place-items-center rounded-full bg-brand-50 text-brand-ink">
            <Landmark className="size-8" aria-hidden="true" />
          </span>
          <div className="grid gap-2">
            <h1 className="font-serif text-2xl">Initiating your payment with DK Bank</h1>
            <p className="text-sm text-muted">
              {formatAmount(p.amountMinor, p.currency)} for {purpose.charAt(0).toLowerCase() + purpose.slice(1)}. You'll approve it on DK Bank's secure page. Please don't close this window.
            </p>
          </div>
          <span className="flex items-center gap-3 text-sm text-fg-2" role="status">
            <span className="spinner text-brand-ink" aria-hidden="true" /> Connecting to DK Bank securely…
          </span>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Lock className="size-3.5" aria-hidden="true" /> Reference <span className="num">{l.reference}</span>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <section className="panel grid gap-6 p-6 sm:p-8" aria-labelledby="dkbank">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DkBankLogo />
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Lock className="size-3.5" aria-hidden="true" /> Secure payment
          </span>
        </div>
        <div className="grid gap-1">
          <h1 id="dkbank" className="font-serif text-2xl">
            Approve payment
          </h1>
          <p className="text-sm text-muted">DK Bank is accepting this payment for the Gelephu Mindfulness City Authority.</p>
        </div>
        <KeyValue
          rows={[
            { label: "To", value: "GMCA Income Tax" },
            { label: "For", value: purpose },
            { label: "Reference", value: <span className="num">{l.reference}</span> },
            { label: "Amount", value: <span className="font-serif text-2xl">{formatAmount(p.amountMinor, p.currency)}</span> },
            { label: "From", value: "Savings account ••••4021" }
          ]}
        />
        {phase === "confirming" ? (
          <p className="flex items-center gap-3 text-sm text-muted" role="status">
            <span className="spinner text-brand-ink" aria-hidden="true" /> Waiting for DK Bank to confirm…
          </p>
        ) : forced === "CHOOSE" ? (
          <div className="grid gap-3">
            <Button size="lg" onClick={() => decide("SUCCESS")}>
              Approve {formatAmount(p.amountMinor, p.currency)}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => decide("FAILURE")}>
                Decline payment
              </Button>
              <Button variant="secondary" size="sm" onClick={() => decide("PENDING")}>
                Leave it pending
              </Button>
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted">A GMCA administrator has fixed the bank's answer to “{forced.toLowerCase()}”.</p>
            <Button size="lg" onClick={() => decide("SUCCESS")}>
              Approve {formatAmount(p.amountMinor, p.currency)}
            </Button>
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={cancel}>
              Cancel
            </Button>
          </div>
        )}
      </section>
      <p className="text-center text-xs text-muted">This screen stands in for DK Bank. The real payment flow and confirmation API are still to be specified with DK Bank.</p>
    </div>
  );
}

export function ReceiptPage({ paymentId }: { paymentId: string }) {
  useDocumentTitle("Payment result");
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const p = db.payments.find((x) => x.id === paymentId);
  const l = p && db.liabilities.find((x) => x.id === p.liabilityId);
  if (!p || !l || !canViewOwner(actor, l.owner)) return <Forbidden />;
  const receipt = p.receiptDocId ? db.documents.find((d) => d.id === p.receiptDocId) : undefined;
  return (
    <>
      <PageHeader title={p.status === "SUCCESS" ? "Payment confirmed" : p.status === "PENDING" ? "Payment pending" : p.status === "FAILED" ? "Payment failed" : "Payment not completed"} back={{ to: "/payments", label: "Payments" }} />
      <div className="grid max-w-2xl gap-6">
        {p.status === "SUCCESS" ? <Alert tone="approved" title="DK Bank confirmed the payment">Your balance has been updated.</Alert> : null}
        {(() => {
          const ret = l.source === "INDIVIDUAL_SELF_ASSESSMENT" ? db.individualReturns.find((r) => r.id === l.sourceId) : undefined;
          if (!ret) return null;
          return ret.submissionStatus === "SUBMITTED" ? (
            <Alert tone="approved" title={`Your YA ${ret.year + 1} return has been submitted`} action={<Button size="sm" onClick={() => navigate(`/returns/${ret.id}?submitted=1`)}>View return</Button>}>
              Reference <strong>{ret.reference}</strong>. GMCA will assess it and tell you here.
            </Alert>
          ) : (
            <Alert tone="action" title="Your return has not been submitted yet">
              It is submitted automatically when this payment is confirmed. <Link to={`/returns/file/${ret.year}/review`} className="underline">Back to your return</Link>
            </Alert>
          );
        })()}
        {p.status === "PENDING" ? (
          <Alert tone="review" title="Waiting for the bank" action={<Button size="sm" variant="secondary" onClick={() => run((d, a) => recheckPayment(d, a, p.id), "Status refreshed")}>Recheck status</Button>}>
            Your balance is unchanged until the bank confirms. You can't start another payment for this liability meanwhile.
          </Alert>
        ) : null}
        {p.status === "FAILED" ? (
          <Alert tone="rejected" title="The payment did not go through" action={<Button size="sm" onClick={() => navigate(`/payments/${l.id}/pay`)}>Try again</Button>}>
            {p.failureReason} Your balance is unchanged.
          </Alert>
        ) : null}
        <div className="panel p-5">
          <KeyValue
            rows={[
              { label: "Amount", value: formatAmount(p.amountMinor, p.currency) },
              { label: "For", value: `${l.reference} · ${l.description}` },
              { label: "Bank transaction", value: p.bankTransactionRef ?? "—" },
              { label: "Payment reference", value: p.intentReference },
              { label: "Started", value: formatDateTime(p.initiatedAt) },
              { label: "Settled", value: formatDateTime(p.settledAt) },
              { label: "Outstanding now", value: formatMoney(outstanding(l), l.currency) }
            ]}
          />
        </div>
        {receipt ? (
          <Button className="w-fit" onClick={() => navigate(`/documents/${receipt.id}`)}>
            <FileText /> View Payment Acknowledgement
          </Button>
        ) : null}
      </div>
    </>
  );
}

// ---------- Documents ----------

export function DocumentsPage() {
  useDocumentTitle("Documents");
  const db = useDb();
  const actor = useActor();
  const owner = ownerOf(actor)!;
  const [filter, setFilter] = useState<"ALL" | "ISSUED" | "UPLOADED">("ALL");
  const docs = documentsFor(db, owner).filter((d) => (filter === "ALL" ? true : filter === "ISSUED" ? d.generated : !d.generated));
  return (
    <>
      <PageHeader title="Documents" lead="Everything you've uploaded and everything GMCA has issued to you: certificates, notices, receipts and letters." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter documents">
        {(["ALL", "ISSUED", "UPLOADED"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("h-9 border px-4 text-sm", filter === f ? "border-primary bg-brand-50 font-medium text-brand-ink" : "border-line bg-surface text-fg-2 hover:bg-sunk")}>
            {f === "ALL" ? "All" : f === "ISSUED" ? "Issued by GMCA" : "Uploaded by you"}
          </button>
        ))}
      </div>
      <DocumentTable db={db} docs={docs} />
    </>
  );
}

export function DocumentTable({ db, docs, showOwner }: { db: Db; docs: TaxDocument[]; showOwner?: boolean }) {
  return (
    <DataTable
      caption="Documents"
      rows={docs}
      rowKey={(d) => d.id}
      empty="No documents."
      columns={[
        { key: "title", header: "Document", cell: (d) => <Link to={`/documents/${d.id}`} className="text-brand-ink underline-offset-4 hover:underline">{d.generated ? d.title : d.fileName}</Link> },
        { key: "type", header: "Type", cell: (d) => CATEGORY_LABEL[d.category] },
        ...(showOwner ? [{ key: "owner", header: "Taxpayer", cell: (d: TaxDocument) => ownerName(db, d.owner) }] : []),
        { key: "date", header: "Date", cell: (d) => formatDate(d.uploadedAt, "short") },
        { key: "by", header: "By", cell: (d) => (d.generated ? "GMCA (generated)" : userName(db, d.uploadedBy)) },
        { key: "status", header: "Review", cell: (d) => (d.generated ? <span className="text-xs text-muted">Issued</span> : <DocReviewBadge status={d.reviewStatus} />) }
      ]}
    />
  );
}

function CertificateFrame({ doc, kind, children }: { doc: TaxDocument; kind: string; children: ReactNode }) {
  return (
    <article className="mx-auto grid w-full max-w-3xl gap-6 border border-line bg-surface p-6 sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
        <div className="grid gap-2">
          <img src="/gmc-logo-black.svg" alt="" className="h-12 w-auto self-start dark:invert" />
          <p className="text-[13px] uppercase tracking-[0.14em] text-muted">Gelephu Mindfulness City Authority · Income Tax</p>
          <h1 className="font-serif text-[1.75rem] leading-tight">{kind}</h1>
          <p className="num text-sm text-muted">Reference {doc.reference} · issued {formatDateTime(doc.uploadedAt)}</p>
        </div>
        <div className="grid justify-items-center gap-1">
          <DemoQr seed={doc.reference} className="size-24" label="Verification code" />
          <span className="text-[11px] text-muted">Verification code</span>
        </div>
      </header>
      {children}
      <footer className="border-t border-line pt-4 text-xs leading-relaxed text-muted">Generated from the data stored with the submission.</footer>
    </article>
  );
}

function GeneratedBody({ db, doc }: { db: Db; doc: TaxDocument }) {
  const r = doc.related;
  const party = doc.owner.kind === "INDIVIDUAL" ? db.taxpayers.find((t) => t.id === doc.owner.id) : undefined;
  const company = doc.owner.kind === "COMPANY" ? db.companies.find((c) => c.id === doc.owner.id) : undefined;
  const who = [
    { label: party ? "Taxpayer" : "Company", value: party?.fullName ?? company?.name ?? "—" },
    { label: party ? "TIN" : company?.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship number" : "UEN", value: party?.tin ?? company?.uen ?? "—" }
  ];

  if (doc.category === "SUBMISSION_ACK") {
    const ind = r.kind === "INDIVIDUAL_RETURN" ? db.individualReturns.find((x) => x.id === r.id) : undefined;
    const cor = r.kind === "CORPORATE_RETURN" ? db.corporateReturns.find((x) => x.id === r.id) : undefined;
    const mon = r.kind === "MONTHLY_DECLARATION" ? db.monthlyDeclarations.find((x) => x.id === r.id) : undefined;
    const ret = ind ?? cor ?? mon;
    const calc = ret?.calculation;
    return (
      <CertificateFrame doc={doc} kind="Acknowledgement Certificate">
        <p className="text-[15px] leading-relaxed">
          GMCA acknowledges receipt of the {ind ? `Individual Income Tax Return for ${ind.year}` : cor ? `Corporate Income Tax Return for ${cor.year}` : `Monthly TDS & Health Contributions declaration for ${mon ? formatPeriod(mon.period) : ""}`}. This certificate confirms submission only. It is not an assessment.
        </p>
        <KeyValue rows={[...who, { label: "Submission reference", value: ret?.reference ?? "—" }, { label: "Submitted", value: formatDateTime(ret?.submittedAt) }, ...(mon ? [{ label: "Employees included", value: String(mon.lines.length) }] : [])]} />
        {calc ? (
          <div className="grid gap-2">
            <h2 className="text-sm font-medium">Calculation submitted (rules {calc.ruleSetVersion})</h2>
            <KeyValue rows={[{ label: ind || cor ? "Calculated tax" : "Total TDS and health", value: formatMoney(calc.taxMinor, calc.reportingCurrency) }, ...(ind ? [{ label: "Employer-reported TDS", value: formatMoney(calc.creditsMinor, calc.reportingCurrency) }, { label: calc.balanceMinor >= 0 ? "Estimated balance" : "Estimated credit", value: formatMoney(calc.balanceMinor, calc.reportingCurrency) }] : [])]} />
          </div>
        ) : null}
      </CertificateFrame>
    );
  }

  if (doc.category === "NOTICE_OF_ASSESSMENT" && r.kind === "ASSESSMENT") {
    const a = db.assessments.find((x) => x.id === r.id);
    if (!a?.outcome) return <Alert tone="rejected">Assessment data is missing.</Alert>;
    const { reference } = caseLabel(db, a);
    const l = a.liabilityId ? db.liabilities.find((x) => x.id === a.liabilityId) : undefined;
    return (
      <CertificateFrame doc={doc} kind="Notice of Assessment">
        <KeyValue rows={[...who, { label: "Return", value: reference }, { label: "Year", value: String(a.year) }, { label: "Assessed by", value: userName(db, a.outcome.by) }, { label: "Assessed on", value: formatDate(a.outcome.at) }]} />
        <div className="border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Assessment</caption>
            <tbody>
              <tr className="border-b border-line-soft">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Tax as calculated on the return</th>
                <td className="num px-4 py-2.5 text-right">{formatMoney(a.outcome.assessedTaxMinor - a.adjustments.reduce((s, x) => s + x.amountMinor, 0))}</td>
              </tr>
              {a.adjustments.map((x) => (
                <tr key={x.id} className="border-b border-line-soft">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    Adjustment · {x.label}
                    <span className="block text-xs text-muted">{x.reason}</span>
                  </th>
                  <td className="num px-4 py-2.5 text-right align-top">{formatMoney(x.amountMinor)}</td>
                </tr>
              ))}
              <tr className="border-b border-line-soft font-medium">
                <th scope="row" className="px-4 py-2.5 text-left">Assessed tax</th>
                <td className="num px-4 py-2.5 text-right">{formatMoney(a.outcome.assessedTaxMinor)}</td>
              </tr>
              <tr className="border-b border-line-soft">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">Less tax credits (TDS)</th>
                <td className="num px-4 py-2.5 text-right">{formatMoney(-a.outcome.creditsMinor)}</td>
              </tr>
              {a.outcome.prepaidMinor ? (
                <tr className="border-b border-line-soft">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">Less paid with the return</th>
                  <td className="num px-4 py-2.5 text-right">{formatMoney(-a.outcome.prepaidMinor)}</td>
                </tr>
              ) : null}
              <tr className="bg-sunk font-medium">
                <th scope="row" className="px-4 py-2.5 text-left">{a.outcome.balanceMinor >= 0 ? "Balance payable" : "Credit"}</th>
                <td className="num px-4 py-2.5 text-right">{formatMoney(a.outcome.balanceMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-relaxed">{a.outcome.summary}</p>
        {l ? <p className="text-sm text-muted">Liability {l.reference}.</p> : null}
      </CertificateFrame>
    );
  }

  if (doc.category === "PAYMENT_RECEIPT" && r.kind === "PAYMENT") {
    const p = db.payments.find((x) => x.id === r.id);
    const l = p && db.liabilities.find((x) => x.id === p.liabilityId);
    return (
      <CertificateFrame doc={doc} kind="Payment Acknowledgement">
        <KeyValue rows={[...who, { label: "Amount received", value: p ? formatAmount(p.amountMinor, p.currency) : "—" }, { label: "For", value: l ? `${l.reference} · ${l.description}` : "—" }, { label: "Bank transaction", value: p?.bankTransactionRef ?? "—" }, { label: "Confirmed", value: formatDateTime(p?.settledAt) }, { label: "Channel", value: "DK Bank (simulated)" }]} />
      </CertificateFrame>
    );
  }

  if (doc.category === "CORRESPONDENCE" && r.kind === "INFO_REQUEST") {
    const req = db.infoRequests.find((x) => x.id === r.id);
    if (!req) return null;
    return (
      <CertificateFrame doc={doc} kind="Request for Additional Information">
        <KeyValue rows={[...who, { label: "Request", value: req.reference }, { label: "Respond by", value: formatDate(req.dueDate) }, { label: "From", value: userName(db, req.requestedBy) }]} />
        <p className="whitespace-pre-line text-[15px] leading-relaxed">{req.message}</p>
        {req.requiredDocuments.length ? (
          <div>
            <h2 className="mb-1 text-sm font-medium">Documents requested</h2>
            <ul className="list-disc pl-5 text-sm">
              {req.requiredDocuments.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CertificateFrame>
    );
  }
  return <Alert tone="review">This document type has no printable view.</Alert>;
}

export function DocumentViewer({ id }: { id: string }) {
  const db = useDb();
  const actor = useActor();
  let doc: TaxDocument | undefined;
  let denied: string | undefined;
  try {
    doc = requireDocument(db, actor, id);
  } catch (e) {
    denied = e instanceof ServiceError ? e.message : "This document can't be opened.";
  }
  useDocumentTitle(doc?.title ?? "Document");
  if (!doc) return <Forbidden message={denied} />;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3" data-print="hide">
        <button type="button" onClick={() => history.back()} className="text-sm text-muted hover:text-fg">
          ← Back
        </button>
        {doc.generated ? (
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer /> Download or print (PDF)
          </Button>
        ) : doc.dataUrl ? (
          <a className="inline-flex h-10 items-center gap-2 border border-line bg-surface px-5 text-sm font-medium text-fg-2 hover:bg-sunk" href={doc.dataUrl} download={doc.fileName}>
            <Download className="size-4" /> Download
          </a>
        ) : null}
      </div>
      {doc.generated ? (
        <GeneratedBody db={db} doc={doc} />
      ) : (
        <div className="grid gap-6">
          <PageHeader title={doc.fileName} lead={CATEGORY_LABEL[doc.category]} />
          <div className="panel p-5">
            <KeyValue rows={[{ label: "Belongs to", value: ownerName(db, doc.owner) }, { label: "Uploaded by", value: userName(db, doc.uploadedBy) }, { label: "Uploaded", value: formatDateTime(doc.uploadedAt) }, { label: "File type", value: doc.mimeType }, { label: "Size", value: `${Math.round(doc.sizeBytes / 1024)} KB` }, { label: "Review status", value: <DocReviewBadge status={doc.reviewStatus} /> }]} />
          </div>
          {doc.dataUrl ? (
            doc.mimeType === "application/pdf" ? (
              <iframe title={doc.fileName} src={doc.dataUrl} className="h-[70vh] w-full border border-line bg-surface" />
            ) : (
              <img src={doc.dataUrl} alt={doc.fileName} className="max-h-[70vh] w-auto border border-line" />
            )
          ) : (
            <Alert tone="review" title={doc.demoSeeded ? "Seeded demo document" : "File content not kept in this browser"}>
              {doc.demoSeeded ? "This record was created by the demo seed and has no file attached." : "Files over 400 KB keep their details only, so demo browser storage doesn't fill up. Production stores files in secure document storage."}
            </Alert>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Messages ----------

export function MessagesPage() {
  useDocumentTitle("Messages");
  const db = useDb();
  const { user } = useSession();
  const run = useRun();
  const notes = notificationsFor(db, user!);
  const unread = notes.filter((n) => !isRead(n, user!.id));
  return (
    <>
      <PageHeader
        title="Messages and notifications"
        lead="Updates about your filings, assessments and payments."
        actions={
          unread.length ? (
            <Button variant="secondary" onClick={() => run((d) => markAll(d, user!.id, unread.map((n) => n.id)))}>
              Mark all as read
            </Button>
          ) : null
        }
      />
      {notes.length === 0 ? (
        <EmptyState icon={Inbox} title="No messages yet">
          Submission confirmations, assessment updates and payment results appear here.
        </EmptyState>
      ) : (
        <ul className="grid border border-line bg-surface">
          {notes.map((n) => (
            <li key={n.id} className="border-b border-line-soft last:border-0">
              <button
                type="button"
                className="grid w-full gap-1 px-5 py-4 text-left hover:bg-brand-50"
                onClick={() => {
                  run((d) => markAll(d, user!.id, [n.id]));
                  if (n.link) navigate(n.link);
                }}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("text-[15px]", !isRead(n, user!.id) ? "font-medium text-fg" : "text-fg-2")}>
                    {!isRead(n, user!.id) ? <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-ember" /> : null}
                    {n.title}
                    {!isRead(n, user!.id) ? <span className="sr-only"> (unread)</span> : null}
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </span>
                <span className="text-sm text-muted">{n.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function markAll(d: Db, userId: string, ids: string[]) {
  for (const n of d.notifications) if (ids.includes(n.id) && !n.readBy.includes(userId)) n.readBy.push(userId);
}

// ---------- Information request response ----------

export function RequestPage({ id }: { id: string }) {
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const req = db.infoRequests.find((r) => r.id === id);
  const [message, setMessage] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  useDocumentTitle(req ? `Request ${req.reference}` : "Request");
  if (!req || !canViewOwner(actor, req.owner)) return <Forbidden />;
  const a = db.assessments.find((x) => x.id === req.assessmentId)!;
  const { reference } = caseLabel(db, a);
  const back = a.returnKind === "INDIVIDUAL" ? { to: `/returns/${a.returnId}`, label: `Return ${reference}` } : { to: `/company/corporate/return/${a.returnId}`, label: `Return ${reference}` };
  return (
    <>
      <PageHeader title="Additional Information Required" lead={`GMCA is reviewing ${reference} and needs more from you.`} back={back} />
      <div className="grid max-w-3xl gap-6">
        <div className="panel grid gap-4 p-5">
          <KeyValue rows={[{ label: "Request", value: req.reference }, { label: "Respond by", value: formatDate(req.dueDate) }, { label: "From", value: userName(db, req.requestedBy) }, { label: "Sent", value: formatDateTime(req.requestedAt) }]} />
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{req.message}</p>
          {req.requiredDocuments.length ? (
            <div>
              <p className="mb-1 text-sm font-medium">Documents requested</p>
              <ul className="list-disc pl-5 text-sm">
                {req.requiredDocuments.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {req.letterDocId ? <Link to={`/documents/${req.letterDocId}`} className="w-fit text-sm text-brand-ink underline underline-offset-4">Open the official letter</Link> : null}
        </div>
        {req.status === "OPEN" && actor.role !== "ASSESSOR" ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (run((d, ac: Actor) => respondToRequest(d, ac, req.id, message, docIds), "Response sent to GMCA") !== undefined) navigate(back.to);
            }}
          >
            <TextArea label="Your response" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
            <RecordUpload db={db} label="Supporting documents" category="INFO_RESPONSE" owner={req.owner} related={{ kind: "INFO_REQUEST", id: req.id }} docIds={docIds} onChange={setDocIds} multiple />
            <div>
              <Button type="submit">Send response</Button>
            </div>
          </form>
        ) : req.response ? (
          <Section title="Response sent">
            <div className="panel grid gap-3 p-5">
              <p className="text-sm text-muted">
                {userName(db, req.response.by)} · {formatDateTime(req.response.at)}
              </p>
              <p className="whitespace-pre-line text-[15px]">{req.response.message || "No message."}</p>
              <ul className="grid gap-1">
                {req.response.docIds.map((x) => {
                  const doc = db.documents.find((d) => d.id === x);
                  return doc ? (
                    <li key={x}>
                      <Link to={`/documents/${x}`} className="text-sm text-brand-ink underline-offset-4 hover:underline">
                        {doc.fileName}
                      </Link>
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          </Section>
        ) : (
          <Alert tone="review">This request was closed by GMCA.</Alert>
        )}
      </div>
    </>
  );
}

export function Forbidden({ message }: { message?: string }) {
  return (
    <EmptyState icon={ShieldAlert} title="You can't open this">
      {message ?? "It doesn't exist, or it belongs to another account."}
    </EmptyState>
  );
}

