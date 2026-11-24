import { cn } from "../../lib/utils";

/**
 * DK Bank mark for the simulated bank screens. A stand-in drawn for the demo, not the bank's
 * official logo: replace it with the artwork DK Bank supplies.
 */
export function DkBankLogo({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 40 40" className="size-9 shrink-0" role="img" aria-label="DK Bank">
        <rect width="40" height="40" fill="#0B3D91" />
        <path d="M0 30 L40 22 L40 40 L0 40 Z" fill="#F2A900" />
        <text x="20" y="21" textAnchor="middle" fontFamily="Roboto, Arial, sans-serif" fontSize="15" fontWeight="700" fill="#FFFFFF">
          DK
        </text>
      </svg>
      {withName ? <span className="font-medium leading-tight text-fg">DK Bank</span> : null}
    </span>
  );
}
