import { roundHalfUp, type Minor } from "../lib/money";
import type { Conversion, PlatformConfig } from "../domain/types";

/**
 * The one place amounts change currency. Uses the most recent configured rate on or
 * before the conversion date. Rates are seeded demo values, never official or live.
 * Open questions for GMCA: reporting currency, rate source, conversion date rule, rounding.
 */
export function conversionDateFor(config: PlatformConfig, periodEnd: string, filingDate: string) {
  return config.conversionDateRule === "PERIOD_END" ? periodEnd : filingDate;
}

export function findRate(config: PlatformConfig, currency: string, onDate: string) {
  return config.exchangeRates
    .filter((r) => r.currency === currency && r.effectiveDate <= onDate)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
}

export function convert(config: PlatformConfig, originalMinor: Minor, currency: string, conversionDate: string): Conversion {
  const reportingCurrency = config.reportingCurrency;
  if (currency === reportingCurrency) {
    return { originalMinor, currency, reportingCurrency, status: "CONVERTED", reportingMinor: originalMinor, rate: 1, rateDate: conversionDate, conversionDate, source: "Same currency", isDemoRate: false };
  }
  const rate = findRate(config, currency, conversionDate);
  if (!rate) {
    return { originalMinor, currency, reportingCurrency, status: "PENDING", reportingMinor: null, rate: null, rateDate: null, conversionDate, source: null, isDemoRate: false };
  }
  return {
    originalMinor,
    currency,
    reportingCurrency,
    status: "CONVERTED",
    reportingMinor: roundHalfUp(originalMinor * rate.rate),
    rate: rate.rate,
    rateDate: rate.effectiveDate,
    conversionDate,
    source: rate.source,
    isDemoRate: rate.isDemo
  };
}

export function enabledCurrencies(config: PlatformConfig) {
  return config.currencies.filter((c) => c.enabled);
}
