import type { CompanyType, IncomeSource, ResidencyStatus, TaxItem, TaxItemKind, TaxpayerCategory, TaxpayerClass, TaxRuleSet, TaxTreatment } from "../domain/types";

/**
 * Taxpayer classes and the tax item catalogue. Pure lookups over a rule set, shared by the
 * calculation engine, the taxpayer screens and the administrator's editor.
 */

export type TaxpayerProfile = { regime: "INDIVIDUAL"; citizenship: TaxpayerCategory; residency: ResidencyStatus } | { regime: "CORPORATE"; entityType: CompanyType };

export const CITIZENSHIP_LABEL: Record<TaxpayerCategory | "ANY", string> = { ANY: "Any citizenship", CITIZEN: "Bhutanese citizen", FOREIGN: "Foreign national" };
export const RESIDENCY_LABEL: Record<ResidencyStatus | "ANY", string> = { ANY: "Any residency", RESIDENT: "Resident", NON_RESIDENT: "Non-resident", NOT_DETERMINED: "Not determined" };
export const ENTITY_LABEL: Record<CompanyType | "ANY", string> = { ANY: "Any entity type", COMPANY: "Company", SOLE_PROPRIETORSHIP: "Sole proprietorship" };

/** Every taxpayer the platform can hold. Each must resolve to a class for the rules to be publishable. */
export const PROFILES: TaxpayerProfile[] = [
  ...(["CITIZEN", "FOREIGN"] as const).flatMap((citizenship) => (["RESIDENT", "NON_RESIDENT", "NOT_DETERMINED"] as const).map((residency) => ({ regime: "INDIVIDUAL" as const, citizenship, residency }))),
  ...(["COMPANY", "SOLE_PROPRIETORSHIP"] as const).map((entityType) => ({ regime: "CORPORATE" as const, entityType }))
];

export function profileLabel(p: TaxpayerProfile) {
  return p.regime === "INDIVIDUAL" ? `${CITIZENSHIP_LABEL[p.citizenship]} · ${RESIDENCY_LABEL[p.residency]}` : ENTITY_LABEL[p.entityType];
}

export function classMatches(c: TaxpayerClass, p: TaxpayerProfile) {
  if (c.regime !== p.regime) return false;
  if (p.regime === "INDIVIDUAL") return (c.citizenship === "ANY" || c.citizenship === p.citizenship) && (c.residency === "ANY" || c.residency === p.residency);
  return c.entityType === "ANY" || c.entityType === p.entityType;
}

/** The first enabled class, in order, that matches the taxpayer and covers the income year. */
export function findTaxpayerClass(rules: TaxRuleSet, p: TaxpayerProfile, year: number): TaxpayerClass | undefined {
  return rules.taxpayerClasses.find((c) => c.enabled && classMatches(c, p) && (c.lastIncomeYear === null || year <= c.lastIncomeYear));
}

export function resolveTaxpayerClass(rules: TaxRuleSet, p: TaxpayerProfile, year: number): TaxpayerClass {
  const c = findTaxpayerClass(rules, p, year);
  if (!c) throw new Error(`Rule set ${rules.version} has no taxpayer class for ${profileLabel(p)} in ${year}.`);
  return c;
}

export const classForTaxpayer = (rules: TaxRuleSet, t: { category: TaxpayerCategory; residencyStatus: ResidencyStatus }, year: number) =>
  resolveTaxpayerClass(rules, { regime: "INDIVIDUAL", citizenship: t.category, residency: t.residencyStatus }, year);

export const classForCompany = (rules: TaxRuleSet, type: CompanyType, year: number) => resolveTaxpayerClass(rules, { regime: "CORPORATE", entityType: type }, year);

export function describeRate(c: TaxpayerClass) {
  return c.rateBasis === "FLAT" ? `${c.flatRatePct}%` : "Income Tax Act bands";
}

// ---------- Tax item catalogue ----------

export type BookTaxDifference = "NONE" | "PERMANENT" | "TEMPORARY";

export type TreatmentMeta = {
  value: TaxTreatment;
  kind: TaxItemKind;
  label: string;
  help: string;
  /** The meaning of `ratePct` for this treatment. Absent: the treatment takes no rate. */
  rate?: { label: string; required: boolean; hint?: string };
  /** How the treatment makes taxable profit differ from accounting profit. */
  difference: BookTaxDifference;
};

export const TREATMENTS: TreatmentMeta[] = [
  { kind: "INCOME", value: "TAXABLE", label: "Taxable", help: "Included in chargeable income.", difference: "NONE" },
  { kind: "INCOME", value: "EXEMPT", label: "Exempt", help: "Reported on the return but left out of chargeable income.", difference: "PERMANENT" },
  { kind: "INCOME", value: "FINAL_WITHHOLDING", label: "Final withholding", help: "Taxed by the payer at source. The tax withheld is final, so the income is left out of chargeable income.", rate: { label: "Withholding rate %", required: true }, difference: "PERMANENT" },
  { kind: "EXPENSE", value: "DEDUCTIBLE", label: "Deductible", help: "Deducted in full in the year it is incurred.", difference: "NONE" },
  { kind: "EXPENSE", value: "PARTLY_DEDUCTIBLE", label: "Partly deductible", help: "Only the stated share is deducted. The rest is added back.", rate: { label: "Deductible share %", required: true }, difference: "PERMANENT" },
  { kind: "EXPENSE", value: "NOT_DEDUCTIBLE", label: "Not deductible", help: "Added back to accounting profit.", difference: "PERMANENT" },
  { kind: "EXPENSE", value: "CAPITALISED", label: "Capitalised", help: "Not deducted as an expense. It becomes the cost of an asset and is relieved through that asset's treatment.", difference: "TEMPORARY" },
  { kind: "ASSET", value: "CAPITAL_ALLOWANCE", label: "Capital allowance", help: "Accounting depreciation is added back and a capital allowance is deducted each year instead.", rate: { label: "Annual allowance %", required: true, hint: "Straight line: the share of cost each year (20% = five years). Reducing balance: the share of the remaining value." }, difference: "TEMPORARY" },
  { kind: "ASSET", value: "IMMEDIATE_WRITE_OFF", label: "Written off in full", help: "The whole cost is deducted in the year of purchase.", difference: "TEMPORARY" },
  { kind: "ASSET", value: "NOT_DEPRECIABLE", label: "No allowance", help: "No capital allowance. Any accounting depreciation or write-down is added back.", difference: "PERMANENT" },
  { kind: "LIABILITY", value: "DEDUCTIBLE_WHEN_PAID", label: "Deductible when paid", help: "The accrued expense is added back until it is actually paid, then deducted.", difference: "TEMPORARY" },
  { kind: "LIABILITY", value: "INTEREST_DEDUCTIBLE", label: "Interest deductible", help: "Interest on the liability is deductible, up to the limit if one is set.", rate: { label: "Interest limit, % of EBITDA", required: false, hint: "Leave blank for no limit." }, difference: "NONE" },
  { kind: "LIABILITY", value: "NO_TAX_EFFECT", label: "No tax effect", help: "Settling or remeasuring the liability doesn't change taxable profit.", difference: "NONE" }
];

export const treatmentsFor = (kind: TaxItemKind) => TREATMENTS.filter((t) => t.kind === kind);
export const treatmentMeta = (value: TaxTreatment) => TREATMENTS.find((t) => t.value === value)!;

export const KIND_LABEL: Record<TaxItemKind, { plural: string; singular: string; description: string }> = {
  INCOME: { plural: "Income", singular: "income item", description: "Types of income and whether they are charged. Individual items are the categories taxpayers choose from when they add an income source." },
  EXPENSE: { plural: "Expenses", singular: "expense", description: "Business expenses and how much of each is deductible from accounting profit." },
  ASSET: { plural: "Assets", singular: "asset class", description: "Classes of business assets and the capital allowance given in place of accounting depreciation." },
  LIABILITY: { plural: "Liabilities", singular: "liability", description: "Business liabilities: provisions deducted only when paid, and borrowings whose interest is deductible." }
};

export const DIFFERENCE_LABEL: Record<BookTaxDifference, string> = { NONE: "No book–tax difference", PERMANENT: "Permanent difference", TEMPORARY: "Temporary difference (deferred tax)" };

export function describeItemTreatment(i: TaxItem) {
  const m = treatmentMeta(i.treatment);
  if (i.treatment === "CAPITAL_ALLOWANCE") return `${m.label} · ${i.ratePct}% ${i.allowanceMethod === "REDUCING_BALANCE" ? "reducing balance" : "straight line"}`;
  if (m.rate && i.ratePct !== null) return `${m.label} · ${i.ratePct}%`;
  return m.label;
}

/** Income categories offered on an individual return, in catalogue order. */
export function individualIncomeItems(rules: TaxRuleSet): TaxItem[] {
  return rules.taxItems.filter((i) => i.enabled && i.kind === "INCOME" && i.appliesTo !== "CORPORATE");
}

/** Default classification of a new income source in this category. Final-withholding income is left out of the charge. */
export function defaultSourceClassification(item: TaxItem): IncomeSource["classification"] {
  return item.treatment === "TAXABLE" ? "TAXABLE" : "EXEMPT";
}
