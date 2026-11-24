/**
 * Amounts are integers in the currency's minor unit (chhertum for BTN, cents for USD). Never floats.
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
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

const cache = new Map<string, Intl.NumberFormat>();
function formatter(code: string, digits: number) {
  const key = `${code}:${digits}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    cache.set(key, f);
  }
  return f;
}

const SYMBOL: Record<string, string> = { BTN: "Nu\u00a0", USD: "$" };

/**
 * "Nu 1,234" for BTN, "$1,234" for USD, "SGD 1,234" for other currencies. Whole amounts drop
 * the decimals so figures stay easy to read; anything with a fraction shows two decimals.
 * Negative amounts use a true minus sign.
 */
export function formatAmount(minor: Minor, code: string): string {
  const digits = Math.abs(minor) % 100 === 0 ? 0 : 2;
  const sym = SYMBOL[code];
  const major = Math.abs(minor) / 100;
  const text = sym
    ? `${sym}${major.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
    : formatter(code, digits).format(major).replace(/\u00a0/g, " ");
  return minor < 0 ? `−${text}` : text;
}

let reportingCode = "BTN";
/** The shell sets this from configuration so <Money> needs no prop drilling. */
export function setReportingCurrency(code: string) {
  reportingCode = code;
}
export function formatMoney(minor: Minor, code = reportingCode): string {
  return formatAmount(minor, code);
}

/** Human rate: "1 USD = 100 BTN", or for currencies worth less than the reporting one "1 BTN = 33.3333 XYZ". */
export function formatRate(rate: number, currency: string, reporting: string): string {
  if (rate >= 0.1) return `1 ${currency} = ${Number(rate.toFixed(6))} ${reporting}`;
  return `1 ${reporting} = ${Number((1 / rate).toFixed(4))} ${currency}`;
}
