import { describe, expect, it } from "vitest";
import { matchPayrollCsv, parseCsv, parseCsvAmount, payrollTemplate, type RosterEntry } from "./payrollCsv";

const roster: RosterEntry[] = [
  { key: "a", name: "Karma Dorji", ids: ["10000000001"], currency: "USD", amountMinor: 420_000 },
  { key: "b", name: "Anika Rao", ids: ["WP-DEMO-2026-0001"], currency: "INR", amountMinor: 0 },
  { key: "c", name: "Sonam Choden", ids: ["10000000002"], currency: "BTN", amountMinor: 9_500_000 }
];

describe("payroll CSV import", () => {
  it("reads Excel CSV: BOM, quotes, CRLF, semicolons", () => {
    expect(parseCsv('﻿Name,Pay\r\n"Dorji, Karma","4,200.50"\r\n\r\n')).toEqual([["Name", "Pay"], ["Dorji, Karma", "4,200.50"]]);
    expect(parseCsv('a;b\n"say ""hi""";2\n')).toEqual([["a", "b"], ['say "hi"', "2"]]);
  });

  it("parses amounts the way people type them", () => {
    expect([parseCsvAmount("4,200.50"), parseCsvAmount("4200"), parseCsvAmount("$4,200"), parseCsvAmount("4.200,50"), parseCsvAmount("4200,5"), parseCsvAmount("BTN 95,000")]).toEqual([420_050, 420_000, 420_000, 420_050, 420_050, 9_500_000]);
    expect([parseCsvAmount("-10"), parseCsvAmount("abc"), parseCsvAmount(""), parseCsvAmount("1.234")]).toEqual([null, null, null, null]);
  });

  it("matches by ID or name, keeps unchanged rows out, and reports problems by row", () => {
    const csv = ["Employee ID,Employee name,Gross pay,Currency", "10000000001,Karma Dorji,4200.00,USD", ",anika rao,350000,INR", "99,Nobody,10,USD", "10000000001,Karma Dorji,1,USD", "10000000002,Sonam Choden,lots,BTN"].join("\n");
    const r = matchPayrollCsv(csv, roster, ["USD", "INR", "BTN"]);
    expect(r.updates).toEqual([{ key: "b", name: "Anika Rao", row: 3, currency: "INR", amountMinor: 35_000_000, fromCurrency: "INR", fromMinor: 0 }]);
    expect(r.problems.map((p) => p.row)).toEqual([4, 5, 6]);
    expect(r.notInFile).toEqual([]);
  });

  it("uses the employee's currency when the file has none, and rejects unaccepted currencies", () => {
    const r = matchPayrollCsv("CID,Amount\n10000000002,96000\n10000000001,5000", roster, ["USD", "BTN"]);
    expect(r.updates.map((u) => [u.key, u.currency, u.amountMinor])).toEqual([["c", "BTN", 9_600_000], ["a", "USD", 500_000]]);
    expect(r.notInFile).toEqual(["Anika Rao"]);
    expect(matchPayrollCsv("Name,Gross pay,Currency\nKarma Dorji,10,GBP", roster, ["USD"]).problems[0]!.message).toMatch(/GBP/);
  });

  it("explains a file without the needed columns", () => {
    expect(matchPayrollCsv("Foo,Bar\n1,2", roster, ["USD"]).problems[0]!.message).toMatch(/Gross pay/);
  });

  it("round-trips its own template and defuses formula-like text", () => {
    const tpl = payrollTemplate([...roster, { key: "x", name: "=HYPERLINK(1)", ids: [], currency: "USD", amountMinor: 0 }]);
    expect(tpl).toContain("'=HYPERLINK(1)");
    expect(matchPayrollCsv(tpl, roster, ["USD", "INR", "BTN"]).updates).toEqual([]);
  });
});
