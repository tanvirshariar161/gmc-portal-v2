/** Overridable clock so seed data and tests can create records at fixed past dates. */
let fixed: string | null = null;

export function nowIso(): string {
  return fixed ?? new Date().toISOString();
}

export function today(): string {
  return nowIso().slice(0, 10);
}

export function withClock<T>(iso: string, fn: () => T): T {
  const prev = fixed;
  fixed = iso;
  try {
    return fn();
  } finally {
    fixed = prev;
  }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
