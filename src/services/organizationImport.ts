import { audit, nextId, ServiceError, type Actor } from "../domain/store";
import { require } from "../domain/permissions";
import type { Company, CompanyType, Db } from "../domain/types";
import { parseCsv, toCsv } from "../lib/payrollCsv";
import { setOrganizationOfficer } from "./assignments";
import { nowIso } from "./clock";

/**
 * Organizations reach the portal two ways: a representative registers the company (looked up in the
 * Corporate Registry), or the GMCA Tax Administrator imports a list of organizations from a CSV, for
 * example an export from the Corporate Registration Office, so officers can be assigned before any
 * representative signs up. An imported organization has no representative yet; the first one to
 * register with its UEN takes it over.
 */

export const ORG_CSV_HEADERS = ["Name", "UEN", "Type", "Sector", "Registered address", "Incorporated on", "Tax officer email"] as const;
const MAX_ROWS = 2_000;

export type OrganizationRow = { row: number; name: string; uen: string; type: CompanyType; sector: string; registeredAddress: string; incorporatedOn: string; officerId: string | null };
export type OrganizationImportCheck = { rows: OrganizationRow[]; problems: { row: number; message: string }[]; rowCount: number };

export function organizationTemplate() {
  return toCsv([
    [...ORG_CSV_HEADERS],
    ["Druk Solar Works Pvt Ltd", "GMC-UEN-2026-0101", "Company", "Renewable energy", "Plot 3, Energy Park, Gelephu", "2026-03-15", "ugyen.tshering@gmca.demo.test"],
    ["Pelden Tailoring", "GMC-SP-2026-0102", "Sole proprietorship", "Retail", "Market Road 8, Gelephu", "2026-05-02", ""]
  ]);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, "");

function parseType(raw: string): CompanyType | null {
  const t = norm(raw);
  if (["company", "pvtltd", "privatelimited", "co"].includes(t)) return "COMPANY";
  if (["soleproprietorship", "soleproprietor", "sp", "sole"].includes(t)) return "SOLE_PROPRIETORSHIP";
  return null;
}

/** Reads and checks the file. Nothing is saved until importOrganizations runs on the rows. */
export function checkOrganizationCsv(d: Db, text: string): OrganizationImportCheck {
  const rows = parseCsv(text);
  const result: OrganizationImportCheck = { rows: [], problems: [], rowCount: 0 };
  if (!rows.length) return { ...result, problems: [{ row: 1, message: "The file is empty." }] };
  if (rows.length - 1 > MAX_ROWS) return { ...result, problems: [{ row: 1, message: `The file has more than ${MAX_ROWS.toLocaleString("en-US")} organizations.` }] };
  const head = rows[0]!.map(norm);
  const col = (h: string) => head.indexOf(norm(h));
  const c = { name: col("Name"), uen: col("UEN"), type: col("Type"), sector: col("Sector"), address: col("Registered address"), inc: col("Incorporated on"), officer: col("Tax officer email") };
  const missing = (["Name", "UEN", "Type"] as const).filter((h) => col(h) < 0);
  if (missing.length) return { ...result, problems: [{ row: 1, message: `The first row must have the column headings. Missing: ${missing.join(", ")}. Download the template to see the layout.` }] };
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const cell = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    if (r.every((x) => !x.trim())) return;
    result.rowCount += 1;
    const name = cell(c.name);
    const uen = cell(c.uen).toUpperCase();
    const label = name || uen || `Row ${rowNo}`;
    if (!name) return void result.problems.push({ row: rowNo, message: "Enter the organization's name." });
    if (!/^[A-Z0-9][A-Z0-9-]{3,}$/.test(uen)) return void result.problems.push({ row: rowNo, message: `${label}: "${uen || "(blank)"}" isn't a UEN or sole proprietorship number.` });
    if (seen.has(uen)) return void result.problems.push({ row: rowNo, message: `${label}: ${uen} appears more than once in the file.` });
    seen.add(uen);
    if (d.companies.some((x) => x.uen === uen)) return void result.problems.push({ row: rowNo, message: `${label}: ${uen} is already in the portal.` });
    const type = parseType(cell(c.type));
    if (!type) return void result.problems.push({ row: rowNo, message: `${label}: type must be Company or Sole proprietorship.` });
    const inc = cell(c.inc);
    if (inc && !/^\d{4}-\d{2}-\d{2}$/.test(inc)) return void result.problems.push({ row: rowNo, message: `${label}: write the incorporation date as YYYY-MM-DD, like 2026-03-15.` });
    const email = cell(c.officer).toLowerCase();
    let officerId: string | null = null;
    if (email) {
      const officer = d.users.find((u) => u.email.toLowerCase() === email);
      if (!officer || officer.role !== "ASSESSOR" || officer.status !== "ACTIVE") return void result.problems.push({ row: rowNo, message: `${label}: ${email} isn't an active GMCA tax officer.` });
      officerId = officer.id;
    }
    result.rows.push({ row: rowNo, name, uen, type, sector: cell(c.sector), registeredAddress: cell(c.address), incorporatedOn: inc, officerId });
  });
  if (!result.rowCount && !result.problems.length) result.problems.push({ row: 2, message: "The file has headings but no organizations." });
  return result;
}

/** Adds the checked organizations and, where the file names one, assigns their tax officer. */
export function importOrganizations(d: Db, actor: Actor, rows: OrganizationRow[]) {
  require(actor, "admin.assignments");
  if (!rows.length) throw new ServiceError("There are no organizations to import.");
  const created: Company[] = [];
  for (const r of rows) {
    if (d.companies.some((x) => x.uen === r.uen)) throw new ServiceError(`${r.uen} is already in the portal. Check the file again.`, "CONFLICT");
    const c: Company = {
      id: nextId(d, "CO"),
      uen: r.uen,
      name: r.name,
      type: r.type,
      sector: r.sector,
      registeredAddress: r.registeredAddress,
      incorporatedOn: r.incorporatedOn,
      verification: { provider: "COMPANY_REGISTRY", status: "NOT_VERIFIED", simulated: true },
      representatives: [],
      registeredAt: nowIso(),
      importedBy: actor.id
    };
    d.companies.push(c);
    created.push(c);
    if (r.officerId) setOrganizationOfficer(d, actor, c.id, r.officerId);
  }
  audit(d, actor, "ORGANIZATIONS_IMPORTED", "Company", created[0]!.id, `${created.length} organization${created.length === 1 ? "" : "s"} imported from CSV`);
  return created;
}
