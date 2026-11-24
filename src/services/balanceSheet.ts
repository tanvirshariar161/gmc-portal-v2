import { ServiceError } from "../domain/store";
import type { BalanceSheetLine, TaxItem, TaxRegime, TaxRuleSet } from "../domain/types";

/**
 * Assets, investments and liabilities declared with a return. The types come from the tax
 * item catalogue (ASSET and LIABILITY items for the regime); investments are the asset items
 * flagged as such. Declared for information: the figures don't change the tax.
 */

export type BalanceSheetGroup = "ASSET" | "INVESTMENT" | "LIABILITY";

export const GROUPS: { key: BalanceSheetGroup; title: string; singular: string; description: string }[] = [
  { key: "ASSET", title: "Assets", singular: "asset", description: "Property, vehicles, equipment, bank balances and other things owned on 31 December." },
  { key: "INVESTMENT", title: "Investments", singular: "investment", description: "Shares, funds, fixed deposits and bonds. Attach a statement or certificate to each row." },
  { key: "LIABILITY", title: "Liabilities", singular: "liability", description: "Loans and other amounts owed on 31 December." }
];

export const groupOf = (item: Pick<TaxItem, "kind" | "investment">): BalanceSheetGroup => (item.kind === "LIABILITY" ? "LIABILITY" : item.investment ? "INVESTMENT" : "ASSET");

/** Catalogue items a taxpayer can choose for a group. An item switched off later stays valid for rows that already use it. */
export function itemsFor(rules: TaxRuleSet, regime: TaxRegime, group: BalanceSheetGroup, keep: string[] = []): TaxItem[] {
  return rules.taxItems.filter((i) => (i.kind === "ASSET" || i.kind === "LIABILITY") && groupOf(i) === group && (keep.includes(i.key) || (i.enabled && (i.appliesTo === "BOTH" || i.appliesTo === regime))));
}

export function lineGroup(rules: TaxRuleSet | undefined, line: BalanceSheetLine): BalanceSheetGroup {
  const item = rules?.taxItems.find((i) => i.key === line.itemKey);
  return item ? groupOf(item) : "ASSET";
}

export function totals(rules: TaxRuleSet | undefined, lines: BalanceSheetLine[]) {
  const sum = (g: BalanceSheetGroup) => lines.filter((l) => lineGroup(rules, l) === g).reduce((s, l) => s + l.valueMinor, 0);
  const assets = sum("ASSET");
  const investments = sum("INVESTMENT");
  const liabilities = sum("LIABILITY");
  return { assets, investments, liabilities, net: assets + investments - liabilities };
}

/** Problems that stop submission. */
export function balanceSheetIssues(rules: TaxRuleSet, lines: BalanceSheetLine[]): string[] {
  const issues: string[] = [];
  const count: Record<BalanceSheetGroup, number> = { ASSET: 0, INVESTMENT: 0, LIABILITY: 0 };
  for (const l of lines) {
    const item = rules.taxItems.find((i) => i.key === l.itemKey);
    const g = item ? groupOf(item) : "ASSET";
    count[g] += 1;
    const singular = GROUPS.find((x) => x.key === g)!.singular;
    const name = `${singular[0]!.toUpperCase()}${singular.slice(1)} ${count[g]}`;
    if (!item || (item.kind !== "ASSET" && item.kind !== "LIABILITY")) issues.push(`${name}: choose a type.`);
    if (!l.description.trim()) issues.push(`${name}: add a description.`);
    if (l.valueMinor <= 0) issues.push(`${l.description.trim() || name}: enter a value greater than zero.`);
  }
  return issues;
}

/** Shape checks on save; completeness is checked on submit. */
export function checkBalanceSheet(lines: BalanceSheetLine[]) {
  for (const l of lines) if (!Number.isInteger(l.valueMinor) || l.valueMinor < 0) throw new ServiceError("Asset and liability values must be whole cents and not negative.");
}
