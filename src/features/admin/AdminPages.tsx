import { Check, FileSpreadsheet, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useActor, useDb, useDocumentTitle, useRun, useToast } from "../../app/core";
import { PERMISSIONS, ROLE_LABEL, ROLE_PERMISSIONS } from "../../domain/permissions";
import { resetDemoData } from "../../domain/store";
import type { Band, BankMode, Db, IntegrationMode, ReliefRule, Role, StaffRole, TaxRuleSet } from "../../domain/types";
import { formatDate, formatDateTime } from "../../lib/format";
import { formatMoney, formatRate, minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { addCurrency, addExchangeRate, createStaffUser, publishRuleSet, recordIncentive, revokeIncentive, setBankMode, setCurrencyEnabled, setIntegrationMode, setPlatformSetting, setStaffRole, setUserStatus, STAFF_ROLES } from "../../services/admin";
import { assignmentFor, organizationsOf, setOrganizationOfficer } from "../../services/assignments";
import { ruleSetForYear } from "../../services/calc";
import { buildRuleWorkbook, type WorkbookFocus } from "../../services/ruleWorkbook";
import { today } from "../../services/clock";
import { Button } from "../../shared/gmc/Button";
import { Checkbox, SelectField, TextArea, TextField } from "../../shared/gmc/Form";
import { Alert, StatusBadge } from "../../shared/gmc/Layout";
import { DataTable } from "../../shared/gmc/Table";
import { ClassificationEditor } from "./ClassificationEditor";
import { KeyValue, MetricStrip, PageHeader, Section, ownerName, userName } from "../shared/ui";

// ---------- Overview ----------

export function AdminOverview() {
  useDocumentTitle("Administration");
  const db = useDb();
  const active = ruleSetForYear(db.ruleSets, db.config.currentFilingYear);
  const lastConfig = db.audit.filter((e) => ["RULESET_PUBLISHED", "INCENTIVE_RECORDED", "EXCHANGE_RATE_ADDED", "SETTINGS_UPDATED", "INTEGRATION_MODE", "OFFICER_ASSIGNED", "OFFICER_UNASSIGNED"].includes(e.action)).slice(0, 6);
  const forced = Object.entries(db.config.integrations).filter(([k, v]) => k !== "pendingResolvesTo" && v !== "SEEDED" && v !== "CHOOSE");
  return (
    <>
      <PageHeader title="Tax administration" lead="Tax rules, officer assignments and integration settings. Tax administrators don't assess returns, manage user accounts or change a submitted declaration." />
      {forced.length ? <Alert tone="action" title="An integration is not in its default mode">{forced.map(([k, v]) => `${k}: ${String(v).toLowerCase().replace(/_/g, " ")}`).join(" · ")}. <Link className="underline" to="/admin/integrations">Change</Link></Alert> : null}
      <MetricStrip
        items={[
          { label: "GMCA officers", value: db.users.filter((u) => u.role === "ASSESSOR" && u.status === "ACTIVE").length },
          { label: "Organizations with an officer", value: `${db.officerAssignments.length} of ${db.companies.length}`, hint: "Officer assignments" },
          { label: "Active rule set", value: active.version },
          { label: "Reporting currency", value: db.config.reportingCurrency, hint: `${db.config.currencies.filter((c) => c.enabled).length} currencies enabled` }
        ]}
      />
      <Section title="Recent configuration changes" actions={<Link to="/admin/audit" className="text-sm text-brand-ink underline-offset-4 hover:underline">Full audit log</Link>}>
        <AuditList db={db} entries={lastConfig} />
      </Section>
      <Section title="Open questions for GMCA" description="These rules await GMCA confirmation. Each is configurable so the confirmed answer can be entered without code changes.">
        <ul className="grid gap-x-8 gap-y-2 border border-line bg-surface p-5 text-sm sm:grid-cols-2">
          {["Individual tax bands, thresholds and formula", "Tax-residency definition and foreign-national treatment", "Relief categories, limits, evidence and approval", "TDS formula, health contribution rate and scope", "Reporting currency, rate source, conversion date, rounding", "Corporate schedules, allowable expenses, adjustments", "Filing deadlines, penalties, interest and refunds", "Excess TDS carry-forward", "Officer assignment rules and permission matrix", "DK Bank payment and reconciliation API", "Official certificate and notice formats", "SSO, hosting (on-premises, TashiCell Gelephu preferred)"].map((q) => (
            <li key={q} className="flex gap-2"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-act-line" />{q}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function AuditList({ db, entries }: { db: Db; entries: Db["audit"] }) {
  return (
    <DataTable
      caption="Audit entries"
      rows={entries}
      rowKey={(e) => e.id}
      minWidth="52rem"
      empty="No entries."
      columns={[
        { key: "t", header: "When", cell: (e) => <span className="whitespace-nowrap text-xs">{formatDateTime(e.at)}</span> },
        { key: "a", header: "Who", cell: (e) => <span className="grid"><span>{e.actorName}</span><span className="text-xs text-muted">{e.actorRole === "SYSTEM" ? "System" : ROLE_LABEL[e.actorRole]}</span></span> },
        { key: "c", header: "Action", cell: (e) => <span className="num text-xs">{e.action}</span> },
        { key: "s", header: "Details", cell: (e) => e.summary }
      ]}
    />
  );
}

// ---------- Users & roles ----------

export function UsersPage() {
  useDocumentTitle("Users & roles");
  const db = useDb();
  const actor = useActor();
  const run = useRun();
  const [role, setRole] = useState<"ALL" | Role>("ALL");
  const [form, setForm] = useState({ name: "", email: "", role: "ASSESSOR" as StaffRole, title: "" });
  const users = db.users.filter((u) => role === "ALL" || u.role === role);
  return (
    <>
      <PageHeader title="Users & roles" lead="Create GMCA staff accounts, change staff roles and deactivate accounts. Taxpayer and employer accounts come from registration. Tax rules and officer assignments belong to the GMCA Tax Administrator." />
      <Section title="Accounts" actions={<SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="w-64"><option value="ALL">All roles</option>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</SelectField>}>
        <DataTable
          caption="User accounts"
          rows={users}
          rowKey={(u) => u.id}
          minWidth="60rem"
          columns={[
            { key: "n", header: "Name", cell: (u) => <span className="grid"><span className="font-medium">{u.name}</span><span className="text-xs text-muted">{u.email}</span></span> },
            {
              key: "r",
              header: "Role",
              cell: (u) =>
                STAFF_ROLES.includes(u.role as StaffRole) && u.id !== actor.id ? (
                  <select aria-label={`Role for ${u.name}`} className="control h-8 w-56 text-sm" value={u.role} onChange={(e) => run((d, a) => setStaffRole(d, a, u.id, e.target.value as StaffRole), "Role changed")}>
                    {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  ROLE_LABEL[u.role]
                )
            },
            { key: "o", header: "Linked to", cell: (u) => (u.taxpayerId ? ownerName(db, { kind: "INDIVIDUAL", id: u.taxpayerId }) : u.companyId ? ownerName(db, { kind: "COMPANY", id: u.companyId }) : u.title ?? "—") },
            { key: "l", header: "Last sign-in", cell: (u) => <span className="text-xs">{formatDateTime(u.lastSignInAt)}</span> },
            { key: "s", header: "Status", cell: (u) => <StatusBadge tone={u.status === "ACTIVE" ? "approved" : "neutral"}>{u.status === "ACTIVE" ? "Active" : "Deactivated"}</StatusBadge> },
            { key: "x", header: <span className="sr-only">Action</span>, cell: (u) => (u.id === actor.id ? <span className="text-xs text-muted">You</span> : <Button size="sm" variant={u.status === "ACTIVE" ? "secondary" : "primary"} onClick={() => run((d, a) => setUserStatus(d, a, u.id, u.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE"), u.status === "ACTIVE" ? "Account deactivated" : "Account reactivated")}>{u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</Button>) }
          ]}
        />
      </Section>
      <Section title="Create a staff account">
        <form
          className="grid max-w-3xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (run((d, a) => createStaffUser(d, a, form), "Account created")) setForm({ name: "", email: "", role: "ASSESSOR", title: "" });
          }}
        >
          <TextField label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </SelectField>
          <TextField label="Job title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="sm:col-span-2">
            <Button type="submit"><Plus /> Create account</Button>
          </div>
        </form>
      </Section>
      <Section title="Role permissions" description="Proposed. GMCA's permission matrix is an open question. Record-level rules also apply: taxpayers see only their own records, assessors act only on cases assigned to them.">
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Permissions by role</caption>
            <thead>
              <tr className="bg-thead text-thead-fg">
                <th scope="col" className="h-10 px-4 text-left font-medium">Permission</th>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <th key={r} scope="col" className="px-3 text-center font-medium">{ROLE_LABEL[r].split(" / ")[0]!.replace("GMCA ", "")}</th>)}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).map((p) => (
                <tr key={p} className="border-b border-line bg-surface">
                  <th scope="row" className="px-4 py-2 text-left font-normal">{PERMISSIONS[p]}</th>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <td key={r} className="px-3 py-2 text-center">{ROLE_PERMISSIONS[r].includes(p) ? <Check aria-label="Yes" className="mx-auto size-4 text-ok-fg" /> : <span aria-label="No" className="text-line">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ---------- Officer assignments ----------

export function AssignmentsPage() {
  useDocumentTitle("Officer assignments");
  const db = useDb();
  const run = useRun();
  const officers = db.users.filter((u) => u.role === "ASSESSOR");
  const activeOfficers = officers.filter((u) => u.status === "ACTIVE");
  const companyName = (id: string) => db.companies.find((c) => c.id === id)?.name ?? id;
  const taxpayersOf = (companyId: string) => new Set(db.employees.filter((e) => e.companyId === companyId && e.taxpayerId && e.status !== "LEFT").map((e) => e.taxpayerId!));
  const openCases = (companyId: string) => {
    const people = taxpayersOf(companyId);
    return db.assessments.filter((a) => a.status !== "COMPLETED" && (a.owner.kind === "COMPANY" ? a.owner.id === companyId : people.has(a.owner.id))).length;
  };
  return (
    <>
      <PageHeader
        title="Officer assignments"
        lead="Assign a GMCA tax officer to each organization. Returns from the organization, and from the individuals it employs, go straight to that officer when they are submitted. One officer can cover several organizations."
      />
      <Section title="Organizations" description="Changing the officer also moves the organization's open cases that nobody has picked up yet. Cases already in progress stay with their officer.">
        <DataTable
          caption="Organizations and their tax officers"
          rows={db.companies}
          rowKey={(c) => c.id}
          minWidth="52rem"
          empty="No organizations are registered yet."
          columns={[
            { key: "n", header: "Organization", cell: (c) => <span className="grid"><span className="font-medium">{c.name}</span><span className="num text-xs text-muted">{c.uen} · {c.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company"}</span></span> },
            { key: "p", header: "Employees with tax accounts", cell: (c) => <span className="num">{taxpayersOf(c.id).size}</span> },
            { key: "c", header: "Open cases", cell: (c) => <span className="num">{openCases(c.id)}</span> },
            {
              key: "o",
              header: "Tax officer",
              cell: (c) => {
                const current = assignmentFor(db, c.id);
                return (
                  <select
                    aria-label={`Tax officer for ${c.name}`}
                    className="control h-9 w-64 text-sm"
                    value={current?.officerId ?? ""}
                    onChange={(e) => {
                      const officerId = e.target.value || null;
                      run((d, a) => setOrganizationOfficer(d, a, c.id, officerId), officerId ? `${userName(db, officerId)} assigned to ${c.name}` : `${c.name} has no assigned officer now`);
                    }}
                  >
                    <option value="">Not assigned</option>
                    {activeOfficers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    {current && !activeOfficers.some((o) => o.id === current.officerId) ? <option value={current.officerId}>{userName(db, current.officerId)} (deactivated)</option> : null}
                  </select>
                );
              }
            },
            { key: "w", header: "Assigned", cell: (c) => { const a = assignmentFor(db, c.id); return a ? <span className="text-xs">{formatDate(a.assignedAt)} · {userName(db, a.assignedBy)}</span> : <span className="text-xs text-muted">—</span>; } }
          ]}
        />
      </Section>
      <Section title="Officers" description="Who covers what. Individuals are assessed by the officer of the organization that employs them.">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {officers.map((o) => {
            const orgs = organizationsOf(db, o.id);
            const mine = db.assessments.filter((a) => a.assignedTo === o.id && a.status !== "COMPLETED").length;
            return (
              <li key={o.id} className="grid content-start gap-3 border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid">
                    <span className="font-medium">{o.name}</span>
                    <span className="text-sm text-muted">{o.title ?? ROLE_LABEL.ASSESSOR}</span>
                  </span>
                  {o.status !== "ACTIVE" ? <StatusBadge tone="neutral">Deactivated</StatusBadge> : null}
                </div>
                <p className="text-sm"><span className="num font-medium">{mine}</span> open {mine === 1 ? "case" : "cases"} assigned</p>
                {orgs.length ? (
                  <ul className="grid gap-1 text-sm">
                    {orgs.map((id) => <li key={id} className="flex gap-2"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />{companyName(id)}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No organizations yet.</p>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// ---------- Tax configuration ----------

function BandsEditor({ label, bands, onChange }: { label: string; bands: Band[]; onChange: (b: Band[]) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_7rem_auto] items-end gap-2">
          <TextField label={i === 0 ? "From" : <span className="sr-only">From</span>} value={minorToInput(b.fromMinor)} readOnly inputClassName="read-only:bg-surface read-only:text-fg" />
          <TextField
            label={i === 0 ? "Up to" : <span className="sr-only">Up to</span>}
            inputMode="decimal"
            placeholder="No limit"
            value={b.toMinor === null ? "" : minorToInput(b.toMinor)}
            onChange={(e) => {
              const to = e.target.value === "" ? null : parseAmountInput(e.target.value);
              const next = bands.map((x) => ({ ...x }));
              next[i]!.toMinor = to === null && e.target.value !== "" ? b.toMinor : to;
              if (next[i + 1] && next[i]!.toMinor !== null) next[i + 1]!.fromMinor = next[i]!.toMinor!;
              onChange(next);
            }}
          />
          <TextField label={i === 0 ? "Rate %" : <span className="sr-only">Rate %</span>} inputMode="decimal" value={String(b.ratePct)} onChange={(e) => onChange(bands.map((x, j) => (j === i ? { ...x, ratePct: Number(e.target.value) || 0 } : x)))} />
          <Button variant="ghost" aria-label={`Remove band ${i + 1}`} disabled={bands.length <= 1} onClick={() => { const next = bands.filter((_, j) => j !== i); if (next.length) { next[0]!.fromMinor = 0; next[next.length - 1]!.toMinor = null; for (let k = 1; k < next.length; k++) next[k]!.fromMinor = next[k - 1]!.toMinor ?? next[k]!.fromMinor; } onChange(next); }}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        onClick={() => {
          const last = bands[bands.length - 1]!;
          const split = last.fromMinor + 100_000_000;
          onChange([...bands.slice(0, -1), { ...last, toMinor: split }, { fromMinor: split, toMinor: null, ratePct: last.ratePct }]);
        }}
      >
        <Plus /> Add band
      </Button>
    </fieldset>
  );
}

export function TaxConfigPage() {
  useDocumentTitle("Tax configuration");
  const db = useDb();
  const [year, setYear] = useState(db.config.currentFilingYear);
  // Years the administrator added in this visit that have no published rules yet.
  const [added, setAdded] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [yearInput, setYearInput] = useState("");
  const configured = [...new Set(db.ruleSets.map((r) => r.effectiveFromYear))];
  const years = [...new Set([...configured, ...added])].sort((a, b) => a - b);
  const active = ruleSetForYear(db.ruleSets, year);
  const inherited = active.effectiveFromYear !== year;
  const yearError = !/^\d{4}$/.test(yearInput) || Number(yearInput) < MIN_RULE_YEAR || Number(yearInput) > MAX_RULE_YEAR ? `Enter a year from ${MIN_RULE_YEAR} to ${MAX_RULE_YEAR}` : years.includes(Number(yearInput)) ? `${yearInput} is already in the list` : undefined;
  const [showError, setShowError] = useState(false);
  const addYear = (e: FormEvent) => {
    e.preventDefault();
    if (yearError) return setShowError(true);
    const y = Number(yearInput);
    setAdded([...added, y]);
    setYear(y);
    setAdding(false);
    setYearInput("");
    setShowError(false);
  };
  return (
    <>
      <PageHeader title="Tax configuration" lead="Rates and rules used by the calculation engine, set per financial year. Rules apply from their year until a later year has its own. Publishing creates a new version; submitted returns keep the version they used." />
      <div className="grid gap-4 border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Financial year">
          <span className="mr-1 text-sm text-muted">Financial year</span>
          {years.map((y) => {
            const draft = !configured.includes(y);
            return (
              <button key={y} type="button" onClick={() => setYear(y)} aria-pressed={y === year} className={cn("inline-flex items-center gap-2 border px-3 py-1.5 text-sm", y === year ? "border-primary bg-brand-50 font-medium text-brand-ink" : "border-line hover:bg-sunk", draft && "border-dashed")}>
                <span className="num">{y}</span>
                {draft ? <span className="text-xs font-normal text-muted">not published</span> : null}
              </button>
            );
          })}
          {!adding ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus /> Add financial year
            </Button>
          ) : null}
        </div>
        {adding ? (
          <form className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-4" onSubmit={addYear} noValidate>
            <TextField
              label="New financial year"
              inputMode="numeric"
              autoFocus
              className="w-48"
              placeholder={String(Math.max(...years) + 1)}
              value={yearInput}
              error={showError ? yearError : undefined}
              hint={`Any year from ${MIN_RULE_YEAR} to ${MAX_RULE_YEAR}`}
              onChange={(e) => { setYearInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setShowError(false); }}
            />
            <Button type="submit">Add year</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setYearInput(""); setShowError(false); }}>Cancel</Button>
          </form>
        ) : null}
      </div>
      {inherited ? (
        <Alert tone="review" title={`Set the rules for ${year}`}>
          The form starts from the {active.effectiveFromYear} rules (version {active.version}), which returns for {year} use until you publish. Change anything below and publish to save rules for {year}; other years keep theirs.
        </Alert>
      ) : null}
      <RuleSetEditor key={`${active.id}-${year}`} db={db} base={active} year={year} sections={["rates"]} />
      <PlatformSettings db={db} />
      <Section title="Version history">
        <DataTable caption="Rule set versions" rows={db.ruleSets.filter((r) => r.effectiveFromYear === year)} rowKey={(r) => r.id} columns={[{ key: "v", header: "Version", cell: (r) => r.version }, { key: "s", header: "Status", cell: (r) => <StatusBadge tone={r.status === "ACTIVE" ? "approved" : "neutral"}>{r.status === "ACTIVE" ? "Active" : "Retired"}</StatusBadge> }, { key: "b", header: "Published by", cell: (r) => userName(db, r.createdBy) }, { key: "d", header: "Published", cell: (r) => formatDateTime(r.createdAt) }, { key: "u", header: "Used by", align: "right", cell: (r) => `${db.individualReturns.filter((x) => x.calculation?.ruleSetId === r.id && x.submissionStatus === "SUBMITTED").length + db.corporateReturns.filter((x) => x.calculation?.ruleSetId === r.id && x.submissionStatus === "SUBMITTED").length} returns` }]} />
      </Section>
    </>
  );
}

const MIN_RULE_YEAR = 2025;
const MAX_RULE_YEAR = 2100;

/**
 * Downloads the rule impact workbook: these rules applied to a demo taxpayer and company with live
 * Excel formulas, so the administrator can change numbers and see the effect before publishing.
 */
function RuleWorkbookButton({ rules, focus, draft }: { rules: TaxRuleSet; focus: WorkbookFocus; draft: boolean }) {
  const db = useDb();
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        const { bytes, fileName } = buildRuleWorkbook(db, rules, focus, { draft });
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        toast("ok", `${fileName} downloaded. Change the yellow cells to see the impact.`);
      }}
    >
      <FileSpreadsheet /> Download impact workbook (Excel)
    </Button>
  );
}

/** Edits a copy of `base`. With `year` set to a later year than the base, publishing creates that year's first rule set. */
function RuleSetEditor({ db, base, sections, year = base.effectiveFromYear }: { db: Db; base: TaxRuleSet; sections: ("rates" | "reliefs" | "classification")[]; year?: number }) {
  const run = useRun();
  const [draft, setDraft] = useState<TaxRuleSet>(() => structuredClone(base));
  const [reason, setReason] = useState("");
  const set = (patch: Partial<TaxRuleSet>) => setDraft({ ...draft, ...patch });
  const newYear = year !== base.effectiveFromYear;
  const changed = newYear || JSON.stringify(draft) !== JSON.stringify(base);
  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const { id: _i, version: _v, createdAt: _c, createdBy: _b, status: _s, ...changes } = draft;
        const forYear = newYear ? { effectiveFromYear: year, label: draft.label.replace(/\(\d{4}\)$/, `(${year})`) } : {};
        if (run((d, a) => publishRuleSet(d, a, base.id, { ...changes, ...forYear }, reason), newYear ? `Rules for ${year} published` : "New rule set version published")) setReason("");
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{newYear ? <>Starting from version <strong>{base.version}</strong> ({base.effectiveFromYear}). Publishing sets the rules for <strong>{year}</strong>.</> : <>Editing from version <strong>{base.version}</strong>.</>}</p>
        <RuleWorkbookButton rules={{ ...draft, effectiveFromYear: year }} focus={sections[0]!} draft={changed} />
      </div>
      {sections.includes("rates") ? (
        <>
          <Section title="Individual income tax">
            <div className="grid gap-6 border border-line bg-surface p-5 lg:grid-cols-2">
              <BandsEditor label={`Annual bands (${db.config.reportingCurrency})`} bands={draft.individualBands} onChange={(b) => set({ individualBands: b })} />
              <div className="grid content-start gap-4">
                <p className="text-sm text-fg-2">These bands apply to every taxpayer class set to the Income Tax Act bands. Flat rates, such as the non-resident rate, belong to their class under <Link className="underline" to="/admin/classification">Tax classification</Link>.</p>
                <SelectField label="Excess TDS carry-forward" value={draft.excessCreditCarryForward === null ? "NULL" : String(draft.excessCreditCarryForward)} onChange={(e) => set({ excessCreditCarryForward: e.target.value === "NULL" ? null : e.target.value === "true" })}>
                  <option value="NULL">Not configured</option>
                  <option value="true">Carry forward</option>
                  <option value="false">Not allowed</option>
                </SelectField>
              </div>
            </div>
          </Section>
          <Section title="Employer monthly TDS and health contributions">
            <div className="grid gap-6 border border-line bg-surface p-5 lg:grid-cols-2">
              <BandsEditor label={`Monthly TDS table (${db.config.reportingCurrency})`} bands={draft.tdsBands} onChange={(b) => set({ tdsBands: b })} />
              <div className="grid content-start gap-4">
                <SelectField label="TDS method" value={draft.tdsMethod} onChange={(e) => set({ tdsMethod: e.target.value as TaxRuleSet["tdsMethod"] })}>
                  <option value="BRACKET_WHOLE_AMOUNT">Bracket rate on the whole month's pay</option>
                  <option value="PROGRESSIVE_MONTHLY">Progressive through the monthly bands</option>
                </SelectField>
                <TextField label="Health contribution %" inputMode="decimal" value={String(draft.healthRatePct)} onChange={(e) => set({ healthRatePct: Number(e.target.value) || 0 })} />
                <SelectField label="Health contribution applies to" value={draft.healthAppliesTo} onChange={(e) => set({ healthAppliesTo: e.target.value as TaxRuleSet["healthAppliesTo"] })}>
                  <option value="ALL">All employees</option>
                  <option value="CITIZENS">Bhutanese employees only</option>
                </SelectField>
                <p className="text-xs text-muted">No social security deduction: GMC operates a clean wage policy.</p>
              </div>
            </div>
          </Section>
          <Section title="Corporate income tax">
            <p className="max-w-2xl border border-line bg-surface p-5 text-sm text-fg-2">Corporate rates are set per entity type under <Link className="underline" to="/admin/classification">Tax classification</Link>. Approved company incentives override them for their effective period.</p>
          </Section>
        </>
      ) : null}
      {sections.includes("reliefs") ? <ReliefEditor reliefs={draft.reliefs} onReliefs={(r) => set({ reliefs: r })} currency={db.config.reportingCurrency} /> : null}
      {sections.includes("classification") ? <ClassificationEditor draft={draft} base={base} onClasses={(c) => set({ taxpayerClasses: c })} onItems={(i) => set({ taxItems: i })} /> : null}
      <div className="grid max-w-2xl gap-3 border border-primary bg-surface p-5">
        <TextArea label="Reason for the change" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="Saved in the audit log with the new version." />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!changed}>{newYear ? `Publish rules for ${year}` : "Publish new version"}</Button>
          <Button variant="secondary" disabled={!changed} onClick={() => setDraft(structuredClone(base))}><RotateCcw /> Discard changes</Button>
        </div>
      </div>
    </form>
  );
}

/** New reliefs are added at the top, so the next free number (not the list length) keeps keys unique. */
function uniqueReliefKey(reliefs: ReliefRule[]) {
  let n = reliefs.length + 1;
  while (reliefs.some((r) => r.key === `RELIEF_${n}`)) n += 1;
  return `RELIEF_${n}`;
}

function ReliefEditor({ reliefs, onReliefs, currency }: { reliefs: ReliefRule[]; onReliefs: (r: ReliefRule[]) => void; currency: string }) {
  const upd = (i: number, patch: Partial<ReliefRule>) => onReliefs(reliefs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <Section title="Reliefs and deductions" actions={<Button size="sm" variant="secondary" onClick={() => onReliefs([{ key: uniqueReliefKey(reliefs), label: "", description: "", capMinor: null, evidenceExamples: [], enabled: true }, ...reliefs])}><Plus /> Add relief</Button>}>
        <div className="grid gap-4">
          {reliefs.map((r, i) => (
            <fieldset key={r.key} className={cn("grid gap-4 border bg-surface p-5 sm:grid-cols-2", r.enabled ? "border-line" : "border-dashed border-line opacity-80")}>
              <legend className="sr-only">{r.label || `Relief ${i + 1}`}</legend>
              <TextField label="Name" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} />
              <TextField label={`Limit (${currency})`} inputMode="decimal" placeholder="No limit" value={r.capMinor === null ? "" : minorToInput(r.capMinor)} onChange={(e) => upd(i, { capMinor: e.target.value === "" ? null : parseAmountInput(e.target.value) ?? r.capMinor })} />
              <TextArea label="Description shown to taxpayers" rows={2} value={r.description} onChange={(e) => upd(i, { description: e.target.value })} />
              <TextArea label="Evidence examples (one per line)" rows={2} value={r.evidenceExamples.join("\n")} onChange={(e) => upd(i, { evidenceExamples: e.target.value.split("\n") })} />
              <Checkbox checked={r.enabled} onChange={(v) => upd(i, { enabled: v })}>Available to claim</Checkbox>
            </fieldset>
          ))}
        </div>
      </Section>
    </>
  );
}

export function ReliefConfigPage() {
  useDocumentTitle("Relief configuration");
  const db = useDb();
  const [year, setYear] = useState(db.config.currentFilingYear);
  const active = ruleSetForYear(db.ruleSets, year);
  return (
    <>
      <PageHeader title="Relief configuration" lead="Relief categories, limits and evidence examples. Income categories are now part of the tax item catalogue under Tax classification. Changes publish a new rule set version." />
      <SelectField label="Rules for financial year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-56">
        {[...new Set(db.ruleSets.map((r) => r.effectiveFromYear))].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
      </SelectField>
      <RuleSetEditor key={active.id} db={db} base={active} sections={["reliefs"]} />
    </>
  );
}

export function ClassificationPage() {
  useDocumentTitle("Tax classification");
  const db = useDb();
  const [year, setYear] = useState(db.config.currentFilingYear);
  const active = ruleSetForYear(db.ruleSets, year);
  return (
    <>
      <PageHeader title="Tax classification" lead="Who pays which rate, and how each kind of income, expense, asset and liability is treated. Changes publish a new rule set version; submitted returns keep the version they were calculated with." />
      <SelectField label="Rules for financial year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-56">
        {[...new Set(db.ruleSets.map((r) => r.effectiveFromYear))].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
      </SelectField>
      <RuleSetEditor key={active.id} db={db} base={active} sections={["classification"]} />
    </>
  );
}

function PlatformSettings({ db }: { db: Db }) {
  const run = useRun();
  const [s, setS] = useState({ currentFilingYear: db.config.currentFilingYear, filingDeadlineMonthDay: db.config.filingDeadlineMonthDay, payBeforeSubmit: db.config.payBeforeSubmit, currentPayrollPeriod: db.config.currentPayrollPeriod, informationRequestDays: db.config.informationRequestDays, conversionDateRule: db.config.conversionDateRule });
  return (
    <Section title="Filing settings" description="The individual filing deadline is shown to taxpayers on their overview. Penalties for late filing are not configured.">
      <form className="grid max-w-3xl gap-4 border border-line bg-surface p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run((d, a) => setPlatformSetting(d, a, s), "Settings saved"); }}>
        <TextField label="Open individual filing year" type="number" value={String(s.currentFilingYear)} onChange={(e) => setS({ ...s, currentFilingYear: Number(e.target.value) })} />
        <TextField label="Return deadline in the year of assessment (MM-DD)" value={s.filingDeadlineMonthDay} onChange={(e) => setS({ ...s, filingDeadlineMonthDay: e.target.value })} hint={`YA ${s.currentFilingYear + 1} returns are due ${s.filingDeadlineMonthDay}-${s.currentFilingYear + 1}.`} />
        <TextField label="Current payroll month" type="month" value={s.currentPayrollPeriod} onChange={(e) => setS({ ...s, currentPayrollPeriod: e.target.value })} />
        <TextField label="Default days to answer an information request" type="number" value={String(s.informationRequestDays)} onChange={(e) => setS({ ...s, informationRequestDays: Number(e.target.value) })} />
        <SelectField label="Currency conversion date" value={s.conversionDateRule} onChange={(e) => setS({ ...s, conversionDateRule: e.target.value as typeof s.conversionDateRule })}>
          <option value="PERIOD_END">End of the income or payroll period</option>
          <option value="FILING_DATE">Date of filing</option>
        </SelectField>
        <div className="sm:col-span-2">
          <Checkbox checked={s.payBeforeSubmit} onChange={(v) => setS({ ...s, payBeforeSubmit: v })} hint="Version 1 flow: a return with an estimated balance is paid through DK Bank first and submitted on confirmation. Off: returns are submitted first and paid after assessment.">
            Taxpayers pay the estimated balance before the return is submitted
          </Checkbox>
        </div>
        <div className="sm:col-span-2"><Button type="submit">Save settings</Button></div>
      </form>
    </Section>
  );
}

// ---------- Incentives ----------

export function IncentivesPage() {
  useDocumentTitle("Company incentives");
  const db = useDb();
  const run = useRun();
  const [form, setForm] = useState({ companyId: db.companies[0]?.id ?? "", rate: "", effectiveFrom: "", effectiveTo: "", approvalReference: "", notes: "" });
  const [revoke, setRevoke] = useState<Record<string, string>>({});
  return (
    <>
      <PageHeader title="Company incentives" lead="Record a company-specific rate GMCA has already approved outside the platform. The engine applies it to corporate tax in its effective period. Companies can't apply here." actions={<RuleWorkbookButton rules={ruleSetForYear(db.ruleSets, db.config.currentFilingYear)} focus="incentives" draft={false} />} />
      <DataTable
        caption="Incentives"
        rows={db.incentives}
        rowKey={(i) => i.id}
        minWidth="64rem"
        empty="No incentives recorded."
        columns={[
          { key: "c", header: "Company", cell: (i) => ownerName(db, { kind: "COMPANY", id: i.companyId }) },
          { key: "r", header: "Rate", cell: (i) => <strong>{i.ratePct}%</strong> },
          { key: "p", header: "Effective", cell: (i) => `${formatDate(i.effectiveFrom, "short")} – ${formatDate(i.effectiveTo, "short")}` },
          { key: "a", header: "Approval", cell: (i) => i.approvalReference },
          { key: "s", header: "Status", cell: (i) => <StatusBadge tone={i.status === "ACTIVE" ? "approved" : "neutral"}>{i.status === "ACTIVE" ? "Active" : "Revoked"}</StatusBadge> },
          {
            key: "x",
            header: <span className="sr-only">Revoke</span>,
            cell: (i) =>
              i.status === "ACTIVE" ? (
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor={`rv-${i.id}`}>Reason to revoke</label>
                  <input id={`rv-${i.id}`} className="control h-8 w-40 text-sm" placeholder="Reason" value={revoke[i.id] ?? ""} onChange={(e) => setRevoke({ ...revoke, [i.id]: e.target.value })} />
                  <Button size="sm" variant="danger" onClick={() => run((d, a) => revokeIncentive(d, a, i.id, revoke[i.id] ?? ""), "Incentive revoked")}>Revoke</Button>
                </div>
              ) : null
          }
        ]}
      />
      <Section title="Record an approved incentive">
        <form
          className="grid max-w-3xl gap-4 border border-line bg-surface p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (run((d, a) => recordIncentive(d, a, { companyId: form.companyId, ratePct: Number(form.rate), effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo, approvalReference: form.approvalReference, notes: form.notes }), "Incentive recorded")) setForm({ ...form, rate: "", approvalReference: "", notes: "" });
          }}
        >
          <SelectField label="Company" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            {db.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <TextField label="Approved rate %" inputMode="decimal" required value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} hint="The minutes mention 0%, 5% or 10% as examples." />
          <TextField label="Effective from" type="date" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          <TextField label="Effective to" type="date" required value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
          <TextField label="GMCA approval reference" required value={form.approvalReference} onChange={(e) => setForm({ ...form, approvalReference: e.target.value })} />
          <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="sm:col-span-2"><Button type="submit">Record incentive</Button></div>
        </form>
      </Section>
    </>
  );
}

// ---------- Currency ----------

export function CurrencyPage() {
  useDocumentTitle("Currency & rates");
  const db = useDb();
  const run = useRun();
  const [newCur, setNewCur] = useState({ code: "", name: "" });
  const [rate, setRate] = useState({ currency: db.config.currencies.find((c) => c.code !== db.config.reportingCurrency)?.code ?? "", rate: "", quote: "PER_REPORTING" as "PER_UNIT" | "PER_REPORTING", effectiveDate: today(), source: "Illustrative rate" });
  const stored = rate.quote === "PER_UNIT" ? Number(rate.rate) : 1 / Number(rate.rate);
  const rates = [...db.config.exchangeRates].sort((a, b) => a.currency.localeCompare(b.currency) || b.effectiveDate.localeCompare(a.effectiveDate));
  return (
    <>
      <PageHeader title="Currency & exchange rates" lead={`Every amount keeps its original currency and is converted to the reporting currency (${db.config.reportingCurrency}) with the latest rate on or before the conversion date.`} actions={<RuleWorkbookButton rules={ruleSetForYear(db.ruleSets, db.config.currentFilingYear)} focus="currency" draft={false} />} />
      <Section title="Currencies">
        <DataTable
          caption="Currencies"
          rows={db.config.currencies}
          rowKey={(c) => c.code}
          columns={[
            { key: "c", header: "Code", cell: (c) => <span className="num font-medium">{c.code}</span> },
            { key: "n", header: "Name", cell: (c) => c.name },
            { key: "r", header: "Latest rate", cell: (c) => (c.code === db.config.reportingCurrency ? "Reporting currency" : (() => { const r = rates.find((x) => x.currency === c.code); return r ? `${formatRate(r.rate, c.code, db.config.reportingCurrency)} from ${formatDate(r.effectiveDate, "short")}` : <span className="text-act-fg">No rate: conversion pending</span>; })()) },
            { key: "e", header: "Available", cell: (c) => <Checkbox checked={c.enabled} disabled={c.code === db.config.reportingCurrency} onChange={(v) => run((d, a) => setCurrencyEnabled(d, a, c.code, v))}>{c.enabled ? "Enabled" : "Disabled"}</Checkbox> }
          ]}
        />
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (run((d, a) => addCurrency(d, a, newCur.code, newCur.name), "Currency added")) setNewCur({ code: "", name: "" }); }}>
          <TextField label="ISO code" value={newCur.code} maxLength={3} onChange={(e) => setNewCur({ ...newCur, code: e.target.value.toUpperCase() })} className="w-28" />
          <TextField label="Name" value={newCur.name} onChange={(e) => setNewCur({ ...newCur, name: e.target.value })} className="w-60" />
          <Button type="submit" variant="secondary"><Plus /> Add currency</Button>
        </form>
      </Section>
      <Section title="Exchange rates">
        <DataTable caption="Exchange rates" rows={rates} rowKey={(r) => r.id} columns={[{ key: "c", header: "Currency", cell: (r) => r.currency }, { key: "r", header: "Rate", cell: (r) => formatRate(r.rate, r.currency, db.config.reportingCurrency) }, { key: "d", header: "Effective from", cell: (r) => formatDate(r.effectiveDate) }, { key: "s", header: "Source", cell: (r) => <span className="flex items-center gap-2">{r.source} {r.isDemo ? null : <StatusBadge tone="approved">GMCA</StatusBadge>}</span> }]} />
        <form className="grid max-w-5xl gap-4 border border-line bg-surface p-5 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); run((d, a) => addExchangeRate(d, a, { currency: rate.currency, rate: Number.isFinite(stored) ? stored : 0, effectiveDate: rate.effectiveDate, source: rate.source }), "Rate added"); }}>
          <SelectField label="Currency" value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })}>
            {db.config.currencies.filter((c) => c.code !== db.config.reportingCurrency).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </SelectField>
          <SelectField label="Quote" value={rate.quote} onChange={(e) => setRate({ ...rate, quote: e.target.value as typeof rate.quote })}>
            <option value="PER_REPORTING">{rate.currency} per 1 {db.config.reportingCurrency}</option>
            <option value="PER_UNIT">{db.config.reportingCurrency} per 1 {rate.currency}</option>
          </SelectField>
          <TextField label="Rate" inputMode="decimal" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} hint={rate.quote === "PER_REPORTING" ? "For example 96.35" : "For example 0.75"} />
          <TextField label="Effective from" type="date" value={rate.effectiveDate} onChange={(e) => setRate({ ...rate, effectiveDate: e.target.value })} />
          <TextField label="Source label" value={rate.source} onChange={(e) => setRate({ ...rate, source: e.target.value })} />
          <div className="sm:col-span-5"><Button type="submit">Add rate</Button></div>
        </form>
        <p className="text-sm text-muted">Adding a rate updates drafts the next time they're saved. Submitted returns and declarations keep the rate they were filed with.</p>
      </Section>
    </>
  );
}

// ---------- Integrations ----------

const MODE_LABEL: Record<IntegrationMode, string> = { SEEDED: "Use seeded records", FORCE_NO_MATCH: "Always no match", FORCE_UNAVAILABLE: "Unavailable" };

export function IntegrationsPage() {
  useDocumentTitle("Integration settings");
  const db = useDb();
  const run = useRun();
  const toast = useToast();
  const i = db.config.integrations;
  const systems = [
    { key: "ndi" as const, name: "NDI", purpose: "Bhutanese identity verification", interface: "IdentityVerificationProvider → SeededNdiProvider" },
    { key: "immigration" as const, name: "Immigration System", purpose: "Foreign individuals and employment", interface: "ImmigrationVerificationProvider → SeededImmigrationProvider" },
    { key: "companyRegistry" as const, name: "Corporate Registration System", purpose: "Company registration and UEN", interface: "CompanyRegistryProvider → SeededCompanyRegistryProvider" }
  ];
  return (
    <>
      <PageHeader title="Integration settings" lead="Each external system sits behind an adapter. Choose how it answers to show success, no-match, unavailable, pending and failed outcomes." />
      <Section title="Verification services">
        <div className="grid gap-3">
          {systems.map((s) => (
            <div key={s.key} className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
              <div className="grid gap-0.5">
                <p className="flex items-center gap-2 font-medium">{s.name}</p>
                <p className="text-sm text-muted">{s.purpose}</p>
                <p className="num text-xs text-muted">{s.interface}</p>
              </div>
              <SelectField label="Behaviour" value={i[s.key]} onChange={(e) => run((d, a) => setIntegrationMode(d, a, s.key, e.target.value as IntegrationMode), `${s.name} simulator updated`)}>
                {(Object.keys(MODE_LABEL) as IntegrationMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </SelectField>
            </div>
          ))}
          <div className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_16rem_16rem] sm:items-end">
            <div className="grid gap-0.5">
              <p className="flex items-center gap-2 font-medium">DK Bank</p>
              <p className="text-sm text-muted">Payment initiation and confirmation</p>
              <p className="num text-xs text-muted">PaymentProvider → SeededDkBankProvider</p>
            </div>
            <SelectField label="Outcome" value={i.dkBank} onChange={(e) => run((d, a) => setBankMode(d, a, e.target.value as BankMode, i.pendingResolvesTo), "DK Bank simulator updated")}>
              <option value="CHOOSE">Payer chooses on the bank screen</option>
              <option value="SUCCESS">Always succeed</option>
              <option value="PENDING">Always pending</option>
              <option value="FAILURE">Always fail</option>
            </SelectField>
            <SelectField label="Pending payments resolve to" value={i.pendingResolvesTo} onChange={(e) => run((d, a) => setBankMode(d, a, i.dkBank, e.target.value as "SUCCESS" | "FAILURE"), "DK Bank simulator updated")}>
              <option value="SUCCESS">Success on recheck</option>
              <option value="FAILURE">Failure on recheck</option>
            </SelectField>
          </div>
        </div>
      </Section>
      <Section title="Seeded data">
        <div className="flex flex-wrap items-center justify-between gap-4 border border-line bg-surface p-5">
          <p className="max-w-xl text-sm text-muted">Restore every account, return, payment and setting to the seeded state. Data lives in this browser only. Seeded at {formatDateTime(db.seededAt)}.</p>
          <Button variant="danger" onClick={() => { if (window.confirm("Reset all data? Everything changed in this browser is lost and you'll be signed out.")) { resetDemoData(); toast("ok", "Data reset"); } }}>
            <RotateCcw /> Reset data
          </Button>
        </div>
      </Section>
      <Section title="Integration events" description="Identifiers are masked.">
        <DataTable caption="Integration events" rows={db.integrationEvents.slice(0, 60)} rowKey={(e) => e.id} minWidth="52rem" columns={[{ key: "t", header: "When", cell: (e) => <span className="text-xs">{formatDateTime(e.at)}</span> }, { key: "p", header: "System", cell: (e) => e.provider.replace("_", " ") }, { key: "o", header: "Operation", cell: (e) => <span className="num text-xs">{e.operation}</span> }, { key: "s", header: "Subject", cell: (e) => e.subject }, { key: "r", header: "Outcome", cell: (e) => e.outcome }, { key: "f", header: "Reference", cell: (e) => <span className="num text-xs">{e.reference}</span> }]} />
      </Section>
    </>
  );
}

// ---------- Audit log ----------

export function AuditPage() {
  useDocumentTitle("Audit log");
  const db = useDb();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ALL");
  const rows = db.audit.filter((e) => (role === "ALL" || e.actorRole === role) && (!q || `${e.actorName} ${e.action} ${e.summary}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHeader title="Audit log" lead="Submissions, assessment actions, payment changes, role changes and configuration changes. Entries can't be edited or deleted." />
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <SelectField label="Actor role" value={role} onChange={(e) => setRole(e.target.value)} className="w-64">
          <option value="ALL">All</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </SelectField>
      </div>
      <p className="text-sm text-muted" role="status">{rows.length} entries{rows.length > 300 ? ", showing the latest 300" : ""}</p>
      <AuditList db={db} entries={rows.slice(0, 300)} />
    </>
  );
}
