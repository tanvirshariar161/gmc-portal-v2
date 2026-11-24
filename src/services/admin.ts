import { audit, nextId, notify, ServiceError, type Actor } from "../domain/store";
import { require } from "../domain/permissions";
import type { BankMode, Db, ExchangeRate, IntegrationMode, PlatformConfig, ResidencyStatus, Role, TaxRuleSet, User } from "../domain/types";
import { nowIso } from "./clock";
import { classMatches, PROFILES, profileLabel, TREATMENTS } from "./classification";

// ---------- Users and roles ----------

export function createStaffUser(d: Db, actor: Actor, input: { name: string; email: string; role: Extract<Role, "ASSESSOR" | "ADMIN">; title: string }) {
  require(actor, "admin.users");
  if (!input.name.trim()) throw new ServiceError("Enter the officer's full name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) throw new ServiceError("Enter a valid email address.");
  if (d.users.some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase())) throw new ServiceError("This email address already has an account.", "CONFLICT");
  const u: User = { id: nextId(d, "USR"), name: input.name.trim(), email: input.email.trim(), role: input.role, title: input.title.trim() || undefined, status: "ACTIVE", createdAt: nowIso() };
  d.users.push(u);
  audit(d, actor, "USER_CREATED", "User", u.id, `${u.name} created as ${input.role.toLowerCase()}`);
  return u;
}

export function setUserStatus(d: Db, actor: Actor, userId: string, status: User["status"]) {
  require(actor, "admin.users");
  const u = d.users.find((x) => x.id === userId);
  if (!u) throw new ServiceError("User not found.", "NOT_FOUND");
  if (u.id === actor.id) throw new ServiceError("You can't deactivate your own account.");
  if (status === "DEACTIVATED" && u.role === "ADMIN" && d.users.filter((x) => x.role === "ADMIN" && x.status === "ACTIVE").length <= 1) throw new ServiceError("At least one active administrator is required.");
  u.status = status;
  audit(d, actor, status === "ACTIVE" ? "USER_REACTIVATED" : "USER_DEACTIVATED", "User", u.id, `${u.name} ${status === "ACTIVE" ? "reactivated" : "deactivated"}`);
}

export function setStaffRole(d: Db, actor: Actor, userId: string, role: Extract<Role, "ASSESSOR" | "ADMIN">) {
  require(actor, "admin.users");
  const u = d.users.find((x) => x.id === userId);
  if (!u) throw new ServiceError("User not found.", "NOT_FOUND");
  if (u.role !== "ASSESSOR" && u.role !== "ADMIN") throw new ServiceError("Taxpayer and employer roles come from registration and can't be changed here.");
  if (u.id === actor.id) throw new ServiceError("You can't change your own role.");
  const from = u.role;
  u.role = role;
  audit(d, actor, "ROLE_CHANGED", "User", u.id, `${u.name}: ${from.toLowerCase()} → ${role.toLowerCase()}`);
}

// ---------- Taxpayer records ----------

/** Tax officers record residency from the taxpayer record. */
export function setResidency(d: Db, actor: Actor, taxpayerId: string, status: ResidencyStatus, reason: string) {
  require(actor, "taxpayers.manage");
  const t = d.taxpayers.find((x) => x.id === taxpayerId);
  if (!t) throw new ServiceError("Taxpayer not found.", "NOT_FOUND");
  if (!reason.trim()) throw new ServiceError("Record the basis for this residency determination.");
  const from = t.residencyStatus;
  t.residencyStatus = status;
  audit(d, actor, "RESIDENCY_RECORDED", "IndividualTaxpayer", t.id, `Residency ${from.toLowerCase().replace("_", " ")} → ${status.toLowerCase().replace("_", " ")}: ${reason.trim()}`);
  notify(d, { owner: { kind: "INDIVIDUAL", id: t.id } }, "Residency status updated", "GMCA updated your tax residency status. Draft calculations now use it.", "/profile");
}

// ---------- Tax rules (versioned; submitted snapshots keep the version they used) ----------

export function publishRuleSet(d: Db, actor: Actor, baseId: string, changes: Partial<Omit<TaxRuleSet, "id" | "version" | "createdAt" | "createdBy" | "status">>, reason: string) {
  require(actor, "admin.config");
  const base = d.ruleSets.find((r) => r.id === baseId);
  if (!base) throw new ServiceError("Rule set not found.", "NOT_FOUND");
  if (!reason.trim()) throw new ServiceError("Record why the rules are changing.");
  const merged = { ...structuredClone(base), ...structuredClone(changes) };
  if (!Number.isInteger(merged.effectiveFromYear) || merged.effectiveFromYear < 2025 || merged.effectiveFromYear > 2100) throw new ServiceError("Choose a financial year from 2025 to 2100.");
  const next: TaxRuleSet = { ...merged, id: nextId(d, "RULES"), version: nextVersion(d, merged.effectiveFromYear), status: "ACTIVE", createdBy: actor.id, createdAt: nowIso() };
  validateRuleSet(next);
  for (const r of d.ruleSets) if (r.status === "ACTIVE" && r.effectiveFromYear === next.effectiveFromYear) r.status = "RETIRED";
  d.ruleSets.unshift(next);
  audit(d, actor, "RULESET_PUBLISHED", "TaxRuleSet", next.id, `Rule set ${next.version} for ${next.effectiveFromYear} published (from ${base.version}): ${reason.trim()}`);
  return next;
}

function nextVersion(d: Db, year: number) {
  const n = d.ruleSets.filter((r) => r.effectiveFromYear === year).length + 1;
  return `FY${year}.${n}`;
}

function checkBands(name: string, bands: TaxRuleSet["individualBands"]) {
  if (!bands.length) throw new ServiceError(`${name}: add at least one band.`);
  bands.forEach((b, i) => {
    if (b.ratePct < 0 || b.ratePct > 100) throw new ServiceError(`${name}: rates must be between 0 and 100%.`);
    if (i === 0 && b.fromMinor !== 0) throw new ServiceError(`${name}: the first band starts at zero.`);
    const prev = bands[i - 1];
    if (prev && prev.toMinor !== b.fromMinor) throw new ServiceError(`${name}: band ${i + 1} must start where band ${i} ends.`);
    if (b.toMinor !== null && b.toMinor <= b.fromMinor) throw new ServiceError(`${name}: band ${i + 1} ends before it starts.`);
    if (i < bands.length - 1 && b.toMinor === null) throw new ServiceError(`${name}: only the last band can be open-ended.`);
  });
  if (bands[bands.length - 1]!.toMinor !== null) throw new ServiceError(`${name}: the last band must be open-ended.`);
}

export function validateRuleSet(r: TaxRuleSet) {
  checkBands("Individual bands", r.individualBands);
  checkBands("Monthly TDS table", r.tdsBands);
  if (!(r.healthRatePct >= 0 && r.healthRatePct <= 100)) throw new ServiceError("Rates must be between 0 and 100%.");
  const keys = new Set<string>();
  for (const rel of r.reliefs) {
    if (!rel.label.trim()) throw new ServiceError("Every relief needs a name.");
    if (keys.has(rel.key)) throw new ServiceError(`Duplicate relief key ${rel.key}.`);
    keys.add(rel.key);
  }
  validateClasses(r);
  validateItems(r);
}

const isRate = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0 && v <= 100;

function validateClasses(r: TaxRuleSet) {
  const keys = new Set<string>();
  for (const c of r.taxpayerClasses) {
    const name = c.label.trim() || "A taxpayer class";
    if (!c.label.trim()) throw new ServiceError("Every taxpayer class needs a name.");
    if (keys.has(c.key)) throw new ServiceError(`Duplicate taxpayer class key ${c.key}.`);
    keys.add(c.key);
    if (c.rateBasis === "FLAT" && !isRate(c.flatRatePct)) throw new ServiceError(`${name}: enter a flat rate between 0 and 100%.`);
    if (c.rateBasis !== "FLAT" && c.flatRatePct !== null) throw new ServiceError(`${name}: a flat rate is set but the class uses the Income Tax Act bands.`);
    if (c.lastIncomeYear !== null && !(Number.isInteger(c.lastIncomeYear) && c.lastIncomeYear >= r.effectiveFromYear)) throw new ServiceError(`${name}: the last income year must be ${r.effectiveFromYear} or later, or left blank.`);
  }
  // Every taxpayer must still resolve once every sunset has passed.
  for (const p of PROFILES) {
    if (!r.taxpayerClasses.some((c) => c.enabled && c.lastIncomeYear === null && classMatches(c, p))) throw new ServiceError(`No enabled class without an end year covers ${profileLabel(p)}. Add a general class at the bottom of the list.`);
  }
}

function validateItems(r: TaxRuleSet) {
  const keys = new Set<string>();
  for (const i of r.taxItems) {
    const name = i.label.trim();
    if (!name) throw new ServiceError("Every tax item needs a name.");
    if (keys.has(i.key)) throw new ServiceError(`Duplicate tax item key ${i.key}.`);
    keys.add(i.key);
    const meta = TREATMENTS.find((t) => t.value === i.treatment && t.kind === i.kind);
    if (!meta) throw new ServiceError(`${name}: choose a treatment that fits ${i.kind.toLowerCase()} items.`);
    if (i.kind === "EXPENSE" && i.appliesTo !== "CORPORATE") throw new ServiceError(`${name}: expenses apply to business returns only.`);
    if (i.investment && i.kind !== "ASSET") throw new ServiceError(`${name}: only assets can be investments.`);
    if (i.appliesTo !== "CORPORATE" && i.kind === "ASSET" && i.treatment !== "NOT_DEPRECIABLE") throw new ServiceError(`${name}: assets individuals declare take no allowance. Set the treatment to No allowance, or apply it to businesses only.`);
    if (!meta.rate && i.ratePct !== null) throw new ServiceError(`${name}: ${meta.label.toLowerCase()} takes no rate.`);
    if (meta.rate && (meta.rate.required || i.ratePct !== null) && !isRate(i.ratePct)) throw new ServiceError(`${name}: enter the ${meta.rate.label.replace(" %", "").toLowerCase()} as a percentage between 0 and 100.`);
    if (i.treatment === "CAPITAL_ALLOWANCE" ? !i.allowanceMethod : i.allowanceMethod !== null) throw new ServiceError(`${name}: ${i.treatment === "CAPITAL_ALLOWANCE" ? "choose straight line or reducing balance" : "an allowance method applies to capital allowances only"}.`);
    if ((i.kind === "INCOME") !== (i.origin !== null)) throw new ServiceError(`${name}: ${i.kind === "INCOME" ? "choose where the income arises" : "only income items have an origin"}.`);
  }
  if (!r.taxItems.some((i) => i.enabled && i.kind === "INCOME" && i.appliesTo !== "CORPORATE")) throw new ServiceError("Keep at least one income item available to individuals: taxpayers choose from them when they add an income source.");
}

// ---------- Incentives (approved outside the platform; recorded here) ----------

export function recordIncentive(d: Db, actor: Actor, input: { companyId: string; ratePct: number; effectiveFrom: string; effectiveTo: string; approvalReference: string; notes: string }) {
  require(actor, "admin.incentives");
  const company = d.companies.find((c) => c.id === input.companyId);
  if (!company) throw new ServiceError("Choose a company.");
  if (!(input.ratePct >= 0 && input.ratePct <= 100)) throw new ServiceError("Enter a rate between 0 and 100%.");
  if (!input.effectiveFrom || !input.effectiveTo || input.effectiveTo < input.effectiveFrom) throw new ServiceError("Enter a valid effective period.");
  if (!input.approvalReference.trim()) throw new ServiceError("Enter GMCA's approval reference.");
  const overlap = d.incentives.find((i) => i.companyId === company.id && i.status === "ACTIVE" && i.effectiveFrom <= input.effectiveTo && i.effectiveTo >= input.effectiveFrom);
  if (overlap) throw new ServiceError(`${company.name} already has an active incentive (${overlap.approvalReference}) in this period. Revoke it first.`, "CONFLICT");
  const inc = { id: nextId(d, "INC"), ...input, approvalReference: input.approvalReference.trim(), recordedBy: actor.id, recordedAt: nowIso(), status: "ACTIVE" as const };
  d.incentives.push(inc);
  audit(d, actor, "INCENTIVE_RECORDED", "CompanyTaxIncentive", inc.id, `${company.name}: ${input.ratePct}% from ${input.effectiveFrom} to ${input.effectiveTo} (${inc.approvalReference})`);
  notify(d, { owner: { kind: "COMPANY", id: company.id } }, "Approved tax incentive recorded", `GMCA recorded a ${input.ratePct}% incentive rate for ${input.effectiveFrom} to ${input.effectiveTo}.`, "/company/profile");
  return inc;
}

export function revokeIncentive(d: Db, actor: Actor, id: string, reason: string) {
  require(actor, "admin.incentives");
  const inc = d.incentives.find((i) => i.id === id);
  if (!inc) throw new ServiceError("Incentive not found.", "NOT_FOUND");
  if (!reason.trim()) throw new ServiceError("Record why the incentive is revoked.");
  inc.status = "REVOKED";
  audit(d, actor, "INCENTIVE_REVOKED", "CompanyTaxIncentive", inc.id, `${inc.approvalReference} revoked: ${reason.trim()}`);
}

// ---------- Currency ----------

export function setCurrencyEnabled(d: Db, actor: Actor, code: string, enabled: boolean) {
  require(actor, "admin.config");
  const c = d.config.currencies.find((x) => x.code === code);
  if (!c) throw new ServiceError("Currency not found.", "NOT_FOUND");
  if (!enabled && code === d.config.reportingCurrency) throw new ServiceError("The reporting currency must stay enabled.");
  c.enabled = enabled;
  audit(d, actor, "CURRENCY_UPDATED", "Currency", code, `${code} ${enabled ? "enabled" : "disabled"}`);
}

export function addCurrency(d: Db, actor: Actor, code: string, name: string) {
  require(actor, "admin.config");
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new ServiceError("Use a three-letter ISO currency code, like GBP.");
  if (d.config.currencies.some((x) => x.code === c)) throw new ServiceError(`${c} is already listed.`, "CONFLICT");
  d.config.currencies.push({ code: c, name: name.trim() || c, enabled: true });
  audit(d, actor, "CURRENCY_ADDED", "Currency", c, `${c} added`);
}

export function addExchangeRate(d: Db, actor: Actor, input: Omit<ExchangeRate, "id" | "isDemo">) {
  require(actor, "admin.config");
  if (input.currency === d.config.reportingCurrency) throw new ServiceError("The reporting currency always converts at 1.");
  if (!(input.rate > 0)) throw new ServiceError("Enter a rate greater than zero.");
  if (!input.effectiveDate) throw new ServiceError("Enter the date the rate takes effect.");
  if (d.config.exchangeRates.some((r) => r.currency === input.currency && r.effectiveDate === input.effectiveDate)) throw new ServiceError(`A ${input.currency} rate already exists for ${input.effectiveDate}.`, "CONFLICT");
  const rate: ExchangeRate = { id: nextId(d, "FX"), ...input, source: input.source.trim() || "Illustrative rate", isDemo: true };
  // Rates are stored as reporting-currency units per one unit of the currency.
  d.config.exchangeRates.push(rate);
  audit(d, actor, "EXCHANGE_RATE_ADDED", "ExchangeRate", rate.id, `${input.currency} = ${input.rate} ${d.config.reportingCurrency} from ${input.effectiveDate}`);
}

export function setPlatformSetting(d: Db, actor: Actor, patch: Partial<Pick<PlatformConfig, "reportingCurrency" | "conversionDateRule" | "informationRequestDays" | "currentFilingYear" | "currentPayrollPeriod" | "filingDeadlineMonthDay" | "payBeforeSubmit">>) {
  require(actor, "admin.config");
  if (patch.reportingCurrency && !d.config.currencies.some((c) => c.code === patch.reportingCurrency && c.enabled)) throw new ServiceError("Choose an enabled currency.");
  if (patch.informationRequestDays !== undefined && !(patch.informationRequestDays >= 1 && patch.informationRequestDays <= 365)) throw new ServiceError("Response days must be between 1 and 365.");
  if (patch.filingDeadlineMonthDay !== undefined && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(patch.filingDeadlineMonthDay)) throw new ServiceError("Enter the deadline as MM-DD, for example 04-30.");
  if (patch.currentPayrollPeriod !== undefined && !/^\d{4}-\d{2}$/.test(patch.currentPayrollPeriod)) throw new ServiceError("Choose a payroll month.");
  if (patch.reportingCurrency && patch.reportingCurrency !== d.config.reportingCurrency && d.config.exchangeRates.length) {
    // Rates are quoted against the reporting currency; changing it invalidates them in this demo.
    throw new ServiceError("Changing the reporting currency would invalidate every configured rate. Reset the data or confirm GMCA's reporting currency first.", "CONFLICT");
  }
  Object.assign(d.config, patch);
  audit(d, actor, "SETTINGS_UPDATED", "PlatformConfig", "config", `Settings changed: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

// ---------- Demo integration behaviour ----------

export function setIntegrationMode(d: Db, actor: Actor, key: "ndi" | "immigration" | "companyRegistry", mode: IntegrationMode) {
  require(actor, "admin.integrations");
  d.config.integrations[key] = mode;
  audit(d, actor, "INTEGRATION_MODE", "PlatformConfig", key, `${key} simulator set to ${mode.toLowerCase().replace(/_/g, " ")}`);
}

export function setBankMode(d: Db, actor: Actor, mode: BankMode, pendingResolvesTo: "SUCCESS" | "FAILURE") {
  require(actor, "admin.integrations");
  d.config.integrations.dkBank = mode;
  d.config.integrations.pendingResolvesTo = pendingResolvesTo;
  audit(d, actor, "INTEGRATION_MODE", "PlatformConfig", "dkBank", `DK Bank simulator: ${mode.toLowerCase()}, pending resolves to ${pendingResolvesTo.toLowerCase()}`);
}
