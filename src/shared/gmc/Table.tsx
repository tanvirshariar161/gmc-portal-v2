import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "left" | "right"; className?: string };

/** GMC data table (C21): green header, square corners, hover rows. Scrolls sideways inside its own box on narrow screens. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  foot,
  minWidth = "40rem",
  empty,
  rowClassName
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  foot?: ReactNode[];
  minWidth?: string;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-primary text-white">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("h-10 whitespace-nowrap px-4 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="bg-surface">
              <td colSpan={columns.length} className="px-4 py-6 text-center text-muted">
                {empty ?? "Nothing to show."}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className={cn("border-b border-line bg-surface transition-colors hover:bg-brand-50", rowClassName?.(row))}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-2.5 align-middle", c.align === "right" && "num text-right", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {foot ? (
          <tfoot className="num font-medium">
            <tr className="bg-sunk">
              {foot.map((f, i) => (
                <td key={i} className={cn("px-4 py-3", i > 0 && columns[i]?.align === "right" && "text-right")}>
                  {f}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
