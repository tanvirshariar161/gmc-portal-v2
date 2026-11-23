import { ArrowRight, Building2, FlaskConical, Globe2, IdCard } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, navigate, useDb, useDocumentTitle, useRunPublic, useSession } from "../../app/core";
import { Logo } from "../../app/Shell";
import { ROLE_LABEL } from "../../domain/permissions";
import { resetDemoData } from "../../domain/store";
import { formatDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import type { ImmigrationRecord, LookupResult, NdiRecord, RegistryRecord } from "../../services/integrations";
import { lookupCitizen, lookupCompany, lookupForeign, registerCitizen, registerCompany, registerForeign } from "../../services/registration";
import { Button } from "../../shared/gmc/Button";
import { Alert } from "../../shared/gmc/Layout";
import { RadioGroup, TextField } from "../../shared/gmc/Form";
import { Stepper } from "../../shared/gmc/Stepper";
import { KeyValue } from "../shared/ui";
import { DEMO_ACCOUNTS } from "./demoAccounts";

function PublicFrame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-act-line bg-act-bg text-act-fg">
        <p className="page flex flex-wrap items-center gap-2 py-1.5 text-[13px]">
          <FlaskConical aria-hidden="true" className="size-3.5" /> <span className="font-medium">Demonstration prototype (v2).</span> Fictional data; all external systems are simulated.
        </p>
      </div>
      <header className="page py-5">
        <Link to="/login" aria-label="Sign in">
          <Logo dark={document.documentElement.classList.contains("dark")} />
        </Link>
      </header>
      <main id="main" className={cn("page flex-1 pb-20 pt-4", wide ? "" : "max-w-3xl")}>
        {children}
      </main>
    </div>
  );
}

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { signIn } = useSession();
  const db = useDb();
  const others = db.users.filter((u) => u.status === "ACTIVE" && !DEMO_ACCOUNTS.some((a) => a.userId === u.id));
  return (
    <PublicFrame wide>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-8">
          <div className="grid gap-3">
            <h1 className="display text-[2.25rem] sm:text-[3rem]">GMCA Income Tax</h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted">One platform for taxpayers, employers and GMCA officers. Choose a demo account to see the platform from that role. Each account opens its own dashboard and can only reach its own records.</p>
          </div>
          <ul className="grid gap-3" aria-label="Demo accounts">
            {DEMO_ACCOUNTS.map((a) => {
              const u = db.users.find((x) => x.id === a.userId);
              if (!u) return null;
              return (
                <li key={a.userId}>
                  <button type="button" onClick={() => signIn(u.id)} className="group grid w-full gap-1 border border-line bg-surface px-5 py-4 text-left transition-colors hover:border-brand-200 hover:bg-brand-50 sm:grid-cols-[12rem_1fr_auto] sm:items-center sm:gap-6">
                    <span className="grid">
                      <span className="font-medium text-fg">{a.label}</span>
                      <span className="text-sm text-muted">{u.name}</span>
                    </span>
                    <span className="text-sm text-fg-2">{a.story}</span>
                    <ArrowRight aria-hidden="true" className="hidden size-4 text-line transition group-hover:translate-x-0.5 group-hover:text-brand-ink sm:block" />
                  </button>
                </li>
              );
            })}
          </ul>
          {others.length ? (
            <details className="border border-line bg-surface px-5 py-3">
              <summary className="cursor-pointer text-sm font-medium">More seeded accounts ({others.length})</summary>
              <ul className="mt-3 grid gap-1">
                {others.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => signIn(u.id)} className="flex w-full items-center justify-between gap-4 px-2 py-2 text-left text-sm hover:bg-sunk">
                      <span>{u.name}</span>
                      <span className="text-muted">{ROLE_LABEL[u.role]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <aside className="grid content-start gap-4">
          <div className="grid gap-3 border border-line bg-surface p-5">
            <h2 className="font-serif text-xl">New to GMCA Income Tax?</h2>
            <p className="text-sm text-muted">Register as an individual taxpayer or a company. Identity is checked against simulated NDI, Immigration and Corporate Registry records.</p>
            <Button onClick={() => navigate("/register")}>Register</Button>
          </div>
          <div className="grid gap-2 border border-line bg-sunk p-5 text-sm text-muted">
            <p>
              <span className="font-medium text-fg">Demo sign-in.</span> Production sign-in (SSO, NDI login) is an open question for GMCA. Role switching exists only in this demo.
            </p>
            <button type="button" className="w-fit text-brand-ink underline underline-offset-4" onClick={() => window.confirm("Reset all demo data to the seeded state? Changes made in this browser are lost.") && resetDemoData()}>
              Reset demo data
            </button>
          </div>
        </aside>
      </div>
    </PublicFrame>
  );
}

export function RegisterChooser() {
  useDocumentTitle("Register");
  const options = [
    { to: "/register/citizen", icon: IdCard, title: "Individual · Bhutanese citizen", body: "Verify with your Citizenship ID through NDI." },
    { to: "/register/foreign", icon: Globe2, title: "Individual · Foreign national", body: "Verify with your work permit or passport through the Immigration System." },
    { to: "/register/company", icon: Building2, title: "Company / Employer", body: "Look up your company or sole proprietorship by its registration number." }
  ];
  return (
    <PublicFrame>
      <div className="grid gap-8">
        <div className="grid gap-3">
          <Link to="/login" className="w-fit text-sm text-muted hover:text-fg">
            ← Back to sign in
          </Link>
          <h1 className="display text-[2.25rem]">Register for a tax account</h1>
          <p className="text-[15px] text-muted">Choose who the account is for. You can't change this later.</p>
        </div>
        <ul className="grid gap-3">
          {options.map((o) => (
            <li key={o.to}>
              <Link to={o.to} className="group flex items-center gap-4 border border-line bg-surface px-5 py-4 transition-colors hover:border-brand-200 hover:bg-brand-50">
                <span className="grid size-10 shrink-0 place-items-center bg-brand-50 text-brand-ink">
                  <o.icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                </span>
                <span className="grid flex-1 gap-0.5">
                  <span className="font-medium text-fg">{o.title}</span>
                  <span className="text-sm text-muted">{o.body}</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 text-line group-hover:text-brand-ink" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PublicFrame>
  );
}

function SimulatedNotice({ system, samples }: { system: string; samples: ReactNode }) {
  return (
    <Alert tone="action" title={`Simulated ${system}`}>
      No real registry is contacted. Use a seeded demo record: {samples}
    </Alert>
  );
}

function LookupFailure({ result, system }: { result: LookupResult<unknown>; system: string }) {
  if (result.status === "MATCH") return null;
  return (
    <Alert tone="rejected" title={result.status === "NO_MATCH" ? "No matching record" : `${system} is unavailable`}>
      {result.status === "NO_MATCH" ? `The simulated ${system} has no record with these details. Check them and try again.` : "The simulator is set to unavailable by a GMCA administrator. Try again later."} Reference {result.reference}.
    </Alert>
  );
}

function ContactStep({ initialEmail, onSubmit, busyLabel }: { initialEmail?: string; onSubmit: (c: { email: string; phone: string; address: string }) => void; busyLabel: string }) {
  const [c, setC] = useState({ email: initialEmail ?? "", phone: "", address: "" });
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(c);
      }}
    >
      <TextField label="Email" type="email" autoComplete="email" required value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
      <TextField label="Mobile number" type="tel" autoComplete="tel" required value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} hint="For example +975 17 123 456" />
      <TextField label="Address in GMC" autoComplete="street-address" value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} />
      <div>
        <Button type="submit">{busyLabel}</Button>
      </div>
    </form>
  );
}

const STEPS = [
  { key: "identify", label: "Identify" },
  { key: "confirm", label: "Confirm details" },
  { key: "contact", label: "Contact details" }
];

export function RegisterCitizen() {
  useDocumentTitle("Register · Citizen");
  const runPublic = useRunPublic();
  const { signIn } = useSession();
  const [cid, setCid] = useState("");
  const [dob, setDob] = useState("");
  const [result, setResult] = useState<LookupResult<NdiRecord> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const step = !result || result.status !== "MATCH" ? "identify" : confirmed ? "contact" : "confirm";
  return (
    <PublicFrame>
      <div className="grid gap-8">
        <div className="grid gap-3">
          <Link to="/register" className="w-fit text-sm text-muted hover:text-fg">
            ← Choose another account type
          </Link>
          <h1 className="display text-[2.25rem]">Register as a Bhutanese citizen</h1>
        </div>
        <Stepper steps={STEPS} current={step} />
        {step === "identify" ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              const r = runPublic((d) => lookupCitizen(d, cid, dob));
              if (r) setResult(r);
            }}
          >
            <SimulatedNotice system="NDI" samples={<><strong>10000000004</strong> with date of birth <strong>18 June 1996</strong>.</>} />
            <TextField label="Citizenship ID" inputMode="numeric" required value={cid} onChange={(e) => setCid(e.target.value.replace(/\D/g, "").slice(0, 11))} hint="11 digits" />
            <TextField label="Date of birth" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} />
            {result ? <LookupFailure result={result} system="NDI" /> : null}
            <div>
              <Button type="submit">Verify with NDI (simulated)</Button>
            </div>
          </form>
        ) : null}
        {step === "confirm" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <Alert tone="approved" title="Identity verified (simulated NDI)">
              Reference {result.reference}. These details come from the demo record and can't be edited here.
            </Alert>
            <div className="panel p-5">
              <KeyValue rows={[{ label: "Full name", value: result.record.fullName }, { label: "Citizenship ID", value: result.record.cid }, { label: "Date of birth", value: formatDate(result.record.dateOfBirth) }, { label: "Dzongkhag", value: result.record.dzongkhag }]} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setConfirmed(true)}>These are my details</Button>
              <Button variant="secondary" onClick={() => setResult(null)}>
                Start again
              </Button>
            </div>
          </div>
        ) : null}
        {step === "contact" && result?.status === "MATCH" ? (
          <ContactStep
            busyLabel="Create my tax account"
            onSubmit={(c) => {
              const user = runPublic((d) => registerCitizen(d, result.record, result.reference, c));
              if (user) signIn(user.id);
            }}
          />
        ) : null}
      </div>
    </PublicFrame>
  );
}

export function RegisterForeign() {
  useDocumentTitle("Register · Foreign national");
  const runPublic = useRunPublic();
  const { signIn } = useSession();
  const [type, setType] = useState<"WORK_PERMIT" | "PASSPORT">("WORK_PERMIT");
  const [identifier, setIdentifier] = useState("");
  const [result, setResult] = useState<LookupResult<ImmigrationRecord> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const step = !result || result.status !== "MATCH" ? "identify" : confirmed ? "contact" : "confirm";
  return (
    <PublicFrame>
      <div className="grid gap-8">
        <div className="grid gap-3">
          <Link to="/register" className="w-fit text-sm text-muted hover:text-fg">
            ← Choose another account type
          </Link>
          <h1 className="display text-[2.25rem]">Register as a foreign national</h1>
        </div>
        <Stepper steps={STEPS} current={step} />
        {step === "identify" ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              const r = runPublic((d) => lookupForeign(d, type, identifier));
              if (r) setResult(r);
            }}
          >
            <SimulatedNotice system="Immigration System" samples={<>work permit <strong>WP-DEMO-2026-0003</strong> or passport <strong>DEMO-TH-5521</strong>.</>} />
            <RadioGroup legend="Identify with" name="idtype" value={type} onChange={(v) => setType(v)} options={[{ value: "WORK_PERMIT", label: "Work permit" }, { value: "PASSPORT", label: "Passport" }]} />
            <TextField label={type === "WORK_PERMIT" ? "Work permit number" : "Passport number"} required value={identifier} onChange={(e) => setIdentifier(e.target.value.toUpperCase())} />
            {result ? <LookupFailure result={result} system="Immigration System" /> : null}
            <div>
              <Button type="submit">Verify with Immigration (simulated)</Button>
            </div>
          </form>
        ) : null}
        {step === "confirm" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <Alert tone="approved" title="Identity and employment found (simulated Immigration System)">
              Reference {result.reference}.
            </Alert>
            <div className="panel p-5">
              <KeyValue
                rows={[
                  { label: "Full name", value: result.record.fullName },
                  { label: "Nationality", value: result.record.nationality },
                  { label: "Passport", value: result.record.passportNumber },
                  { label: "Work permit", value: result.record.permitNumber ?? "—" },
                  { label: "Permit valid until", value: formatDate(result.record.permitExpiry) },
                  { label: "Employer", value: result.record.employer ?? "—" },
                  { label: "Position", value: result.record.position ?? "—" },
                  { label: "Employed since", value: formatDate(result.record.employedSince) }
                ]}
              />
            </div>
            <Alert tone="review">Your tax residency is determined by GMCA. Your nationality alone doesn't change how you are taxed.</Alert>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setConfirmed(true)}>These are my details</Button>
              <Button variant="secondary" onClick={() => setResult(null)}>
                Start again
              </Button>
            </div>
          </div>
        ) : null}
        {step === "contact" && result?.status === "MATCH" ? (
          <ContactStep
            busyLabel="Create my tax account"
            onSubmit={(c) => {
              const user = runPublic((d) => registerForeign(d, result.record, result.reference, c));
              if (user) signIn(user.id);
            }}
          />
        ) : null}
      </div>
    </PublicFrame>
  );
}

export function RegisterCompany() {
  useDocumentTitle("Register · Company");
  const runPublic = useRunPublic();
  const { signIn } = useSession();
  const db = useDb();
  const [uen, setUen] = useState("");
  const [result, setResult] = useState<LookupResult<RegistryRecord> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [rep, setRep] = useState({ name: "", designation: "", email: "", phone: "" });
  const step = !result || result.status !== "MATCH" ? "identify" : confirmed ? "contact" : "confirm";
  const already = result?.status === "MATCH" && db.companies.some((c) => c.uen === result.record.uen);
  return (
    <PublicFrame>
      <div className="grid gap-8">
        <div className="grid gap-3">
          <Link to="/register" className="w-fit text-sm text-muted hover:text-fg">
            ← Choose another account type
          </Link>
          <h1 className="display text-[2.25rem]">Register a company or sole proprietorship</h1>
        </div>
        <Stepper steps={[{ key: "identify", label: "Find company" }, { key: "confirm", label: "Confirm details" }, { key: "contact", label: "Representative" }]} current={step} />
        {step === "identify" ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              const r = runPublic((d) => lookupCompany(d, uen));
              if (r) setResult(r);
            }}
          >
            <SimulatedNotice system="Corporate Registration System" samples={<>company <strong>GMC-UEN-2026-0003</strong> or sole proprietorship <strong>GMC-SP-2026-0004</strong>.</>} />
            <TextField label="UEN or sole proprietorship number" required value={uen} onChange={(e) => setUen(e.target.value.toUpperCase())} hint="Issued by the Corporate Registration Office. Validation rules for sole proprietorship numbers are still to be confirmed." />
            {result ? <LookupFailure result={result} system="Corporate Registration System" /> : null}
            <div>
              <Button type="submit">Look up (simulated)</Button>
            </div>
          </form>
        ) : null}
        {step === "confirm" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <Alert tone="approved" title="Company found (simulated registry)">
              Reference {result.reference}.
            </Alert>
            <div className="panel p-5">
              <KeyValue
                rows={[
                  { label: "Registered name", value: result.record.name },
                  { label: result.record.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship number" : "UEN", value: result.record.uen },
                  { label: "Account type", value: result.record.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company" },
                  { label: "Sector", value: result.record.sector },
                  { label: "Registered address", value: result.record.registeredAddress },
                  { label: "Incorporated", value: formatDate(result.record.incorporatedOn) },
                  { label: "Directors / owner", value: result.record.directors.join(", ") }
                ]}
              />
            </div>
            {already ? <Alert tone="action" title="Already registered">This company already has a tax account. Ask its representative to give you access, or sign in.</Alert> : null}
            <div className="flex flex-wrap gap-3">
              <Button disabled={already} onClick={() => setConfirmed(true)}>
                This is my company
              </Button>
              <Button variant="secondary" onClick={() => setResult(null)}>
                Start again
              </Button>
            </div>
          </div>
        ) : null}
        {step === "contact" && result?.status === "MATCH" ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              const user = runPublic((d) => registerCompany(d, result.record, result.reference, rep));
              if (user) signIn(user.id);
            }}
          >
            <TextField label="Representative's full name" required autoComplete="name" value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} />
            <TextField label="Designation" required value={rep.designation} onChange={(e) => setRep({ ...rep, designation: e.target.value })} hint="For example Director or Finance Manager" />
            <TextField label="Work email" type="email" required autoComplete="email" value={rep.email} onChange={(e) => setRep({ ...rep, email: e.target.value })} />
            <TextField label="Phone" type="tel" required autoComplete="tel" value={rep.phone} onChange={(e) => setRep({ ...rep, phone: e.target.value })} />
            <div>
              <Button type="submit">Create company account</Button>
            </div>
          </form>
        ) : null}
      </div>
    </PublicFrame>
  );
}

export function NotFound({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="grid justify-items-start gap-4 py-10">
      <h1 className="display text-[2rem]">Page not found</h1>
      <p className="text-muted">This page doesn't exist, or your role can't open it.</p>
      <Link to={signedIn ? "/" : "/login"} className="text-brand-ink underline underline-offset-4">
        Go to your overview
      </Link>
    </div>
  );
}

