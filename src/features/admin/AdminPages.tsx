import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useActor, useDb, useDocumentTitle, useRun, useToast } from "../../app/core";
import { PERMISSIONS, ROLE_LABEL, ROLE_PERMISSIONS } from "../../domain/permissions";
import { resetDemoData } from "../../domain/store";
import type { Band, BankMode, Db, IncomeCategory, IntegrationMode, ReliefRule, ResidencyStatus, Role, TaxRuleSet } from "../../domain/types";
import { formatDate, formatDateTime } from "../../lib/format";
import { formatMoney, minorToInput, parseAmountInput } from "../../lib/money";
import { cn } from "../../lib/utils";
import { addCurrency, addExchangeRate, createStaffUser, publishRuleSet, recordIncentive, revokeIncentive, setBankMode, setCurrencyEnabled, setIntegrationMode, setPlatformSetting, setResidency, setStaffRole, setUserStatus } from "../../services/admin";
import { ruleSetForYear } from "../../services/calc";
import { today } from "../../services/clock";
import { Button } from "../../shared/gmc/Button";
import { Checkbox, SelectField, TextArea, TextField } from "../../shared/gmc/Form";
import { Alert, StatusBadge } from "../../shared/gmc/Layout";
import { DataTable } from "../../shared/gmc/Table";
import { TaxpayerDetail } from "../gmca/GmcaPages";
import { DemoTag, KeyValue, MetricStrip, PageHeader, Section, ownerName, userName } from "../shared/ui";

// ---------- Overview ----------

export function AdminOverview() {
  useDocumentTitle("Administration");
  const db = useDb();
  const active = ruleSetForYear(db.ruleSets, db.config.currentFilingYear);
  const lastConfig = db.audit.filter((e) => ["RULESET_PUBLISHED", "INCENTIVE_RECORDED", "EXCHANGE_RATE_ADDED", "SETTINGS_UPDATED", "INTEGRATION_MODE", "ROLE_CHANGED", "USER_CREATED"].includes(e.action)).slice(0, 6);
  const forced = Object.entries(db.config.integrations).filter(([k, v]) => k !== "pendingResolvesTo" && v !== "SEEDED" && v !== "CHOOSE");
  return (
    <>
      <PageHeader title="System administration" lead="Accounts, tax configuration and demo settings. Administrators don't assess returns and can't change a submitted declaration." />
      {forced.length ? <Alert tone="action" title="A simulator is not in its default mode">{forced.map(([k, v]) => `${k}: ${String(v).toLowerCase().replace(/_/g, " ")}`).join(" · ")}. <Link className="underline" to="/admin/integrations">Change</Link></Alert> : null}
      <MetricStrip
        items={[
          { label: "User accounts", value: db.users.length, hint: `${db.users.filter((u) => u.status === "DEACTIVATED").length} deactivated` },
          { label: "GMCA officers", value: db.users.filter((u) => u.role === "ASSESSOR").length },
          { label: "Active rule set", value: active.version, hint: <DemoTag>Demo rules</DemoTag> },
          { label: "Reporting currency", value: db.config.reportingCurrency, hint: `${db.config.currencies.filter((c) => c.enabled).length} currencies enabled` }
        ]}
      />
      <Section title="Recent configuration changes" actions={<Link to="/admin/audit" className="text-sm text-brand-ink underline-offset-4 hover:underline">Full audit log</Link>}>
        <AuditList db={db} entries={lastConfig} />
      </Section>
      <Section title="Open questions for GMCA" description="These rules are placeholders in this prototype. Each is configurable so the confirmed answer can be entered without code changes.">
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
  const [form, setForm] = useState({ name: "", email: "", role: "ASSESSOR" as "ASSESSOR" | "ADMIN", title: "" });
  const users = db.users.filter((u) => role === "ALL" || u.role === role);
  return (
    <>
      <PageHeader title="Users & roles" lead="Create officer accounts, change staff roles and deactivate accounts. Taxpayer and employer accounts come from registration." />
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
                (u.role === "ASSESSOR" || u.role === "ADMIN") && u.id !== actor.id ? (
                  <select aria-label={`Role for ${u.name}`} className="control h-8 w-56 text-sm" value={u.role} onChange={(e) => run((d, a) => setStaffRole(d, a, u.id, e.target.value as "ASSESSOR" | "ADMIN"), "Role changed")}>
                    <option value="ASSESSOR">{ROLE_LABEL.ASSESSOR}</option>
                    <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
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
      <Section title="Create an officer account">
        <form
          className="grid max-w-3xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (run((d, a) => createStaffUser(d, a, form), "Account created")) setForm({ name: "", email: "", role: "ASSESSOR", title: "" });
          }}
        >
          <TextField label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "ASSESSOR" | "ADMIN" })}>
            <option value="ASSESSOR">{ROLE_LABEL.ASSESSOR}</option>
            <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
          </SelectField>
          <TextField label="Job title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="sm:col-span-2">
            <Button type="submit"><Plus /> Create account</Button>
          </div>
        </form>
      </Section>
      <Section title="Role permissions" description="Proposed for the prototype. GMCA's permission matrix is an open question. Record-level rules also apply: taxpayers see only their own records, assessors act only on cases assigned to them.">
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Permissions by role</caption>
            <thead>
              <tr className="bg-primary text-white">
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

// ---------- Taxpayer detail with residency ----------

export function AdminTaxpayerDetail({ kind, id }: { kind: string; id: string }) {
  const db = useDb();
  const run = useRun();
  const t = kind === "INDIVIDUAL" ? db.taxpayers.find((x) => x.id === id) : undefined;
  const [status, setStatus] = useState<ResidencyStatus>(t?.residencyStatus ?? "NOT_DETERMINED");
  const [reason, setReason] = useState("");
  const slot = t ? (
    <Section title="Tax residency" description="Recorded by GMCA. It decides whether the configured non-resident treatment applies. Nationality alone must not be used.">
      <form
        className="grid max-w-2xl gap-4 border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (run((d, a) => setResidency(d, a, t.id, status, reason), "Residency recorded") !== undefined) setReason("");
        }}
      >
        <SelectField label="Residency status" value={status} onChange={(e) => setStatus(e.target.value as ResidencyStatus)}>
          <option value="NOT_DETERMINED">Not determined</option>
          <option value="RESIDENT">Resident</option>
          <option value="NON_RESIDENT">Non-resident</option>
        </SelectField>
        <TextArea label="Basis for the determination" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded in the audit log. GMCA's residency rules are still to be confirmed." />
        <div><Button type="submit">Record residency</Button></div>
      </form>
    </Section>
  ) : (
    <span />
  );
  return <TaxpayerDetail kind={kind} id={id} adminSlot={slot} />;
}

// ---------- Tax configuration ----------

function BandsEditor({ label, bands, onChange }: { label: string; bands: Band[]; onChange: (b: Band[]) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_7rem_auto] items-end gap-2">
          <TextField label={i === 0 ? "From" : <span className="sr-only">From</span>} value={minorToInput(b.fromMinor)} readOnly />
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
          const split = last.fromMinor + 1_000_000;
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
  const active = ruleSetForYear(db.ruleSets, year);
  return (
    <>
      <PageHeader title="Tax configuration" lead="Rates and rules used by the calculation engine. Publishing creates a new version; submitted returns keep the version they were calculated with." />
      <Alert tone="action" title="Demo configuration">These values make the prototype work. They are not confirmed GMCA rules.</Alert>
      <SelectField label="Rules for financial year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-56">
        {[...new Set(db.ruleSets.map((r) => r.effectiveFromYear))].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
      </SelectField>
      <RuleSetEditor key={active.id} db={db} base={active} sections={["rates"]} />
      <PlatformSettings db={db} />
      <Section title="Version history">
        <DataTable caption="Rule set versions" rows={db.ruleSets.filter((r) => r.effectiveFromYear === year)} rowKey={(r) => r.id} columns={[{ key: "v", header: "Version", cell: (r) => r.version }, { key: "s", header: "Status", cell: (r) => <StatusBadge tone={r.status === "ACTIVE" ? "approved" : "neutral"}>{r.status === "ACTIVE" ? "Active" : "Retired"}</StatusBadge> }, { key: "b", header: "Published by", cell: (r) => userName(db, r.createdBy) }, { key: "d", header: "Published", cell: (r) => formatDateTime(r.createdAt) }, { key: "u", header: "Used by", align: "right", cell: (r) => `${db.individualReturns.filter((x) => x.calculation?.ruleSetId === r.id && x.submissionStatus === "SUBMITTED").length + db.corporateReturns.filter((x) => x.calculation?.ruleSetId === r.id && x.submissionStatus === "SUBMITTED").length} returns` }]} />
      </Section>
    </>
  );
}

function RuleSetEditor({ db, base, sections }: { db: Db; base: TaxRuleSet; sections: ("rates" | "reliefs")[] }) {
  const run = useRun();
  const [draft, setDraft] = useState<TaxRuleSet>(() => structuredClone(base));
  const [reason, setReason] = useState("");
  const set = (patch: Partial<TaxRuleSet>) => setDraft({ ...draft, ...patch });
  const changed = JSON.stringify(draft) !== JSON.stringify(base);
  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const { id: _i, version: _v, createdAt: _c, createdBy: _b, status: _s, ...changes } = draft;
        if (run((d, a) => publishRuleSet(d, a, base.id, changes, reason), "New rule set version published")) setReason("");
      }}
    >
      <p className="text-sm text-muted">Editing from version <strong>{base.version}</strong>.</p>
      {sections.includes("rates") ? (
        <>
          <Section title="Individual income tax">
            <div className="grid gap-6 border border-line bg-surface p-5 lg:grid-cols-2">
              <BandsEditor label={`Annual bands (${db.config.reportingCurrency})`} bands={draft.individualBands} onChange={(b) => set({ individualBands: b })} />
              <div className="grid content-start gap-4">
                <TextField label="Non-resident flat rate %" inputMode="decimal" value={draft.nonResidentRatePct === null ? "" : String(draft.nonResidentRatePct)} placeholder="Not configured" onChange={(e) => set({ nonResidentRatePct: e.target.value === "" ? null : Number(e.target.value) })} hint="Applied only to taxpayers GMCA has recorded as non-resident. The minutes mention 0% in the discussed context; eligibility must be confirmed." />
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
            <div className="grid max-w-md gap-4 border border-line bg-surface p-5">
              <TextField label="Standard corporate rate %" inputMode="decimal" value={String(draft.corporateRatePct)} onChange={(e) => set({ corporateRatePct: Number(e.target.value) || 0 })} hint="15% was discussed in the minutes. Approved company incentives override it for their effective period." />
            </div>
          </Section>
        </>
      ) : null}
      {sections.includes("reliefs") ? <ReliefEditor reliefs={draft.reliefs} categories={draft.incomeCategories} onReliefs={(r) => set({ reliefs: r })} onCategories={(c) => set({ incomeCategories: c })} currency={db.config.reportingCurrency} /> : null}
      <div className="grid max-w-2xl gap-3 border border-primary bg-surface p-5">
        <TextArea label="Reason for the change" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="Saved in the audit log with the new version." />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!changed}>Publish new version</Button>
          <Button variant="secondary" disabled={!changed} onClick={() => setDraft(structuredClone(base))}><RotateCcw /> Discard changes</Button>
        </div>
      </div>
    </form>
  );
}

function ReliefEditor({ reliefs, categories, onReliefs, onCategories, currency }: { reliefs: ReliefRule[]; categories: IncomeCategory[]; onReliefs: (r: ReliefRule[]) => void; onCategories: (c: IncomeCategory[]) => void; currency: string }) {
  const upd = (i: number, patch: Partial<ReliefRule>) => onReliefs(reliefs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <Section title="Reliefs and deductions" actions={<Button size="sm" variant="secondary" onClick={() => onReliefs([...reliefs, { key: `RELIEF_${reliefs.length + 1}`, label: "", description: "", capMinor: null, evidenceExamples: [], enabled: true }])}><Plus /> Add relief</Button>}>
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
      <Section title="Income categories" description="Shown to taxpayers when they add an additional income source, with a default taxable or exempt treatment. Not a statutory list." actions={<Button size="sm" variant="secondary" onClick={() => onCategories([...categories, { key: `CAT_${categories.length + 1}`, label: "", defaultClassification: "TAXABLE" }])}><Plus /> Add category</Button>}>
        <div className="grid gap-2 border border-line bg-surface p-5">
          {categories.map((c, i) => (
            <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_12rem] items-end gap-3">
              <TextField label={i === 0 ? "Category" : <span className="sr-only">Category</span>} value={c.label} onChange={(e) => onCategories(categories.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <SelectField label={i === 0 ? "Default treatment" : <span className="sr-only">Default treatment</span>} value={c.defaultClassification} onChange={(e) => onCategories(categories.map((x, j) => (j === i ? { ...x, defaultClassification: e.target.value as "TAXABLE" | "EXEMPT" } : x)))}>
                <option value="TAXABLE">Taxable</option>
                <option value="EXEMPT">Exempt</option>
              </SelectField>
            </div>
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
      <PageHeader title="Relief configuration" lead="Relief categories, demo limits and evidence examples, plus the income categories taxpayers choose from. Changes publish a new rule set version." />
      <SelectField label="Rules for financial year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-56">
        {[...new Set(db.ruleSets.map((r) => r.effectiveFromYear))].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
      </SelectField>
      <RuleSetEditor key={active.id} db={db} base={active} sections={["reliefs"]} />
    </>
  );
}

function PlatformSettings({ db }: { db: Db }) {
  const run = useRun();
  const [s, setS] = useState({ currentFilingYear: db.config.currentFilingYear, currentPayrollPeriod: db.config.currentPayrollPeriod, informationRequestDays: db.config.informationRequestDays, conversionDateRule: db.config.conversionDateRule });
  return (
    <Section title="Filing settings" description="Deadlines are not configured: GMCA sets them by notice and they are an open question.">
      <form className="grid max-w-3xl gap-4 border border-line bg-surface p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run((d, a) => setPlatformSetting(d, a, s), "Settings saved"); }}>
        <TextField label="Open individual filing year" type="number" value={String(s.currentFilingYear)} onChange={(e) => setS({ ...s, currentFilingYear: Number(e.target.value) })} />
        <TextField label="Current payroll month" type="month" value={s.currentPayrollPeriod} onChange={(e) => setS({ ...s, currentPayrollPeriod: e.target.value })} />
        <TextField label="Default days to answer an information request" type="number" value={String(s.informationRequestDays)} onChange={(e) => setS({ ...s, informationRequestDays: Number(e.target.value) })} />
        <SelectField label="Currency conversion date" value={s.conversionDateRule} onChange={(e) => setS({ ...s, conversionDateRule: e.target.value as typeof s.conversionDateRule })}>
          <option value="PERIOD_END">End of the income or payroll period</option>
          <option value="FILING_DATE">Date of filing</option>
        </SelectField>
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
      <PageHeader title="Company incentives" lead="Record a company-specific rate GMCA has already approved outside the platform. The engine applies it to corporate tax in its effective period. Companies can't apply here." />
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
  const [rate, setRate] = useState({ currency: db.config.currencies.find((c) => c.code !== db.config.reportingCurrency)?.code ?? "", rate: "", effectiveDate: today(), source: "Demo rate" });
  const rates = [...db.config.exchangeRates].sort((a, b) => a.currency.localeCompare(b.currency) || b.effectiveDate.localeCompare(a.effectiveDate));
  return (
    <>
      <PageHeader title="Currency & exchange rates" lead={`Every amount keeps its original currency and is converted to the reporting currency (${db.config.reportingCurrency}) with the latest rate on or before the conversion date.`} />
      <Alert tone="action" title="Demo rates only">The rates below are illustrative. They are not official, live or GMCA-approved. The reporting currency, rate source, conversion date and rounding still need GMCA confirmation.</Alert>
      <Section title="Currencies">
        <DataTable
          caption="Currencies"
          rows={db.config.currencies}
          rowKey={(c) => c.code}
          columns={[
            { key: "c", header: "Code", cell: (c) => <span className="num font-medium">{c.code}</span> },
            { key: "n", header: "Name", cell: (c) => c.name },
            { key: "r", header: "Latest rate", cell: (c) => (c.code === db.config.reportingCurrency ? "Reporting currency" : (() => { const r = rates.find((x) => x.currency === c.code); return r ? `${r.rate} from ${formatDate(r.effectiveDate, "short")}` : <span className="text-act-fg">No rate: conversion pending</span>; })()) },
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
        <DataTable caption="Exchange rates" rows={rates} rowKey={(r) => r.id} columns={[{ key: "c", header: "Currency", cell: (r) => r.currency }, { key: "r", header: `${db.config.reportingCurrency} per unit`, align: "right", cell: (r) => r.rate }, { key: "d", header: "Effective from", cell: (r) => formatDate(r.effectiveDate) }, { key: "s", header: "Source", cell: (r) => <span className="flex items-center gap-2">{r.source} {r.isDemo ? <DemoTag>Demo rate</DemoTag> : null}</span> }]} />
        <form className="grid max-w-3xl gap-4 border border-line bg-surface p-5 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run((d, a) => addExchangeRate(d, a, { currency: rate.currency, rate: Number(rate.rate), effectiveDate: rate.effectiveDate, source: rate.source }), "Rate added"); }}>
          <SelectField label="Currency" value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })}>
            {db.config.currencies.filter((c) => c.code !== db.config.reportingCurrency).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </SelectField>
          <TextField label={`${db.config.reportingCurrency} per unit`} inputMode="decimal" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} />
          <TextField label="Effective from" type="date" value={rate.effectiveDate} onChange={(e) => setRate({ ...rate, effectiveDate: e.target.value })} />
          <TextField label="Source label" value={rate.source} onChange={(e) => setRate({ ...rate, source: e.target.value })} />
          <div className="sm:col-span-4"><Button type="submit">Add demo rate</Button></div>
        </form>
        <p className="text-sm text-muted">Adding a rate updates drafts the next time they're saved. Submitted returns and declarations keep the rate they were filed with.</p>
      </Section>
    </>
  );
}

// ---------- Integrations ----------

const MODE_LABEL: Record<IntegrationMode, string> = { SEEDED: "Use seeded records", FORCE_NO_MATCH: "Always no match", FORCE_UNAVAILABLE: "Unavailable" };

export function IntegrationsPage() {
  useDocumentTitle("Integration demo settings");
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
      <PageHeader title="Integration demo settings" lead="All external systems are simulated behind adapter interfaces. Change how each simulator answers to demonstrate success, no-match, unavailable, pending and failed outcomes." />
      <Section title="Verification simulators">
        <div className="grid gap-3">
          {systems.map((s) => (
            <div key={s.key} className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
              <div className="grid gap-0.5">
                <p className="flex items-center gap-2 font-medium">{s.name} <DemoTag>Simulated</DemoTag></p>
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
              <p className="flex items-center gap-2 font-medium">DK Bank <DemoTag>Simulated</DemoTag></p>
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
          <p className="max-w-xl text-sm text-muted">Restore every account, return, payment and setting to the seeded demo state. Data lives in this browser only. Seeded at {formatDateTime(db.seededAt)}.</p>
          <Button variant="danger" onClick={() => { if (window.confirm("Reset all demo data? Everything changed in this browser is lost and you'll be signed out.")) { resetDemoData(); toast("ok", "Demo data reset"); } }}>
            <RotateCcw /> Reset demo data
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

// ---------- Monitoring ----------

export function MonitoringPage() {
  useDocumentTitle("System monitoring");
  const db = useDb();
  let bytes = 0;
  try {
    bytes = (localStorage.getItem("gmca-v2:db") ?? "").length * 2;
  } catch {
    /* unavailable */
  }
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recent = db.audit.filter((e) => e.at >= since);
  const byAction = Object.entries(recent.reduce<Record<string, number>>((m, e) => ({ ...m, [e.action]: (m[e.action] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const failed = db.integrationEvents.filter((e) => ["NO_MATCH", "UNAVAILABLE", "FAILURE"].includes(e.outcome)).length;
  return (
    <>
      <PageHeader title="System monitoring" lead="Activity in this demo environment. Production monitoring depends on the hosting decision (on-premises in Bhutan, TashiCell Gelephu preferred)." />
      <MetricStrip
        items={[
          { label: "Actions in the last 7 days", value: recent.length },
          { label: "Integration calls", value: db.integrationEvents.length, hint: `${failed} no-match, unavailable or failed` },
          { label: "Documents stored", value: db.documents.length },
          { label: "Browser storage used", value: `${(bytes / 1024 / 1024).toFixed(2)} MB`, hint: "Of about 5 MB available" }
        ]}
      />
      <Section title="Most frequent actions this week">
        <div className="grid gap-2 border border-line bg-surface p-5">
          {byAction.length === 0 ? <p className="text-sm text-muted">No activity in the last 7 days.</p> : null}
          {byAction.map(([action, n]) => (
            <div key={action} className="grid grid-cols-[14rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="num truncate text-xs">{action}</span>
              <span className="h-2 bg-sunk"><span className="block h-full bg-primary" style={{ width: `${(n / byAction[0]![1]) * 100}%` }} /></span>
              <span className="num text-right">{n}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Recent sign-ins">
        <DataTable caption="Sign-ins" rows={db.users.filter((u) => u.lastSignInAt).sort((a, b) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? "")).slice(0, 10)} rowKey={(u) => u.id} columns={[{ key: "n", header: "User", cell: (u) => u.name }, { key: "r", header: "Role", cell: (u) => ROLE_LABEL[u.role] }, { key: "t", header: "Last sign-in", cell: (u) => formatDateTime(u.lastSignInAt) }]} />
      </Section>
      <p className="text-sm text-muted">Outstanding liabilities: {formatMoney(db.liabilities.reduce((s, l) => s + Math.max(0, l.amountMinor - l.paidMinor), 0))}.</p>
    </>
  );
}
