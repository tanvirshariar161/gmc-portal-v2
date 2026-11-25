import type { Band, Db, TaxRuleSet } from "../domain/types";
import { buildXlsx, ref, sheetRef, type CellValue, type Sheet } from "../lib/xlsx";
import { CITIZENSHIP_LABEL, ENTITY_LABEL, findTaxpayerClass, RESIDENCY_LABEL } from "./classification";

/**
 * Rule impact workbook for the GMCA Tax Administrator: the rules being edited, applied to a demo
 * taxpayer and a demo company with live Excel formulas. Changing a yellow cell (a salary, a band,
 * a rate, a relief limit) shows the effect on the tax straight away. Nothing in the file changes
 * the portal. With the published rules and the default inputs, the demo taxpayer's result matches
 * Karma Dorji's 2026 return in the portal (Nu 60,000 to pay) and the demo company's matches
 * Gelephu Green Energy's 2025 corporate return (Nu 5,000,000).
 */

export type WorkbookFocus = "rates" | "reliefs" | "classification" | "incentives" | "currency";

const SHEETS = { readMe: "Read me", individual: "Individual tax", tds: "Monthly TDS", reliefs: "Reliefs", classes: "Classification", corporate: "Corporate tax", currency: "Currencies" } as const;
const FOCUS_SHEET: Record<WorkbookFocus, string> = { rates: SHEETS.individual, reliefs: SHEETS.reliefs, classification: SHEETS.classes, incentives: SHEETS.corporate, currency: SHEETS.currency };

/** Demo inputs. They mirror the seeded sample records so the workbook and the portal agree. */
const DEMO = {
  person: "Karma Dorji (sample citizen, residency not determined)",
  monthlySalary: 500_000,
  months: 10,
  otherIncome: 1_000_000,
  company: "Gelephu Green Energy Pvt Ltd (sample company)",
  companyId: "co-gge",
  revenue: 250_000_000,
  otherCompanyIncome: 8_000_000,
  expenses: 160_000_000,
  addBack: 2_000_000,
  foreignPay: 1_000_000,
  foreignCurrency: "INR"
};

const major = (minor: number) => minor / 100;
const input = (v: number): CellValue => ({ v, style: "input" });
const inputText = (v: string): CellValue => ({ v, style: "inputText" });
const inputRate = (v: number): CellValue => ({ v, style: "inputRate" });
const f = (formula: string, style: "money" | "total" | "rate" | "default" = "money"): CellValue => ({ f: formula, style });
const header = (...labels: string[]): CellValue[] => labels.map((v) => ({ v, style: "header" }));
const title = (v: string): CellValue[] => [{ v, style: "title" }];
const note = (v: string): CellValue[] => [{ v, style: "note" }];

/** Appends rows and remembers where things landed, so formulas can point at them. */
class SheetBuilder {
  rows: CellValue[][] = [];
  constructor(readonly name: string, readonly widths: number[]) {}
  /** Adds a row and returns its 1-based row number. */
  add(...cells: CellValue[]) {
    this.rows.push(cells);
    return this.rows.length;
  }
  gap() {
    this.rows.push([]);
  }
  sheet(): Sheet {
    return { name: this.name, widths: this.widths, rows: this.rows };
  }
}

/**
 * A band table: From (chained from the row above), Up to (blank = no limit), Rate %, then two
 * computed columns. `amount` is the absolute reference of the amount the bands apply to.
 */
function bandTable(s: SheetBuilder, bands: Band[], amount: string, mode: "PROGRESSIVE" | "WHOLE_AMOUNT") {
  s.add(...header("From (Nu)", "Up to (Nu)", "Rate %", mode === "PROGRESSIVE" ? "Amount in band" : "Applies (1 = yes)", mode === "PROGRESSIVE" ? "Tax in band" : "Tax"));
  const first = s.rows.length + 1;
  bands.forEach((b, i) => {
    const row = first + i;
    const from: CellValue = i === 0 ? major(b.fromMinor) : f(ref(1, row - 1));
    const to: CellValue = b.toMinor === null ? { v: "", style: "input" } : input(major(b.toMinor));
    const upTo = `IF(${ref(1, row)}="",${amount},MIN(${amount},${ref(1, row)}))`;
    const computed =
      mode === "PROGRESSIVE"
        ? [f(`MAX(0,${upTo}-${ref(0, row)})`), f(`${ref(3, row)}*${ref(2, row)}/100`)]
        : [f(`IF(AND(${amount}>${ref(0, row)},OR(${ref(1, row)}="",${amount}<=${ref(1, row)})),1,0)`, "default"), f(`${ref(3, row)}*${amount}*${ref(2, row)}/100`)];
    s.add(from, to, inputRate(b.ratePct), ...computed);
  });
  const last = first + bands.length - 1;
  return { first, last, taxRange: `${ref(4, first)}:${ref(4, last)}` };
}

export function buildRuleWorkbook(db: Db, rules: TaxRuleSet, focus: WorkbookFocus, opts: { draft: boolean }) {
  const year = rules.effectiveFromYear;
  const personClass = findTaxpayerClass(rules, { regime: "INDIVIDUAL", citizenship: "CITIZEN", residency: "NOT_DETERMINED" }, year);
  const company = db.companies.find((c) => c.id === DEMO.companyId);
  const companyClass = findTaxpayerClass(rules, { regime: "CORPORATE", entityType: company?.type ?? "COMPANY" }, year);
  const incentive = db.incentives.find((i) => i.companyId === DEMO.companyId && i.status === "ACTIVE" && i.effectiveFrom.slice(0, 4) <= String(year) && i.effectiveTo.slice(0, 4) >= String(year));

  // ---------- Reliefs (built first: the individual sheet uses its total) ----------
  const rel = new SheetBuilder(SHEETS.reliefs, [34, 22, 12, 18, 18]);
  rel.add(...title(`Reliefs and deductions · ${year}`));
  rel.add(...note("Enter what the demo taxpayer claims. A blank limit means no limit; set Available to No to switch a relief off."));
  rel.gap();
  rel.add(...header("Relief", "Limit (Nu)", "Available", "Demo claim (Nu)", "Allowed (Nu)"));
  const relFirst = rel.rows.length + 1;
  rules.reliefs.forEach((r, i) => {
    const row = relFirst + i;
    rel.add(r.label || r.key, r.capMinor === null ? { v: "", style: "input" } : input(major(r.capMinor)), inputText(r.enabled ? "Yes" : "No"), input(0), f(`IF(${ref(2, row)}="Yes",IF(${ref(1, row)}="",${ref(3, row)},MIN(${ref(3, row)},${ref(1, row)})),0)`));
  });
  const relLast = relFirst + Math.max(rules.reliefs.length, 1) - 1;
  const relTotalRow = rel.add({ v: "Total reliefs allowed", style: "header" }, null, null, null, f(rules.reliefs.length ? `SUM(${ref(4, relFirst)}:${ref(4, relLast)})` : "0", "total"));

  // ---------- Monthly TDS ----------
  const tds = new SheetBuilder(SHEETS.tds, [36, 18, 10, 18, 16]);
  tds.add(...title(`Monthly TDS and health contribution · ${year}`));
  tds.add(...note(rules.tdsMethod === "BRACKET_WHOLE_AMOUNT" ? "Method: the rate of the bracket the month's pay falls in applies to the whole pay. Each bracket includes its upper limit." : "Method: progressive, each part of the month's pay taxed at its band's rate."));
  tds.gap();
  const payRow = tds.add("Monthly salary (Nu, from Individual tax)", f(sheetRef(SHEETS.individual, 1, 6)));
  const healthRow = tds.add("Health contribution %", inputRate(rules.healthRatePct));
  tds.add("Health contribution applies to", rules.healthAppliesTo === "ALL" ? "All employees (the demo taxpayer is a citizen)" : "Bhutanese employees only (the demo taxpayer is a citizen)");
  tds.gap();
  const tdsBands = bandTable(tds, rules.tdsBands, ref(1, payRow, true), rules.tdsMethod === "BRACKET_WHOLE_AMOUNT" ? "WHOLE_AMOUNT" : "PROGRESSIVE");
  tds.gap();
  const tdsMonth = tds.add({ v: "TDS for the month", style: "header" }, f(`SUM(${tdsBands.taxRange})`, "total"));
  const healthMonth = tds.add("Health contribution for the month", f(`${ref(1, payRow)}*${ref(1, healthRow)}/100`));
  tds.add("Net pay for the month", f(`${ref(1, payRow)}-${ref(1, tdsMonth)}-${ref(1, healthMonth)}`, "total"));
  const monthsRow = tds.add("Months worked (from Individual tax)", f(sheetRef(SHEETS.individual, 1, 7), "default"));
  const tdsYear = tds.add({ v: "TDS for the year", style: "header" }, f(`${ref(1, tdsMonth)}*${ref(1, monthsRow)}`, "total"));
  tds.add("Health contribution for the year", f(`${ref(1, healthMonth)}*${ref(1, monthsRow)}`));
  tds.add("Net pay for the year", f(`(${ref(1, payRow)}-${ref(1, tdsMonth)}-${ref(1, healthMonth)})*${ref(1, monthsRow)}`, "total"));

  // ---------- Individual tax ----------
  // Rows 5 to 11 are fixed: other sheets point at B6 (salary) and B7 (months).
  const ind = new SheetBuilder(SHEETS.individual, [40, 18, 10, 18, 16]);
  ind.add(...title(`Individual income tax · demo taxpayer · ${year}`));
  ind.add(...note("Yellow cells are inputs. Change them, or the bands below, and the tax recalculates."));
  ind.gap();
  ind.add(...header("Demo taxpayer", ""));
  ind.add("Name", DEMO.person);
  const salary = ind.add("Monthly salary (Nu)", input(DEMO.monthlySalary));
  const months = ind.add("Months worked in the year", { v: DEMO.months, style: "inputRate" });
  const other = ind.add("Other taxable income (Nu)", input(DEMO.otherIncome));
  const reliefs = ind.add("Reliefs allowed (Nu, from Reliefs)", f(sheetRef(SHEETS.reliefs, 4, relTotalRow)));
  const basis = ind.add("Rate basis (Act bands or Flat)", inputText(personClass?.rateBasis === "FLAT" ? "Flat" : "Act bands"));
  const flat = ind.add("Flat rate % (used when the basis is Flat)", inputRate(personClass?.flatRatePct ?? 0));
  ind.add("Taxpayer class", personClass ? personClass.label : "No class matches: the rules can't be published");
  ind.gap();
  ind.add(...header("Calculation", ""));
  const employment = ind.add("Employment income", f(`${ref(1, salary)}*${ref(1, months)}`));
  const taxable = ind.add("Taxable income", f(`${ref(1, employment)}+${ref(1, other)}`));
  ind.add("Less reliefs", f(`-${ref(1, reliefs)}`));
  const chargeable = ind.add({ v: "Chargeable income", style: "header" }, f(`MAX(0,${ref(1, taxable)}-${ref(1, reliefs)})`, "total"));
  ind.gap();
  ind.add(...note("Income Tax Act bands. Each band's From is the Up to of the band above."));
  const indBands = bandTable(ind, rules.individualBands, ref(1, chargeable, true), "PROGRESSIVE");
  ind.gap();
  const tax = ind.add({ v: "Tax on chargeable income", style: "header" }, f(`IF(${ref(1, basis)}="Flat",${ref(1, chargeable)}*${ref(1, flat)}/100,SUM(${indBands.taxRange}))`, "total"));
  const credit = ind.add("Less TDS deducted by the employer (from Monthly TDS)", f(`-${sheetRef(SHEETS.tds, 1, tdsYear)}`));
  ind.add({ v: "Balance to pay (a credit if negative)", style: "header" }, f(`${ref(1, tax)}+${ref(1, credit)}`, "total"));
  if (salary !== 6 || months !== 7) throw new Error("Individual sheet layout changed: update the Monthly TDS references.");

  // ---------- Classification ----------
  const cls = new SheetBuilder(SHEETS.classes, [8, 34, 14, 42, 16, 12, 22, 16, 9]);
  cls.add(...title(`Taxpayer classes · ${year}`));
  cls.add(...note("The first class in use that matches a taxpayer applies. To try a different rate, change the rate basis and flat rate inputs on the Individual tax and Corporate tax sheets."));
  cls.gap();
  cls.add(...header("Order", "Class", "Applies to", "Who", "Rate basis", "Flat rate %", "Income charged", "Last income year", "In use"));
  ["INDIVIDUAL", "CORPORATE"].forEach((regime) =>
    rules.taxpayerClasses
      .filter((c) => c.regime === regime)
      .forEach((c, i) =>
        cls.add(
          { v: i + 1, style: "rate" },
          c.label || "New class",
          regime === "INDIVIDUAL" ? "Individuals" : "Businesses",
          regime === "INDIVIDUAL" ? `${CITIZENSHIP_LABEL[c.citizenship]} · ${RESIDENCY_LABEL[c.residency]}` : ENTITY_LABEL[c.entityType],
          c.rateBasis === "FLAT" ? "Flat" : "Act bands",
          c.rateBasis === "FLAT" ? { v: c.flatRatePct ?? 0, style: "rate" } : "",
          regime === "INDIVIDUAL" ? (c.incomeScope === "GMC_SOURCE" ? "GMC-source only" : "Worldwide") : "",
          c.lastIncomeYear === null ? "No end year" : { v: c.lastIncomeYear, style: "rate" },
          c.enabled ? "Yes" : "No"
        )
      )
  );
  cls.gap();
  cls.add(...header("Demo", "Class that applies", "", "Rate", "", "", "", "", ""));
  cls.add("Person", personClass?.label ?? "No class", "", personClass ? (personClass.rateBasis === "FLAT" ? `Flat ${personClass.flatRatePct}%` : "Act bands") : "—");
  cls.add("Company", companyClass?.label ?? "No class", "", companyClass ? (companyClass.rateBasis === "FLAT" ? `Flat ${companyClass.flatRatePct}%` : "Act bands") : "—");

  // ---------- Corporate tax ----------
  const corp = new SheetBuilder(SHEETS.corporate, [44, 20]);
  corp.add(...title(`Corporate income tax · demo company · ${year}`));
  corp.add(...note("An approved incentive rate replaces the class rate for its effective period. Leave the incentive blank to use the class rate."));
  corp.gap();
  corp.add("Organization", DEMO.company);
  const revenue = corp.add("Revenue (Nu)", input(DEMO.revenue));
  const otherInc = corp.add("Other income (Nu)", input(DEMO.otherCompanyIncome));
  const expenses = corp.add("Expenses claimed (Nu)", input(DEMO.expenses));
  const addBack = corp.add("Adjustments added back (Nu)", input(DEMO.addBack));
  corp.gap();
  const profit = corp.add("Accounting profit", f(`${ref(1, revenue)}+${ref(1, otherInc)}-${ref(1, expenses)}`));
  const corpCharge = corp.add({ v: "Chargeable income", style: "header" }, f(`MAX(0,${ref(1, profit)}+${ref(1, addBack)})`, "total"));
  const classRate = corp.add(`Class rate % (${companyClass?.label ?? "no class"}${companyClass?.rateBasis === "INDIVIDUAL_BANDS" ? ", set to Act bands in the portal" : ""})`, inputRate(companyClass?.flatRatePct ?? 0));
  const incRate = corp.add(`Approved incentive rate %${incentive ? ` (${incentive.approvalReference})` : " (none recorded)"}`, incentive ? inputRate(incentive.ratePct) : { v: "", style: "inputRate" });
  const applied = corp.add("Rate applied %", f(`IF(${ref(1, incRate)}="",${ref(1, classRate)},${ref(1, incRate)})`, "rate"));
  corp.add({ v: "Corporate income tax", style: "header" }, f(`${ref(1, corpCharge)}*${ref(1, applied)}/100`, "total"));

  // ---------- Currencies ----------
  const cur = new SheetBuilder(SHEETS.currency, [22, 16, 16, 24]);
  cur.add(...title("Exchange rates"));
  cur.add(...note(`Ngultrum (${db.config.reportingCurrency}) per unit of each currency, latest rate on file. Change a rate to see the converted pay change.`));
  cur.gap();
  cur.add(...header("Currency", "Nu per unit", "Effective from", "Source"));
  const latest = db.config.currencies
    .filter((c) => c.enabled && c.code !== db.config.reportingCurrency)
    .map((c) => ({ code: c.code, rate: db.config.exchangeRates.filter((r) => r.currency === c.code).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] }))
    .filter((x) => x.rate);
  const curFirst = cur.rows.length + 1;
  latest.forEach((x) => cur.add(x.code, inputRate(x.rate!.rate), x.rate!.effectiveDate, x.rate!.source));
  const curLast = curFirst + Math.max(latest.length, 1) - 1;
  cur.gap();
  cur.add(...header("Demo foreign pay", ""));
  const amt = cur.add("Monthly pay in its currency", input(DEMO.foreignPay));
  const code = cur.add("Currency (a code from the table)", inputText(DEMO.foreignCurrency));
  cur.add({ v: "Monthly pay in Nu", style: "header" }, f(`${ref(1, amt)}*IFERROR(VLOOKUP(${ref(1, code)},${ref(0, curFirst, true)}:${ref(1, curLast, true)},2,0),0)`, "total"));

  // ---------- Read me ----------
  const readMe = new SheetBuilder(SHEETS.readMe, [110]);
  readMe.add(...title("GMCA rule impact workbook"));
  readMe.add(`Rules for financial year ${year}, version ${rules.version}${opts.draft ? " with unpublished changes from the portal" : ""}.`);
  readMe.add(`Generated ${new Date().toISOString().slice(0, 10)} from the GMCA Income Tax portal.`);
  readMe.gap();
  readMe.add(...header("How to use it"));
  readMe.add("Yellow cells are inputs: the demo taxpayer's figures and the rules themselves (bands, rates, relief limits, exchange rates).");
  readMe.add("Change any of them and every result recalculates, so you can see the impact of a rule before publishing it.");
  readMe.add("This file never changes the portal. To change a rule, edit it in the portal and publish a new version.");
  readMe.gap();
  readMe.add(...header("Sheets"));
  readMe.add(`${SHEETS.individual}: the demo taxpayer's income, reliefs, Act bands, TDS credit and balance to pay.`);
  readMe.add(`${SHEETS.tds}: the employer's monthly TDS table, health contribution and net pay for the demo salary.`);
  readMe.add(`${SHEETS.reliefs}: relief limits and the demo taxpayer's claims.`);
  readMe.add(`${SHEETS.classes}: taxpayer classes in checking order, and the class each demo resolves to.`);
  readMe.add(`${SHEETS.corporate}: the demo company's chargeable income, class rate and approved incentive.`);
  readMe.add(`${SHEETS.currency}: exchange rates and a converted foreign salary.`);
  readMe.gap();
  readMe.add(...note("With the published rules and the default inputs, the demo taxpayer has Nu 60,000 to pay (Karma Dorji's 2026 return in the portal) and the demo company Nu 5,000,000 (Gelephu Green Energy's 2025 return)."));

  const sheets = [readMe, ind, tds, rel, cls, corp, cur].map((s) => s.sheet());
  const active = sheets.findIndex((s) => s.name === FOCUS_SHEET[focus]);
  const version = rules.version.replace(/^FY\d{4}\./, "v");
  return { sheets, bytes: buildXlsx(sheets, active), fileName: `GMCA-rule-impact-FY${year}-${opts.draft ? "draft" : version}.xlsx` };
}
