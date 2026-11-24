import { formatAmount, formatRate, roundHalfUp, type Minor } from "../lib/money";
import type { Band, CalcLine, CalculationSnapshot, CompanyTaxIncentive, CorporateFinancials, Conversion, EmploymentIncomeLine, IncomeSource, ReliefClaim, ResidencyStatus, TaxRuleSet } from "../domain/types";

/**
 * Shared tax calculation engine. Pure functions over stored inputs and a versioned rule set,
 * so every snapshot is reproducible. All rule values are demo configuration until GMCA confirms them.
 */

export const DEMO_ASSUMPTION = "A calculation, not a formal assessment. GMCA assesses every return.";
export const RULE_SOURCES = "Individual bands from the GMC Income Tax Act 2025 and the monthly TDS table from GMCA's TDS note. Reliefs, health contribution and other values are demo configuration.";

export function progressiveTax(amount: Minor, bands: Band[]): Minor {
  let tax = 0;
  for (const b of bands) {
    if (amount <= b.fromMinor) break;
    const top = b.toMinor === null ? amount : Math.min(amount, b.toMinor);
    tax += (top - b.fromMinor) * (b.ratePct / 100);
  }
  return roundHalfUp(tax);
}

/** Monthly TDS brackets are inclusive at the top: ≤1,000 is 0%, >1,000 and ≤3,000 is 2%, and so on. */
/** Band-by-band working for the "Your tax" table. */
export function bandBreakdown(amount: Minor, bands: Band[]) {
  return bands.map((b) => {
    const top = b.toMinor === null ? amount : Math.min(amount, b.toMinor);
    const inBand = Math.max(0, top - b.fromMinor);
    return { band: b, inBandMinor: inBand, taxMinor: roundHalfUp(inBand * (b.ratePct / 100)) };
  });
}

export function bracketFor(amount: Minor, bands: Band[]): Band | undefined {
  return bands.find((b) => b.toMinor === null || amount <= b.toMinor);
}

export function pct(amount: Minor, ratePct: number): Minor {
  return roundHalfUp(amount * (ratePct / 100));
}

// ---------- Individual ----------

export type IndividualInput = {
  employment: EmploymentIncomeLine[];
  incomeSources: IncomeSource[];
  reliefs: ReliefClaim[];
  residency: ResidencyStatus;
};

export function calculateIndividual(input: IndividualInput, rules: TaxRuleSet, reportingCurrency: string, now = new Date().toISOString()): CalculationSnapshot {
  const lines: CalcLine[] = [];
  const warnings: string[] = [];
  const assumptions = [DEMO_ASSUMPTION, RULE_SOURCES];
  const fmt = (m: Minor) => formatAmount(m, reportingCurrency);

  const employmentMinor = input.employment.reduce((s, e) => s + e.grossMinor, 0);
  const tdsMinor = input.employment.reduce((s, e) => s + e.tdsMinor, 0);
  for (const e of input.employment) {
    lines.push({ key: `emp-${e.employerName}`, label: `Employment income · ${e.employerName}`, amountMinor: e.grossMinor, note: `Reported by employer for ${e.months} month${e.months === 1 ? "" : "s"}` });
  }

  let taxableOther = 0;
  let exempt = 0;
  for (const s of input.incomeSources) {
    const conv: Conversion | undefined = s.conversion;
    if (!conv || conv.status === "PENDING" || conv.reportingMinor === null) {
      warnings.push(`${s.description || "An income source"} in ${s.currency} has no configured exchange rate yet, so it is left out of the totals.`);
      continue;
    }
    const note = s.currency === reportingCurrency ? undefined : `${formatAmount(s.amountMinor, s.currency)} at ${formatRate(conv.rate!, s.currency, reportingCurrency)} (${conv.isDemoRate ? "demo rate" : conv.source}, ${conv.rateDate})`;
    lines.push({ key: `src-${s.id}`, label: `${s.classification === "EXEMPT" ? "Exempt" : "Additional"} income · ${s.description || s.category}`, amountMinor: conv.reportingMinor, note });
    if (s.classification === "EXEMPT") exempt += conv.reportingMinor;
    else taxableOther += conv.reportingMinor;
  }

  const totalIncome = employmentMinor + taxableOther + exempt;
  const taxableIncome = employmentMinor + taxableOther;
  lines.push({ key: "total-income", label: "Total income", amountMinor: totalIncome, tone: "sub" });
  if (exempt) lines.push({ key: "exempt", label: "Less exempt income", amountMinor: -exempt, note: "Classified as exempt by the taxpayer; GMCA may review" });
  lines.push({ key: "taxable", label: "Taxable income", amountMinor: taxableIncome, tone: "sub" });

  let reliefTotal = 0;
  for (const r of input.reliefs) {
    const rule = rules.reliefs.find((x) => x.key === r.reliefKey && x.enabled);
    if (!rule) {
      warnings.push(`A relief claim uses a category that is not configured in rule set ${rules.version}; it is left out.`);
      continue;
    }
    const allowed = rule.capMinor === null ? r.declaredMinor : Math.min(r.declaredMinor, rule.capMinor);
    if (allowed < r.declaredMinor) warnings.push(`${rule.label} is limited to the configured demo cap of ${fmt(rule.capMinor!)}.`);
    reliefTotal += allowed;
    lines.push({ key: `rel-${r.id}`, label: `Less relief · ${rule.label}`, amountMinor: -allowed, note: "Claimed. Evidence is reviewed by GMCA before the relief is accepted" });
  }
  const chargeable = Math.max(0, taxableIncome - reliefTotal);
  lines.push({ key: "chargeable", label: "Chargeable income", amountMinor: chargeable, tone: "sub" });

  let tax: Minor;
  if (input.residency === "NON_RESIDENT" && rules.nonResidentRatePct !== null) {
    tax = pct(chargeable, rules.nonResidentRatePct);
    lines.push({ key: "tax", label: `Tax at configured non-resident rate (${rules.nonResidentRatePct}%)`, amountMinor: tax, tone: "total" });
    assumptions.push("GMCA has recorded this taxpayer as non-resident. The non-resident rate is demo configuration pending GMCA's residency rules.");
  } else {
    tax = progressiveTax(chargeable, rules.individualBands);
    lines.push({ key: "tax", label: "Tax on chargeable income (Income Tax Act bands)", amountMinor: tax, tone: "total" });
    if (input.residency === "NOT_DETERMINED") assumptions.push("Residency has not been determined by GMCA, so the standard bands apply. Nationality alone never changes the rate.");
  }

  if (tdsMinor) lines.push({ key: "tds", label: "Less TDS reported by employers", amountMinor: -tdsMinor, tone: "credit" });
  const balance = tax - tdsMinor;
  if (balance < 0) {
    if (rules.excessCreditCarryForward === true) assumptions.push("Excess TDS is carried forward as a credit (configured rule).");
    else if (rules.excessCreditCarryForward === null) assumptions.push("Excess TDS is shown, but no carry-forward or refund rule is configured yet.");
  }
  lines.push({ key: "balance", label: balance >= 0 ? "Estimated balance payable" : "Estimated credit", amountMinor: balance, tone: "total" });

  const nonResident = input.residency === "NON_RESIDENT" && rules.nonResidentRatePct !== null;
  return {
    id: "",
    kind: "INDIVIDUAL",
    ruleSetId: rules.id,
    ruleSetVersion: rules.version,
    reportingCurrency,
    computedAt: now,
    lines,
    taxMinor: tax,
    creditsMinor: tdsMinor,
    balanceMinor: balance,
    warnings,
    assumptions,
    figures: { totalIncomeMinor: totalIncome, exemptMinor: exempt, taxableMinor: taxableIncome, reliefsMinor: reliefTotal, chargeableMinor: chargeable, nonResidentRatePct: nonResident ? rules.nonResidentRatePct! : undefined }
  };
}

// ---------- Employer monthly TDS and health ----------

export function monthlyTds(reportingMinor: Minor, rules: TaxRuleSet, residency: ResidencyStatus): { tdsMinor: Minor; note: string } {
  if (residency === "NON_RESIDENT" && rules.nonResidentRatePct !== null) {
    return { tdsMinor: pct(reportingMinor, rules.nonResidentRatePct), note: `Non-resident rate ${rules.nonResidentRatePct}% (recorded by GMCA)` };
  }
  if (rules.tdsMethod === "BRACKET_WHOLE_AMOUNT") {
    const band = bracketFor(reportingMinor, rules.tdsBands);
    const rate = band?.ratePct ?? 0;
    return { tdsMinor: pct(reportingMinor, rate), note: `${rate}% on the whole month (GMCA TDS table)` };
  }
  return { tdsMinor: progressiveTax(reportingMinor, rules.tdsBands), note: "Progressive monthly bands (demo)" };
}

export function healthContribution(reportingMinor: Minor, rules: TaxRuleSet, category: "CITIZEN" | "FOREIGN"): Minor {
  if (rules.healthAppliesTo === "CITIZENS" && category !== "CITIZEN") return 0;
  return pct(reportingMinor, rules.healthRatePct);
}

export function summariseMonthly(lines: { reportingMinor: Minor | null; tdsMinor: Minor; healthMinor: Minor }[], rules: TaxRuleSet, reportingCurrency: string, now = new Date().toISOString()): CalculationSnapshot {
  const gross = lines.reduce((s, l) => s + (l.reportingMinor ?? 0), 0);
  const tds = lines.reduce((s, l) => s + l.tdsMinor, 0);
  const health = lines.reduce((s, l) => s + l.healthMinor, 0);
  const pending = lines.filter((l) => l.reportingMinor === null).length;
  return {
    id: "",
    kind: "MONTHLY",
    ruleSetId: rules.id,
    ruleSetVersion: rules.version,
    reportingCurrency,
    computedAt: now,
    lines: [
      { key: "gross", label: "Total remuneration (reporting currency)", amountMinor: gross, tone: "sub" },
      { key: "tds", label: "Tax deducted at source (TDS)", amountMinor: tds },
      { key: "health", label: `Employee health contribution (${rules.healthRatePct}% demo rate)`, amountMinor: health },
      { key: "total", label: "Total payable to GMCA", amountMinor: tds + health, tone: "total" }
    ],
    taxMinor: tds + health,
    creditsMinor: 0,
    balanceMinor: tds + health,
    warnings: pending ? [`${pending} employee${pending === 1 ? "" : "s"} paid in a currency without a configured rate.`] : [],
    assumptions: [DEMO_ASSUMPTION, RULE_SOURCES]
  };
}

// ---------- Corporate ----------

export function activeIncentive(incentives: CompanyTaxIncentive[], companyId: string, year: number) {
  const yearEnd = `${year}-12-31`;
  const yearStart = `${year}-01-01`;
  return incentives.find((i) => i.companyId === companyId && i.status === "ACTIVE" && i.effectiveFrom <= yearEnd && i.effectiveTo >= yearStart);
}

export function calculateCorporate(f: CorporateFinancials, rules: TaxRuleSet, incentive: CompanyTaxIncentive | undefined, reportingCurrency: string, now = new Date().toISOString()): CalculationSnapshot {
  const lines: CalcLine[] = [
    { key: "revenue", label: "Revenue", amountMinor: f.revenueMinor },
    { key: "other", label: "Other income", amountMinor: f.otherIncomeMinor },
    { key: "expenses", label: "Less expenses claimed", amountMinor: -f.expensesMinor }
  ];
  const profit = f.revenueMinor + f.otherIncomeMinor - f.expensesMinor;
  lines.push({ key: "profit", label: "Accounting profit", amountMinor: profit, tone: "sub" });
  let adj = 0;
  for (const a of f.adjustments) {
    adj += a.amountMinor;
    lines.push({ key: `adj-${a.id}`, label: `Adjustment · ${a.label}`, amountMinor: a.amountMinor });
  }
  const chargeable = Math.max(0, profit + adj);
  lines.push({ key: "chargeable", label: "Chargeable income", amountMinor: chargeable, tone: "sub" });
  const rate = incentive ? incentive.ratePct : rules.corporateRatePct;
  const tax = pct(chargeable, rate);
  lines.push({
    key: "tax",
    label: incentive ? `Corporate tax at approved incentive rate (${rate}%)` : `Corporate tax at standard rate (${rate}%)`,
    amountMinor: tax,
    tone: "total",
    note: incentive ? `Incentive ${incentive.approvalReference}, recorded by GMCA, effective ${incentive.effectiveFrom} to ${incentive.effectiveTo}` : undefined
  });
  const assumptions = [DEMO_ASSUMPTION, "The corporate rate and incentives are demo configuration.", "Adjustments are free-text lines entered by the company. GMCA has not yet confirmed the corporate schedules or allowable expenses."];
  return { id: "", kind: "CORPORATE", ruleSetId: rules.id, ruleSetVersion: rules.version, reportingCurrency, computedAt: now, lines, taxMinor: tax, creditsMinor: 0, balanceMinor: tax, warnings: profit < 0 ? ["The return shows a loss. Loss treatment is not configured."] : [], assumptions };
}

export function ruleSetForYear(ruleSets: TaxRuleSet[], year: number): TaxRuleSet {
  const candidates = ruleSets.filter((r) => r.status === "ACTIVE" && r.effectiveFromYear <= year).sort((a, b) => b.effectiveFromYear - a.effectiveFromYear || b.createdAt.localeCompare(a.createdAt));
  const found = candidates[0] ?? ruleSets[0];
  if (!found) throw new Error("No tax rule set configured.");
  return found;
}
