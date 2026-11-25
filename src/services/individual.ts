import { audit, nextId, nextReference, notify, ServiceError, type Actor } from "../domain/store";
import { require, requireOwner } from "../domain/permissions";
import type { BalanceSheetLine, Db, EmploymentIncomeLine, IncomeSource, IndividualTaxReturn, ReliefClaim } from "../domain/types";
import { balanceSheetIssues, checkBalanceSheet } from "./balanceSheet";
import { defaultSourceClassification } from "./classification";
import { calculateIndividual, ruleSetForYear } from "./calc";
import { nowIso } from "./clock";
import { convert, conversionDateFor } from "./currency";
import { generateDocument, uploadDocument } from "./documents";
import { providers } from "./integrations";
import { initiatePayment } from "./payments";
import { logIntegration } from "./registration";
import { autoAssign } from "./assignments";

const owner = (r: IndividualTaxReturn) => ({ kind: "INDIVIDUAL" as const, id: r.taxpayerId });

/** Employment income comes from employers' submitted monthly declarations, never typed by the taxpayer, so it is not double counted. */
export function employmentFromDeclarations(d: Db, taxpayerId: string, year: number): EmploymentIncomeLine[] {
  const employeeIds = new Map(d.employees.filter((e) => e.taxpayerId === taxpayerId).map((e) => [e.id, e.companyId]));
  const byCompany = new Map<string, EmploymentIncomeLine>();
  for (const decl of d.monthlyDeclarations) {
    if (decl.submissionStatus !== "SUBMITTED" || !decl.period.startsWith(`${year}-`)) continue;
    for (const line of decl.lines) {
      if (!employeeIds.has(line.employeeId) || line.conversion?.reportingMinor == null) continue;
      const company = d.companies.find((c) => c.id === decl.companyId);
      const cur = byCompany.get(decl.companyId) ?? { employerName: company?.name ?? "Employer", companyId: decl.companyId, months: 0, grossMinor: 0, tdsMinor: 0, healthMinor: 0, currency: d.config.reportingCurrency, source: "EMPLOYER_DECLARATIONS" as const };
      cur.months += 1;
      cur.grossMinor += line.conversion.reportingMinor;
      cur.tdsMinor += line.tdsMinor;
      cur.healthMinor += line.healthMinor;
      byCompany.set(decl.companyId, cur);
    }
  }
  return [...byCompany.values()];
}

export function getReturn(d: Db, id: string) {
  const r = d.individualReturns.find((x) => x.id === id);
  if (!r) throw new ServiceError("Return not found.", "NOT_FOUND");
  return r;
}

export function ensureDraftReturn(d: Db, actor: Actor, year: number): IndividualTaxReturn {
  require(actor, "individual.file");
  if (!actor.taxpayerId) throw new ServiceError("No taxpayer record is linked to this account.");
  const existing = d.individualReturns.find((r) => r.taxpayerId === actor.taxpayerId && r.year === year);
  if (existing) return existing;
  const now = nowIso();
  const ret: IndividualTaxReturn = {
    id: nextId(d, "IIT"),
    taxpayerId: actor.taxpayerId,
    year,
    submissionStatus: "DRAFT",
    employment: employmentFromDeclarations(d, actor.taxpayerId, year),
    incomeSources: [],
    reliefs: [],
    declarationAccepted: false,
    lastSavedAt: now,
    createdAt: now
  };
  recalculate(d, ret);
  d.individualReturns.push(ret);
  audit(d, actor, "RETURN_DRAFT_CREATED", "IndividualTaxReturn", ret.id, `Draft individual return started for ${year}`);
  return ret;
}

/** Converts each source and calculates, without writing anything. Used for the live estimate while editing. */
export function previewCalculation(d: Db, ret: IndividualTaxReturn, incomeSources: IncomeSource[], reliefs: ReliefClaim[]) {
  const rules = ruleSetForYear(d.ruleSets, ret.year);
  const taxpayer = d.taxpayers.find((t) => t.id === ret.taxpayerId);
  const sources = incomeSources.map((s) => ({ ...s, conversion: convert(d.config, s.amountMinor, s.currency, conversionDateFor(d.config, s.periodTo || `${ret.year}-12-31`, nowIso().slice(0, 10))) }));
  const snapshot = calculateIndividual({ employment: ret.employment, incomeSources: sources, reliefs, citizenship: taxpayer?.category ?? "CITIZEN", residency: taxpayer?.residencyStatus ?? "NOT_DETERMINED", year: ret.year }, rules, d.config.reportingCurrency, nowIso());
  return { sources, snapshot, rules };
}

export function recalculate(d: Db, ret: IndividualTaxReturn) {
  const { sources, snapshot } = previewCalculation(d, ret, ret.incomeSources, ret.reliefs);
  ret.incomeSources = sources;
  ret.calculation = { ...snapshot, id: nextId(d, "CALC") };
}

/** The pre-payment liability for a draft return (version 1 flow: pay, then submit). */
export function selfAssessmentFor(d: Db, returnId: string) {
  return d.liabilities.find((l) => l.source === "INDIVIDUAL_SELF_ASSESSMENT" && l.sourceId === returnId);
}

function pendingPrepayment(d: Db, returnId: string) {
  const l = selfAssessmentFor(d, returnId);
  return l ? d.payments.find((p) => p.liabilityId === l.id && p.status === "PENDING") : undefined;
}

/**
 * Foreign nationals declare employment income only: no additional income and no assets and
 * liabilities. Citizens declare both.
 */
export function returnScope(d: Db, ret: Pick<IndividualTaxReturn, "taxpayerId">) {
  const citizen = d.taxpayers.find((t) => t.id === ret.taxpayerId)?.category !== "FOREIGN";
  return { additionalIncome: citizen, balanceSheet: citizen };
}

export type DraftPatch = { incomeSources?: IncomeSource[]; reliefs?: ReliefClaim[]; balanceSheet?: BalanceSheetLine[]; declarationAccepted?: boolean; refreshEmployment?: boolean };

export function saveDraft(d: Db, actor: Actor, returnId: string, patch: DraftPatch) {
  const ret = getReturn(d, returnId);
  requireOwner(actor, owner(ret));
  if (ret.submissionStatus !== "DRAFT") throw new ServiceError("This return has been submitted and can no longer be edited.", "CONFLICT");
  if (pendingPrepayment(d, ret.id)) throw new ServiceError("A payment for this return is pending with DK Bank. Check its status before changing the return.", "CONFLICT");
  const scope = returnScope(d, ret);
  if (patch.incomeSources?.length && !scope.additionalIncome) throw new ServiceError("Foreign nationals declare employment income only.");
  if (patch.balanceSheet?.length && !scope.balanceSheet) throw new ServiceError("Foreign nationals don't declare assets and liabilities.");
  if (patch.incomeSources) ret.incomeSources = patch.incomeSources;
  if (patch.reliefs) ret.reliefs = patch.reliefs;
  if (patch.balanceSheet) {
    checkBalanceSheet(patch.balanceSheet);
    ret.balanceSheet = patch.balanceSheet;
  }
  if (patch.declarationAccepted !== undefined) ret.declarationAccepted = patch.declarationAccepted;
  if (patch.refreshEmployment) ret.employment = employmentFromDeclarations(d, ret.taxpayerId, ret.year);
  ret.lastSavedAt = nowIso();
  recalculate(d, ret);
  return ret;
}

export type Issue = { step: string; message: string };

export function validateReturn(d: Db, ret: IndividualTaxReturn): Issue[] {
  const issues: Issue[] = [];
  ret.incomeSources.forEach((s, i) => {
    const name = s.description || `Income source ${i + 1}`;
    if (!s.description.trim()) issues.push({ step: "income", message: `Income source ${i + 1}: add a description.` });
    if (s.amountMinor <= 0) issues.push({ step: "income", message: `${name}: enter an amount greater than zero.` });
    if (!s.bankStatementDocId || !d.documents.some((doc) => doc.id === s.bankStatementDocId)) issues.push({ step: "income", message: `${name}: upload the bank statement for this source.` });
    if (s.conversion?.status === "PENDING") issues.push({ step: "income", message: `${name}: no exchange rate is configured for ${s.currency}. Choose another currency or ask GMCA to add a rate.` });
    if (s.periodFrom && s.periodTo && s.periodFrom > s.periodTo) issues.push({ step: "income", message: `${name}: the period ends before it starts.` });
  });
  ret.reliefs.forEach((r) => {
    const rule = ruleSetForYear(d.ruleSets, ret.year).reliefs.find((x) => x.key === r.reliefKey);
    const label = rule?.label ?? "Relief";
    if (r.declaredMinor <= 0) issues.push({ step: "reliefs", message: `${label}: enter the amount you are claiming.` });
    if (!r.docIds.length) issues.push({ step: "reliefs", message: `${label}: upload supporting evidence.` });
  });
  for (const message of balanceSheetIssues(ruleSetForYear(d.ruleSets, ret.year), ret.balanceSheet ?? [])) issues.push({ step: "assets", message });
  if (!ret.declarationAccepted) issues.push({ step: "review", message: "Confirm the declaration before you submit." });
  return issues;
}

/**
 * Sync the year's statement from DK Bank (simulated): the statement is filed as the bank
 * statement of every source it lists, and replaces sources listed by an earlier sync.
 */
export function syncDkBankStatement(d: Db, actor: Actor, returnId: string) {
  const ret = getReturn(d, returnId);
  requireOwner(actor, owner(ret));
  if (ret.submissionStatus !== "DRAFT") throw new ServiceError("This return has been submitted and can no longer be edited.", "CONFLICT");
  if (!returnScope(d, ret).additionalIncome) throw new ServiceError("Foreign nationals declare employment income only.");
  const statement = providers(d.config).bank.statementCredits(ret.year);
  const taxpayer = d.taxpayers.find((t) => t.id === ret.taxpayerId);
  logIntegration(d, "DK_BANK", "statementSync", taxpayer?.identifierValue ?? ret.taxpayerId, statement ? "SUCCESS" : "UNAVAILABLE", statement?.reference ?? "—");
  if (!statement) throw new ServiceError("DK Bank (simulated) is unavailable. Try again later, or upload a bank statement instead.");
  const doc = uploadDocument(d, actor, { category: "BANK_STATEMENT", title: `DK Bank statement ${ret.year} (synced)`, fileName: `dk-bank-statement-${ret.year}.pdf`, mimeType: "application/pdf", sizeBytes: 210_000, owner: owner(ret), related: { kind: "INDIVIDUAL_RETURN", id: ret.id } });
  const items = ruleSetForYear(d.ruleSets, ret.year).taxItems;
  const synced: IncomeSource[] = statement.credits.map((c, i) => {
    const item = items.find((x) => x.key === c.category);
    return { id: `${ret.id}-dkb-${Date.now().toString(36)}-${i}`, ...c, classification: item ? defaultSourceClassification(item) : "TAXABLE", bankStatementDocId: doc.id, supportingDocIds: [], statementSource: "DK_BANK" as const };
  });
  ret.incomeSources = [...ret.incomeSources.filter((s) => s.statementSource !== "DK_BANK"), ...synced];
  ret.lastSavedAt = nowIso();
  recalculate(d, ret);
  audit(d, actor, "STATEMENT_SYNCED", "IndividualTaxReturn", ret.id, `DK Bank statement synced (${synced.length} income credits, ${statement.account})`);
  return { ret, account: statement.account, count: synced.length };
}

export function submitReturn(d: Db, actor: Actor, returnId: string) {
  const ret = getReturn(d, returnId);
  requireOwner(actor, owner(ret));
  if (ret.submissionStatus === "SUBMITTED") throw new ServiceError("This return was already submitted.", "CONFLICT");
  recalculate(d, ret);
  const issues = validateReturn(d, ret);
  if (issues.length) throw new ServiceError(issues[0]!.message);
  if (d.config.payBeforeSubmit && ret.calculation!.balanceMinor > 0) {
    const l = selfAssessmentFor(d, ret.id);
    if (!l || l.amountMinor !== ret.calculation!.balanceMinor || l.paidMinor < l.amountMinor) throw new ServiceError("Pay the balance through DK Bank first. Your return is submitted as soon as the payment is confirmed.");
  }
  const now = nowIso();
  ret.submissionStatus = "SUBMITTED";
  ret.submittedAt = now;
  ret.reference = nextReference(d, "IIT", ret.year);
  ret.lastSavedAt = now;
  const ack = generateDocument(d, actor.id, "SUBMISSION_ACK", `Acknowledgement Certificate · Individual Income Tax Return ${ret.year}`, owner(ret), { kind: "INDIVIDUAL_RETURN", id: ret.id });
  ret.ackDocId = ack.id;
  const assessment = { id: nextId(d, "ASM"), returnKind: "INDIVIDUAL" as const, returnId: ret.id, owner: owner(ret), year: ret.year, status: "NOT_ASSIGNED" as const, notes: [], adjustments: [], createdAt: now };
  d.assessments.push(assessment);
  ret.assessmentId = assessment.id;
  const officerId = autoAssign(d, assessment);
  audit(d, actor, "RETURN_SUBMITTED", "IndividualTaxReturn", ret.id, `Individual return ${ret.reference} submitted`);
  notify(d, { owner: owner(ret) }, "Return submitted", `Your ${ret.year} Individual Income Tax Return ${ret.reference} was received. Your Acknowledgement Certificate is ready.`, `/returns/${ret.id}`);
  if (!officerId) notify(d, { role: "ASSESSOR" }, "New individual return", `${ret.reference} is waiting to be assigned.`, `/gmca/cases/${assessment.id}`);
  return ret;
}

/**
 * Version 1 flow: check the return, then open a DK Bank payment for the estimated balance.
 * The return is submitted automatically when the bank confirms (see payments.ts).
 */
export function payAndSubmit(d: Db, actor: Actor, returnId: string) {
  const ret = getReturn(d, returnId);
  requireOwner(actor, owner(ret));
  if (ret.submissionStatus !== "DRAFT") throw new ServiceError("This return was already submitted.", "CONFLICT");
  if (pendingPrepayment(d, ret.id)) throw new ServiceError("A payment for this return is already pending with DK Bank. Check its status first.", "CONFLICT");
  recalculate(d, ret);
  const issues = validateReturn(d, ret);
  if (issues.length) throw new ServiceError(issues[0]!.message);
  const balance = ret.calculation!.balanceMinor;
  if (balance <= 0) throw new ServiceError("There is nothing to pay. Submit the return instead.");
  let l = selfAssessmentFor(d, ret.id);
  if (l && l.paidMinor > 0 && l.amountMinor !== balance) throw new ServiceError("Part of this balance is already paid. Contact GMCA to change the return.", "CONFLICT");
  if (!l) {
    l = { id: nextId(d, "LIA"), reference: nextReference(d, "LIA", ret.year), owner: owner(ret), source: "INDIVIDUAL_SELF_ASSESSMENT", sourceId: ret.id, description: `Individual Income Tax ${ret.year} · paid with return`, amountMinor: balance, currency: ret.calculation!.reportingCurrency, paidMinor: 0, createdAt: nowIso() };
    d.liabilities.push(l);
  } else l.amountMinor = balance;
  const liabilityId = l.id;
  return initiatePayment(d, actor, liabilityId, balance - l.paidMinor);
}
