import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export type Step = { key: string; label: string };

/** Numbered stepper (C19). Below md it collapses to "Step n of N" with a progress bar. */
export function Stepper({ steps, current, onSelect }: { steps: Step[]; current: string; onSelect?: (key: string) => void }) {
  const index = Math.max(0, steps.findIndex((s) => s.key === current));
  return (
    <nav aria-label="Return steps">
      <div className="md:hidden">
        <p className="text-sm text-muted">
          Step <span className="num font-medium text-fg">{index + 1}</span> of {steps.length} · <span className="font-medium text-brand-ink">{steps[index]?.label}</span>
        </p>
        <div className="mt-2 h-1 bg-line-soft">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="hidden items-start md:flex">
        {steps.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "upcoming";
          const clickable = onSelect && i !== index;
          const circle = (
            <span
              className={cn(
                "grid size-11 place-items-center rounded-full border-2 text-base font-medium transition-colors",
                state === "current" && "border-primary bg-primary text-white ring-[6px] ring-[rgb(56_109_53_/_0.25)]",
                state === "done" && "border-primary bg-primary text-white",
                state === "upcoming" && "border-line bg-surface text-fg-2"
              )}
            >
              {state === "done" ? <Check className="size-[18px]" strokeWidth={2.5} aria-hidden="true" /> : i + 1}
            </span>
          );
          return (
            <li key={step.key} className="flex flex-1 items-start last:flex-none">
              <div className="flex w-28 flex-col items-center gap-3 text-center">
                {clickable ? (
                  <button type="button" onClick={() => onSelect(step.key)} aria-label={`Go to step ${i + 1}: ${step.label}`} className="rounded-full">
                    {circle}
                  </button>
                ) : (
                  <span aria-current={state === "current" ? "step" : undefined}>{circle}</span>
                )}
                <span className={cn("text-[15px] leading-tight", state === "current" ? "font-medium text-brand-ink" : state === "done" ? "text-brand-700" : "text-muted")}>{step.label}</span>
              </div>
              {i < steps.length - 1 ? <span aria-hidden="true" className={cn("mx-2 mt-[21px] h-0.5 flex-1", i < index ? "bg-primary" : "bg-line")} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
