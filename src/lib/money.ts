/**
 * Amounts are integers in the currency's minor unit (cents for USD). Never floats.
 * Rounding (half-up to the minor unit) is a demo assumption pending GMCA confirmation.
 */
export type Minor = number;
/** Kept for the shared GMC components copied from version 1. */
export type Cents = Minor;

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function toMinor(major: number): Minor {
  return roundHalfUp(major * 100);
}

export function parseAmountInput(raw: string): Minor | null {
  const cleaned = String(raw).replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return toMinor(Number(cleaned));
}

export function minorToInput(minor: Minor | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  return (minor / 100).toFixed(2);
}

const cache = new Map<string, Intl.NumberFormat>();
function formatter(code: string) {
  let f = cache.get(code);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    cache.set(code, f);
  }
  return f;
}

/** "USD 1,234.50"; negative amounts use a true minus sign. */
export function formatAmount(minor: Minor, code: string): string {
  const text = formatter(code).format(Math.abs(minor) / 100).replace(/ /g, " ");
  return minor < 0 ? `−${text}` : text;
}

let reportingCode = "USD";
/** The shell sets this from configuration so <Money> needs no prop drilling. */
export function setReportingCurrency(code: string) {
  reportingCode = code;
}
export function formatMoney(minor: Minor, code = reportingCode): string {
  return formatAmount(minor, code);
}
