/**
 * Payroll import from a CSV file saved from Excel. Pure functions: parsing, matching rows to
 * the employees on a month's payroll, and building the template. Version 1 keeps an identical
 * copy in apps/portal/src/lib/payrollCsv.ts; change both together.
 */

export const MAX_CSV_BYTES = 1_000_000;
const MAX_ROWS = 5_000;

/** RFC 4180 as Excel writes it: optional BOM, quoted fields with "" escapes, CRLF or LF, comma or semicolon separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Text that Excel would run as a formula is prefixed with an apostrophe, so a downloaded file can't execute anything. */
function safeCell(v: string | number) {
  if (typeof v === "number") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]) {
  return "﻿" + rows.map((r) => r.map(safeCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Amounts as people type them in Excel: "4,200.50", "4200", "$4,200", "4.200,50" (European), "BTN 25000".
 * Returns minor units (cents), or null when the text isn't a plain non-negative amount.
 */
export function parseCsvAmount(raw: string): number | null {
  let s = raw.replace(/[\s ']/g, "").replace(/^[A-Za-z$€£₹]+|[A-Za-z$€£₹]+$/g, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Only commas: "4200,5" is a decimal comma; "4,200" or "1,200,000" are thousands.
    s = /^\d+,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export type RosterEntry = {
  /** The line or employee the update applies to. */
  key: string;
  name: string;
  /** Identifiers the file may use: CID, work permit or passport number. */
  ids: string[];
  currency: string;
  amountMinor: number;
};

export type CsvUpdate = { key: string; name: string; row: number; currency: string; amountMinor: number; fromCurrency: string; fromMinor: number };
export type CsvImportResult = { updates: CsvUpdate[]; problems: { row: number; message: string }[]; notInFile: string[]; rowCount: number };

const HEADERS = {
  id: ["employee id", "id", "id number", "cid", "work permit", "work permit number", "permit", "passport", "identifier"],
  name: ["employee", "employee name", "name", "full name"],
  amount: ["gross pay", "gross", "amount", "remuneration", "pay", "salary", "gross salary"],
  currency: ["currency", "pay currency", "ccy"]
};

const norm = (s: string) => s.trim().replace(/^'/, "").toLowerCase().replace(/[_\s]+/g, " ").replace(/[()]/g, "");
const normId = (s: string) => s.trim().replace(/^'/, "").toUpperCase().replace(/\s+/g, "");

export function matchPayrollCsv(text: string, roster: RosterEntry[], allowedCurrencies: string[]): CsvImportResult {
  const rows = parseCsv(text);
  const empty: CsvImportResult = { updates: [], problems: [], notInFile: [], rowCount: 0 };
  if (!rows.length) return { ...empty, problems: [{ row: 1, message: "The file is empty." }] };
  if (rows.length - 1 > MAX_ROWS) return { ...empty, problems: [{ row: 1, message: `The file has more than ${MAX_ROWS.toLocaleString("en-US")} rows.` }] };
  const header = rows[0]!.map(norm);
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const c = { id: col(HEADERS.id), name: col(HEADERS.name), amount: col(HEADERS.amount), currency: col(HEADERS.currency) };
  if (c.amount < 0 || (c.id < 0 && c.name < 0)) {
    return { ...empty, problems: [{ row: 1, message: "The first row must name the columns: Employee ID (or Employee name) and Gross pay, plus Currency if pay isn't all in one currency. Download the template to see the layout." }] };
  }

  const byId = new Map<string, RosterEntry>();
  for (const r of roster) for (const id of r.ids) if (id) byId.set(normId(id), r);
  const byName = new Map<string, RosterEntry[]>();
  for (const r of roster) byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r]);
  const allowed = new Set(allowedCurrencies.map((x) => x.toUpperCase()));

  const result: CsvImportResult = { ...empty, rowCount: rows.length - 1 };
  const seen = new Map<string, number>();
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2; // Spreadsheet row number, counting the header as row 1.
    const cell = (k: number) => (k >= 0 ? (cells[k] ?? "").trim() : "");
    const idText = cell(c.id);
    const nameText = cell(c.name);
    const label = nameText || idText || `row ${rowNo}`;
    let who = idText ? byId.get(normId(idText)) : undefined;
    if (!who && nameText) {
      const hits = byName.get(norm(nameText)) ?? [];
      if (hits.length > 1) return void result.problems.push({ row: rowNo, message: `${label}: more than one employee has this name. Use the Employee ID column.` });
      who = hits[0];
    }
    if (!who) return void result.problems.push({ row: rowNo, message: `${label}: not on this month's payroll. Add them under Employees first, or check the ID.` });
    if (seen.has(who.key)) return void result.problems.push({ row: rowNo, message: `${who.name}: already in row ${seen.get(who.key)}. Only the first row is used.` });
    seen.set(who.key, rowNo);
    const amountText = cell(c.amount);
    const amountMinor = parseCsvAmount(amountText);
    if (amountMinor === null) return void result.problems.push({ row: rowNo, message: `${who.name}: "${amountText || "(blank)"}" isn't an amount. Use numbers only, like 4200.50.` });
    const currency = (cell(c.currency) || who.currency).toUpperCase();
    if (!allowed.has(currency)) return void result.problems.push({ row: rowNo, message: `${who.name}: ${currency} isn't an accepted pay currency.` });
    if (currency !== who.currency || amountMinor !== who.amountMinor) {
      result.updates.push({ key: who.key, name: who.name, row: rowNo, currency, amountMinor, fromCurrency: who.currency, fromMinor: who.amountMinor });
    }
  });
  result.notInFile = roster.filter((r) => !seen.has(r.key)).map((r) => r.name);
  return result;
}

/** A filled-in template: one row per employee with this month's current pay. */
export function payrollTemplate(roster: RosterEntry[]) {
  return toCsv([["Employee ID", "Employee name", "Gross pay", "Currency"], ...roster.map((r) => [r.ids[0] ?? "", r.name, (r.amountMinor / 100).toFixed(2), r.currency])]);
}
