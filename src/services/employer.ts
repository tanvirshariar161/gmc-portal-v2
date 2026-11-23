import { audit, nextId, nextReference, notify, ServiceError, type Actor } from "../domain/store";
import { require, requireOwner } from "../domain/permissions";
import type { CorporateFinancials, CorporateTaxReturn, Db, Employee, EmployerMonthlyDeclaration, IdentifierType, TaxpayerCategory } from "../domain/types";
import { activeIncentive, calculateCorporate, healthContribution, monthlyTds, ruleSetForYear, summariseMonthly } from "./calc";
import { nowIso, today } from "./clock";
import { convert, conversionDateFor } from "./currency";
import { generateDocument } from "./documents";
import { providers } from "./integrations";
import { logIntegration } from "./registration";

const companyOwner = (companyId: string) => ({ kind: "COMPANY" as const, id: companyId });

function requireCompany(actor: Actor, companyId: string) {
  require(actor, "employer.manage");
  requireOwner(actor, companyOwner(companyId));
}

// ---------- Employee directory ----------

export type EmployeeInput = {
  fullName: string;
  category: TaxpayerCategory;
  identifierType: IdentifierType;
  identifierValue: string;
  position: string;
  startDate: string;
  endDate?: string;
  status: Employee["status"];
  defaultCurrency: string;
};

function validateEmployee(d: Db, input: EmployeeInput, companyId: string, exceptId?: string) {
  if (!input.fullName.trim()) throw new ServiceError("Enter the employee's full name.");
  if (!input.identifierValue.trim()) throw new ServiceError("Enter the employee's identifier.");
  if (input.category === "CITIZEN" && input.identifierType !== "CID") throw new ServiceError("Bhutanese employees are identified by Citizenship ID.");
  if (input.category === "FOREIGN" && input.identifierType === "CID") throw new ServiceError("Foreign employees are identified by work permit or passport number.");
  if (input.category === "CITIZEN" && !/^\d{11}$/.test(input.identifierValue.trim())) throw new ServiceError("A Citizenship ID has 11 digits.");
  if (!input.startDate) throw new ServiceError("Enter the employment start date.");
  if (input.endDate && input.endDate < input.startDate) throw new ServiceError("The end date is before the start date.");
  if (input.status === "LEFT" && !input.endDate) throw new ServiceError("Add the date the employee left.");
  const dup = d.employees.find((e) => e.companyId === companyId && e.id !== exceptId && e.identifierValue.toUpperCase() === input.identifierValue.trim().toUpperCase());
  if (dup) throw new ServiceError(`${dup.fullName} already uses this identifier.`, "CONFLICT");
}

function linkTaxpayer(d: Db, e: Employee) {
  e.taxpayerId = d.taxpayers.find((t) => t.identifierValue.toUpperCase() === e.identifierValue.toUpperCase())?.id;
}

export function verifyEmployee(d: Db, actor: Actor, employeeId: string) {
  const e = d.employees.find((x) => x.id === employeeId);
  if (!e) throw new ServiceError("Employee not found.", "NOT_FOUND");
  requireCompany(actor, e.companyId);
  const p = providers(d.config);
  if (e.category === "FOREIGN") {
    const r = p.immigration.verifyForeign(e.identifierType === "PASSPORT" ? "PASSPORT" : "WORK_PERMIT", e.identifierValue);
    logIntegration(d, "IMMIGRATION", "verifyEmployee", e.identifierValue, r.status, r.reference);
    e.verification = { provider: "IMMIGRATION", status: r.status === "MATCH" ? "VERIFIED" : r.status === "NO_MATCH" ? "NO_MATCH" : "NOT_VERIFIED", reference: r.reference, checkedAt: nowIso(), simulated: true };
    if (r.status === "UNAVAILABLE") throw new ServiceError("The simulated Immigration System is set to unavailable. Try again later.");
  } else {
    const known = d.taxpayers.find((t) => t.identifierValue === e.identifierValue);
    e.verification = { provider: "NDI", status: known ? "VERIFIED" : "NOT_VERIFIED", checkedAt: nowIso(), simulated: true };
  }
  linkTaxpayer(d, e);
  audit(d, actor, "EMPLOYEE_VERIFIED", "Employee", e.id, `${e.fullName}: ${e.verification.status.toLowerCase().replace("_", " ")}`);
  return e;
}

export function addEmployee(d: Db, actor: Actor, companyId: string, input: EmployeeInput) {
  requireCompany(actor, companyId);
  validateEmployee(d, input, companyId);
  const e: Employee = { id: nextId(d, "EMP"), companyId, ...input, fullName: input.fullName.trim(), identifierValue: input.identifierValue.trim(), verification: { provider: input.category === "FOREIGN" ? "IMMIGRATION" : "NDI", status: "NOT_VERIFIED", simulated: true } };
  d.employees.push(e);
  audit(d, actor, "EMPLOYEE_ADDED", "Employee", e.id, `${e.fullName} added to the employee directory`);
  verifyEmployee(d, actor, e.id);
  return e;
}

export function updateEmployee(d: Db, actor: Actor, employeeId: string, input: EmployeeInput) {
  const e = d.employees.find((x) => x.id === employeeId);
  if (!e) throw new ServiceError("Employee not found.", "NOT_FOUND");
  requireCompany(actor, e.companyId);
  validateEmployee(d, input, e.companyId, e.id);
  const idChanged = e.identifierValue !== input.identifierValue.trim() || e.category !== input.category;
  Object.assign(e, input, { fullName: input.fullName.trim(), identifierValue: input.identifierValue.trim() });
  audit(d, actor, "EMPLOYEE_UPDATED", "Employee", e.id, `${e.fullName} updated (status ${e.status.toLowerCase().replace("_", " ")})`);
  if (idChanged) verifyEmployee(d, actor, e.id);
  return e;
}

// ---------- Monthly TDS & health contributions ----------

export function periodEnd(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/** Active in the period: started on or before its last day and not left before its first day. */
export function employedInPeriod(e: Employee, period: string) {
  return e.startDate <= periodEnd(period) && (!e.endDate || e.endDate >= `${period}-01`);
}

export function ensureDeclaration(d: Db, actor: Actor, companyId: string, period: string): EmployerMonthlyDeclaration {
  requireCompany(actor, companyId);
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ServiceError("Choose a filing month.");
  const existing = d.monthlyDeclarations.find((x) => x.companyId === companyId && x.period === period);
  if (existing) return existing;
  const previous = d.monthlyDeclarations.filter((x) => x.companyId === companyId && x.period < period).sort((a, b) => b.period.localeCompare(a.period))[0];
  const decl: EmployerMonthlyDeclaration = {
    id: nextId(d, "MTD"),
    companyId,
    period,
    submissionStatus: "DRAFT",
    lines: d.employees
      .filter((e) => e.companyId === companyId && e.status !== "LEFT" && employedInPeriod(e, period))
      .map((e) => {
        const prev = previous?.lines.find((l) => l.employeeId === e.id);
        return { employeeId: e.id, employeeName: e.fullName, amountMinor: prev?.amountMinor ?? 0, currency: prev?.currency ?? e.defaultCurrency, tdsMinor: 0, healthMinor: 0 };
      }),
    lastSavedAt: nowIso()
  };
  recalcDeclaration(d, decl);
  d.monthlyDeclarations.push(decl);
  audit(d, actor, "DECLARATION_DRAFT_CREATED", "EmployerMonthlyDeclaration", decl.id, `Draft declaration for ${period}`);
  return decl;
}

export function recalcDeclaration(d: Db, decl: EmployerMonthlyDeclaration) {
  const rules = ruleSetForYear(d.ruleSets, Number(decl.period.slice(0, 4)));
  const date = conversionDateFor(d.config, periodEnd(decl.period), today());
  for (const line of decl.lines) {
    const emp = d.employees.find((e) => e.id === line.employeeId);
    const residency = d.taxpayers.find((t) => t.id === emp?.taxpayerId)?.residencyStatus ?? "NOT_DETERMINED";
    line.conversion = convert(d.config, line.amountMinor, line.currency, date);
    const reporting = line.conversion.reportingMinor;
    if (reporting === null) {
      line.tdsMinor = 0;
      line.healthMinor = 0;
      line.tdsNote = "Waiting for an exchange rate";
      continue;
    }
    const t = monthlyTds(reporting, rules, residency);
    line.tdsMinor = t.tdsMinor;
    line.tdsNote = t.note;
    line.healthMinor = healthContribution(reporting, rules, emp?.category ?? "CITIZEN");
  }
  decl.calculation = { ...summariseMonthly(decl.lines.map((l) => ({ reportingMinor: l.conversion?.reportingMinor ?? null, tdsMinor: l.tdsMinor, healthMinor: l.healthMinor })), rules, d.config.reportingCurrency, nowIso()), id: nextId(d, "CALC") };
}

export function saveDeclarationLines(d: Db, actor: Actor, declId: string, lines: { employeeId: string; amountMinor: number; currency: string }[]) {
  const decl = d.monthlyDeclarations.find((x) => x.id === declId);
  if (!decl) throw new ServiceError("Declaration not found.", "NOT_FOUND");
  requireCompany(actor, decl.companyId);
  if (decl.submissionStatus !== "DRAFT") throw new ServiceError("This declaration has been submitted and is locked.", "CONFLICT");
  const enabled = new Set(d.config.currencies.filter((c) => c.enabled).map((c) => c.code));
  for (const input of lines) {
    const line = decl.lines.find((l) => l.employeeId === input.employeeId);
    if (!line) continue;
    if (!enabled.has(input.currency)) throw new ServiceError(`${input.currency} is not an available currency.`);
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) throw new ServiceError(`Enter a valid amount for ${line.employeeName}.`);
    line.amountMinor = input.amountMinor;
    line.currency = input.currency;
  }
  decl.lastSavedAt = nowIso();
  recalcDeclaration(d, decl);
  return decl;
}

export function declarationIssues(decl: EmployerMonthlyDeclaration): string[] {
  const issues: string[] = [];
  if (!decl.lines.length) issues.push("No employees are included in this period.");
  for (const l of decl.lines) {
    if (l.amountMinor <= 0) issues.push(`${l.employeeName}: enter the month's remuneration.`);
    if (l.conversion?.status === "PENDING") issues.push(`${l.employeeName}: no exchange rate is configured for ${l.currency}.`);
  }
  return issues;
}

export function submitDeclaration(d: Db, actor: Actor, declId: string) {
  const decl = d.monthlyDeclarations.find((x) => x.id === declId);
  if (!decl) throw new ServiceError("Declaration not found.", "NOT_FOUND");
  requireCompany(actor, decl.companyId);
  if (decl.submissionStatus !== "DRAFT") throw new ServiceError("This declaration was already submitted.", "CONFLICT");
  recalcDeclaration(d, decl);
  const issues = declarationIssues(decl);
  if (issues.length) throw new ServiceError(issues[0]!);
  const now = nowIso();
  decl.submissionStatus = "SUBMITTED";
  decl.submittedAt = now;
  decl.submittedBy = actor.id;
  decl.reference = nextReference(d, "TDS", decl.period.replace("-", ""));
  const owner = companyOwner(decl.companyId);
  decl.ackDocId = generateDocument(d, actor.id, "SUBMISSION_ACK", `Acknowledgement Certificate · Monthly TDS & Health Contributions ${decl.period}`, owner, { kind: "MONTHLY_DECLARATION", id: decl.id }).id;
  const total = decl.calculation!.balanceMinor;
  if (total > 0) {
    const liability = { id: nextId(d, "LIA"), reference: nextReference(d, "LIA", decl.period.slice(0, 4)), owner, source: "MONTHLY_DECLARATION" as const, sourceId: decl.id, description: `TDS & health contributions · ${decl.period}`, amountMinor: total, currency: d.config.reportingCurrency, paidMinor: 0, createdAt: now };
    d.liabilities.push(liability);
    decl.liabilityId = liability.id;
  }
  audit(d, actor, "DECLARATION_SUBMITTED", "EmployerMonthlyDeclaration", decl.id, `Monthly declaration ${decl.reference} submitted for ${decl.lines.length} employees`);
  notify(d, { owner }, "Monthly declaration submitted", `${decl.reference} for ${decl.period} was received.`, `/company/payroll/${decl.period}`);
  return decl;
}

// ---------- Corporate income tax ----------

export function getCorporate(d: Db, id: string) {
  const r = d.corporateReturns.find((x) => x.id === id);
  if (!r) throw new ServiceError("Corporate return not found.", "NOT_FOUND");
  return r;
}

export function recalcCorporate(d: Db, r: CorporateTaxReturn) {
  const rules = ruleSetForYear(d.ruleSets, r.year);
  r.calculation = { ...calculateCorporate(r.financials, rules, activeIncentive(d.incentives, r.companyId, r.year), d.config.reportingCurrency, nowIso()), id: nextId(d, "CALC") };
}

export function ensureCorporateDraft(d: Db, actor: Actor, companyId: string, year: number) {
  requireCompany(actor, companyId);
  const existing = d.corporateReturns.find((x) => x.companyId === companyId && x.year === year);
  if (existing) return existing;
  const r: CorporateTaxReturn = { id: nextId(d, "CIT"), companyId, year, submissionStatus: "DRAFT", financials: { revenueMinor: 0, otherIncomeMinor: 0, expensesMinor: 0, adjustments: [] }, auditedFsDocIds: [], fixedAssetDocIds: [], declarationAccepted: false, lastSavedAt: nowIso() };
  recalcCorporate(d, r);
  d.corporateReturns.push(r);
  audit(d, actor, "CORPORATE_DRAFT_CREATED", "CorporateTaxReturn", r.id, `Draft corporate return started for ${year}`);
  return r;
}

export function saveCorporateDraft(d: Db, actor: Actor, id: string, patch: { financials?: CorporateFinancials; auditedFsDocIds?: string[]; fixedAssetDocIds?: string[]; declarationAccepted?: boolean }) {
  const r = getCorporate(d, id);
  requireCompany(actor, r.companyId);
  if (r.submissionStatus !== "DRAFT") throw new ServiceError("This return has been submitted and is locked.", "CONFLICT");
  if (patch.financials) {
    const f = patch.financials;
    for (const v of [f.revenueMinor, f.otherIncomeMinor, f.expensesMinor, ...f.adjustments.map((a) => a.amountMinor)]) if (!Number.isInteger(v)) throw new ServiceError("Amounts must be whole cents.");
    if (f.revenueMinor < 0 || f.otherIncomeMinor < 0 || f.expensesMinor < 0) throw new ServiceError("Revenue, other income and expenses can't be negative.");
    r.financials = f;
  }
  if (patch.auditedFsDocIds) r.auditedFsDocIds = patch.auditedFsDocIds;
  if (patch.fixedAssetDocIds) r.fixedAssetDocIds = patch.fixedAssetDocIds;
  if (patch.declarationAccepted !== undefined) r.declarationAccepted = patch.declarationAccepted;
  r.lastSavedAt = nowIso();
  recalcCorporate(d, r);
  return r;
}

export function corporateIssues(r: CorporateTaxReturn): { step: string; message: string }[] {
  const issues: { step: string; message: string }[] = [];
  if (r.financials.revenueMinor <= 0) issues.push({ step: "financials", message: "Enter the company's revenue for the year." });
  r.financials.adjustments.forEach((a, i) => {
    if (!a.label.trim()) issues.push({ step: "financials", message: `Adjustment ${i + 1}: describe the adjustment.` });
  });
  if (!r.auditedFsDocIds.length) issues.push({ step: "documents", message: "Upload the audited financial statements." });
  if (!r.fixedAssetDocIds.length) issues.push({ step: "documents", message: "Upload the fixed asset report." });
  if (!r.declarationAccepted) issues.push({ step: "review", message: "Confirm the declaration before you submit." });
  return issues;
}

export function submitCorporate(d: Db, actor: Actor, id: string) {
  const r = getCorporate(d, id);
  requireCompany(actor, r.companyId);
  if (r.submissionStatus !== "DRAFT") throw new ServiceError("This return was already submitted.", "CONFLICT");
  recalcCorporate(d, r);
  const issues = corporateIssues(r);
  if (issues.length) throw new ServiceError(issues[0]!.message);
  const now = nowIso();
  const owner = companyOwner(r.companyId);
  r.submissionStatus = "SUBMITTED";
  r.submittedAt = now;
  r.submittedBy = actor.id;
  r.reference = nextReference(d, "CIT", r.year);
  r.ackDocId = generateDocument(d, actor.id, "SUBMISSION_ACK", `Acknowledgement Certificate · Corporate Income Tax Return ${r.year}`, owner, { kind: "CORPORATE_RETURN", id: r.id }).id;
  const assessment = { id: nextId(d, "ASM"), returnKind: "CORPORATE" as const, returnId: r.id, owner, year: r.year, status: "NOT_ASSIGNED" as const, notes: [], adjustments: [], createdAt: now };
  d.assessments.push(assessment);
  r.assessmentId = assessment.id;
  audit(d, actor, "CORPORATE_SUBMITTED", "CorporateTaxReturn", r.id, `Corporate return ${r.reference} submitted`);
  notify(d, { owner }, "Corporate return submitted", `${r.reference} for ${r.year} was received.`, `/company/corporate/return/${r.id}`);
  notify(d, { role: "ASSESSOR" }, "New corporate return", `${r.reference} is waiting to be assigned.`, `/gmca/cases/${assessment.id}`);
  return r;
}
