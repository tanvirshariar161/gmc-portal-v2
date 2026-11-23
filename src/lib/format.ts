export function formatDate(iso: string | undefined | null, style: "short" | "long" = "long"): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", style === "short" ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Show only the last four characters of an identifier on lists and logs. */
export function maskId(value: string): string {
  return value.length <= 4 ? value : `••••${value.slice(-4)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
