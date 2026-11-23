import { AlertCircle, Check, FileText, Upload, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type FieldShell = { label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; className?: string; badge?: ReactNode };

function Shell({ id, label, hint, error, required, className, badge, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-rej-fg">
            *
          </span>
        ) : null}
        {badge}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-xs text-rej-fg">
          <AlertCircle aria-hidden="true" className="size-3.5" /> {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export function TextField({ label, hint, error, required, className, badge, prefix, ...props }: FieldShell & InputHTMLAttributes<HTMLInputElement> & { prefix?: string }) {
  const auto = useId();
  const id = props.id ?? auto;
  const input = (
    <input
      {...props}
      id={id}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      className={cn("control", prefix && "border-l-0 pl-2", props.readOnly && "cursor-default")}
    />
  );
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required} className={className} badge={badge}>
      {prefix ? (
        <div className="flex">
          <span aria-hidden="true" className="grid h-10 place-items-center border border-r-0 border-input bg-sunk px-3 text-sm text-muted">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </Shell>
  );
}

export function SelectField({ label, hint, error, required, className, children, ...props }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <select {...props} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} className="control appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23767676' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
        {children}
      </select>
    </Shell>
  );
}

export function TextArea({ label, hint, error, required, className, ...props }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea {...props} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} className="control min-h-24 py-2 leading-relaxed" />
    </Shell>
  );
}

export function Checkbox({ checked, onChange, children, hint, id: given, disabled }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; hint?: ReactNode; id?: string; disabled?: boolean }) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <div className="flex items-start gap-3">
      <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="peer size-[18px] cursor-pointer appearance-none rounded-checkbox border border-input bg-surface transition checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Check aria-hidden="true" className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
      </span>
      <span className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-[15px] leading-snug text-fg">
          {children}
        </label>
        {hint ? (
          <span id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Radio set rendered as bordered options; inline for short labels, stacked cards for descriptive ones. */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  layout = "inline",
  error,
  required
}: {
  legend: ReactNode;
  name: string;
  value: T | undefined;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; description?: ReactNode }[];
  layout?: "inline" | "cards";
  error?: string;
  required?: boolean;
}) {
  return (
    <fieldset className="grid gap-2.5" aria-invalid={error ? true : undefined}>
      <legend className="mb-2.5 text-sm font-medium text-fg">
        {legend}
        {required ? (
          <span aria-hidden="true" className="ml-1.5 text-rej-fg">
            *
          </span>
        ) : null}
      </legend>
      <div className={layout === "inline" ? "flex flex-wrap gap-x-8 gap-y-3" : "grid gap-3 sm:grid-cols-2"}>
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3",
                layout === "cards" && "border bg-surface p-4 transition-colors hover:border-brand-200",
                layout === "cards" && (checked ? "border-primary bg-brand-50" : "border-line")
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                required={required}
                onChange={() => onChange(option.value)}
                className="mt-0.5 grid size-[18px] shrink-0 cursor-pointer appearance-none place-content-center rounded-full border border-input bg-surface before:size-2 before:scale-0 before:rounded-full before:bg-primary before:transition-transform before:content-[''] checked:border-primary checked:before:scale-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]"
              />
              <span className="grid gap-1">
                <span className="text-[15px] leading-snug text-fg">{option.label}</span>
                {option.description ? <span className="text-sm leading-relaxed text-muted">{option.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-rej-fg">
          <AlertCircle aria-hidden="true" className="size-3.5" /> {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Evidence upload (prototype: keeps file names only; production goes through virus-scanned document storage, US-01.3). */
export function FileDrop({ label, files, onChange, hint = "PDF, JPG or PNG, up to 10 MB each." }: { label: string; files: string[]; onChange: (files: string[]) => void; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string>();
  const id = useId();

  function accept(list: FileList | null) {
    if (!list) return;
    const ok: string[] = [];
    for (const file of Array.from(list)) {
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
        setError(`${file.name} can't be uploaded. Use a PDF, JPG or PNG file.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} is larger than 10 MB. Upload a smaller copy.`);
        continue;
      }
      ok.push(file.name);
    }
    if (ok.length) {
      setError(undefined);
      onChange([...files, ...ok]);
    }
  }

  return (
    <div className="grid gap-2">
      <span id={id} className="text-sm font-medium text-fg">
        {label}
      </span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files);
        }}
        className={cn("grid justify-items-center gap-1.5 border border-dashed px-6 py-6 text-center transition-colors", over ? "border-primary bg-brand-50" : error ? "border-rej-line bg-rej-bg" : "border-line bg-sunk")}
      >
        <Upload aria-hidden="true" className="size-5 text-brand-ink" />
        <p className="text-sm text-fg-2">
          Drag a file here, or{" "}
          <button type="button" className="font-medium text-brand-ink underline underline-offset-4" onClick={() => input.current?.click()} aria-describedby={id}>
            browse
          </button>
        </p>
        <p className="text-xs text-placeholder">{hint}</p>
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden onChange={(e) => accept(e.target.files)} />
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-rej-fg">
          <AlertCircle aria-hidden="true" className="size-3.5" /> {error}
        </p>
      ) : null}
      {files.length ? (
        <ul className="grid gap-2">
          {files.map((name, i) => (
            <li key={`${name}-${i}`} className="flex items-center gap-3 border border-line bg-surface px-3 py-2 text-sm">
              <FileText aria-hidden="true" className="size-4 text-brand-ink" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <button type="button" className="grid size-7 place-items-center text-muted hover:bg-sunk hover:text-fg" aria-label={`Remove ${name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
