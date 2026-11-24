import { forwardRef } from "react";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-medium tracking-wide transition-all duration-200 cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-primary border-primary text-white hover:bg-primary-hover hover:border-primary-hover",
  secondary: "bg-surface border-line text-fg-2 hover:bg-sunk hover:text-fg",
  ghost: "bg-transparent border-transparent text-brand-ink hover:bg-brand-50",
  danger: "bg-rej-bg border-rej-line text-rej-fg hover:bg-rej-line",
  link: "border-transparent bg-transparent px-0 text-brand-ink underline-offset-4 hover:underline"
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-11 px-7 text-[15px]"
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], variant === "link" ? "h-auto px-0" : sizes[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; children: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...props },
  ref
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

/** In-app link that routes without a page load. */
export function NavLink({
  to,
  onNavigate,
  variant,
  size,
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; onNavigate: (path: string) => void; variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <a
      href={to}
      className={variant ? buttonClass(variant, size, className) : className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
