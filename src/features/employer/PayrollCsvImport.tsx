import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { matchPayrollCsv, MAX_CSV_BYTES, payrollTemplate, type CsvImportResult, type CsvUpdate, type RosterEntry } from "../../lib/payrollCsv";
import { Button } from "../../shared/gmc/Button";
import { Alert } from "../../shared/gmc/Layout";
import { DataTable } from "../../shared/gmc/Table";

/**
 * Import a month's pay from a CSV saved in Excel. Nothing changes until the employer has seen
 * the preview and applied it; rows with problems are listed and left out.
 */
export function PayrollCsvImport({
  roster,
  currencies,
  fileName,
  formatAmount,
  check,
  onApply
}: {
  roster: RosterEntry[];
  currencies: string[];
  fileName: string;
  formatAmount: (minor: number, currency: string) => string;
  /** Extra per-row check, e.g. a currency with no rate for the month. Returns a problem or undefined. */
  check?: (u: CsvUpdate) => string | undefined;
  onApply: (updates: CsvUpdate[]) => boolean | Promise<boolean>;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<(CsvImportResult & { file: string }) | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const download = () => {
    const url = URL.createObjectURL(new Blob([payrollTemplate(roster)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  };

  const choose = async (file: File | undefined) => {
    setResult(null);
    setError(undefined);
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setError(`${file.name} isn't a CSV file. In Excel, choose File › Save As › CSV UTF-8, then upload that file.`);
    if (file.size > MAX_CSV_BYTES) return setError(`${file.name} is larger than 1 MB.`);
    const r = matchPayrollCsv(await file.text(), roster, currencies);
    if (check) {
      const kept: CsvUpdate[] = [];
      for (const u of r.updates) {
        const p = check(u);
        if (p) r.problems.push({ row: u.row, message: `${u.name}: ${p}` });
        else kept.push(u);
      }
      r.updates = kept;
      r.problems.sort((a, b) => a.row - b.row);
    }
    setResult({ ...r, file: file.name });
  };

  const reset = () => {
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const apply = async () => {
    if (!result?.updates.length) return;
    setBusy(true);
    try {
      if (await onApply(result.updates)) reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${inputId}-h`} className="grid gap-4 border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id={`${inputId}-h`} className="flex items-center gap-2 font-medium">
            <FileSpreadsheet className="size-4 text-brand-ink" aria-hidden="true" /> Import pay from Excel
          </h2>
          <p className="max-w-2xl text-sm text-muted">Download the template, fill in each employee's gross pay, save it in Excel as CSV UTF-8, and upload it. Employees are matched by ID, or by name if there's no ID. Anyone left out of the file keeps their current pay.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={download}>
            <Download /> Download template
          </Button>
          <label htmlFor={inputId} className="inline-flex h-8 cursor-pointer items-center gap-2 border border-primary bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-hover focus-within:shadow-[0_0_0_3px_var(--ring)] [&_svg]:size-4">
            <Upload aria-hidden="true" /> Upload CSV
            <input ref={fileRef} id={inputId} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
        </div>
      </div>

      {error ? <Alert tone="rejected">{error}</Alert> : null}

      {result ? (
        <div className="grid gap-4 border-t border-line pt-4">
          <p className="text-sm">
            <span className="font-medium">{result.file}</span>: {result.rowCount} row{result.rowCount === 1 ? "" : "s"} read, <strong>{result.updates.length}</strong> pay change{result.updates.length === 1 ? "" : "s"}
            {result.problems.length ? <>, <strong className="text-act-fg">{result.problems.length}</strong> row{result.problems.length === 1 ? "" : "s"} skipped</> : null}.
          </p>
          {result.problems.length ? (
            <Alert tone="action" title="Rows that won't be imported">
              <ul className="grid gap-1">
                {result.problems.map((p, i) => (
                  <li key={i}>
                    Row {p.row}: {p.message}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {result.updates.length ? (
            <DataTable
              caption="Pay changes from the file"
              rows={result.updates}
              rowKey={(u) => u.key}
              columns={[
                { key: "n", header: "Employee", cell: (u) => <span className="font-medium">{u.name}</span> },
                { key: "f", header: "Current pay", align: "right", cell: (u) => <span className="num text-muted">{formatAmount(u.fromMinor, u.fromCurrency)}</span> },
                { key: "t", header: "From the file", align: "right", cell: (u) => <span className="num font-medium">{formatAmount(u.amountMinor, u.currency)}</span> },
                { key: "r", header: "Row", align: "right", cell: (u) => <span className="num text-muted">{u.row}</span> }
              ]}
            />
          ) : (
            <p className="text-sm text-muted">Nothing to change: every matched employee already has this pay.</p>
          )}
          {result.notInFile.length && result.updates.length ? <p className="text-sm text-muted">Not in the file, so unchanged: {result.notInFile.join(", ")}.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!result.updates.length || busy} loading={busy} onClick={() => void apply()}>
              Apply {result.updates.length} change{result.updates.length === 1 ? "" : "s"}
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
