import type { Cents } from "../../lib/money";
import { cn } from "../../lib/utils";
import { Money } from "./Layout";

/**
 * The four figures shown wherever employer-reported pay appears (from version 1). Net is derived,
 * so the row adds up: gross − tax − health = net.
 */
export function SalaryBreakdown({ gross, tds, health, healthPct, size = "md", compact, className }: { gross: Cents; tds: Cents; health: Cents; healthPct: number; size?: "md" | "lg"; compact?: boolean; className?: string }) {
  const items = [
    { label: "Gross salary", value: gross },
    { label: "Tax deducted", value: tds, minus: true },
    { label: `Health contribution (${healthPct}%)`, value: health, minus: true },
    { label: "Net salary", value: gross - tds - health, strong: true }
  ];
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-5", !compact && "2xl:grid-cols-4", className)}>
      {items.map((i) => (
        <div key={i.label} className={cn("grid content-start gap-1", i.strong && !compact && "2xl:border-l 2xl:border-line 2xl:pl-6")}>
          <dt className="text-sm text-muted">{i.label}</dt>
          <dd className={cn("whitespace-nowrap font-serif leading-none", size === "lg" ? "text-[1.75rem]" : "text-[1.375rem]", i.strong && "text-brand-ink")}>
            <Money cents={i.minus ? -i.value : i.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
