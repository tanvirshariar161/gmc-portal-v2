import { ArrowRight, Building2, CalendarClock, CheckCircle2, FileCheck2, Globe2, IdCard, MessageSquareText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, navigate, useDb, useDocumentTitle, useRunPublic, useSession } from "../../app/core";
import { Logo } from "../../app/Shell";
import { ServiceError } from "../../domain/store";
import type { User } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import type { ImmigrationRecord, LookupResult, NdiRecord, RegistryRecord } from "../../services/integrations";
import { checkNewContact, checkRepresentative, lookupCitizen, lookupCompany, lookupForeign, registerCitizen, registerCompany, registerForeign } from "../../services/registration";
import { Button } from "../../shared/gmc/Button";
import { Alert, Eyebrow, IconTile } from "../../shared/gmc/Layout";
import { DemoQr } from "../../shared/gmc/Qr";
import { checkCredentials, issueOtp, maskDestination, otpDestination, SAMPLE_PASSWORD, signInFactor, startNdiSignIn, verifyOtp } from "../../services/auth";
import type { NdiSignInRequest, OtpChallenge } from "../../services/auth";
import { RadioGroup, TextField } from "../../shared/gmc/Form";
import { Stepper } from "../../shared/gmc/Stepper";
import { KeyValue } from "../shared/ui";
import { DEMO_ACCOUNTS } from "./demoAccounts";

function PublicFrame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 bg-surface" style={{ borderBottomColor: "var(--nav-taxpayer)" }}>
        <div className="page py-4">
          <Link to="/login" aria-label="Sign in">
            <Logo dark={document.documentElement.classList.contains("dark")} />
          </Link>
        </div>
      </header>
      <main id="main" className={cn("page flex-1 pb-20 pt-10", wide ? "" : "max-w-3xl")}>
        {children}
      </main>
      <footer className="border-t border-line py-8 text-center text-sm text-muted">Gelephu Mindfulness City Authority · Income Tax</footer>
    </div>
  );
}

/** Second sign-in step: Bhutan NDI for citizens, a one-time code for foreign nationals and representatives. */
type Pending = { kind: "NDI"; user: User; request: NdiSignInRequest } | { kind: "OTP"; user: User };
type NdiPending = Extract<Pending, { kind: "NDI" }>;

/**
 * Sign-in layout under review: "V2" is the split screen (brand panel left, sign-in right), "V1" the
 * earlier single-column page. Remove the unused one once the choice is final.
 */
const SIGN_IN_LAYOUT: "V1" | "V2" = "V2";

/** Sign in with email and password, then confirm with Bhutan NDI (citizens) or a one-time code (foreign nationals, representatives). */
export function LoginPage() {
  useDocumentTitle("Sign in");
  const [pending, setPending] = useState<Pending | null>(null);
  const form =
    pending?.kind === "NDI" ? (
      <NdiApproval pending={pending} onCancel={() => setPending(null)} onRetry={(request) => setPending({ ...pending, request })} />
    ) : pending?.kind === "OTP" ? (
      <OtpSignIn user={pending.user} onCancel={() => setPending(null)} />
    ) : (
      <CredentialsForm onSecondStep={setPending} />
    );
  return SIGN_IN_LAYOUT === "V2" ? <SignInV2 form={form} /> : <SignInV1 form={form} />;
}

function SignInIntro({ onDark }: { onDark?: boolean }) {
  return (
    <>
      <Eyebrow tone={onDark ? "onGreen" : "brand"} className={onDark ? "text-[#fffbf2] [&>span]:bg-[#fffbf2]" : undefined}>GMCA Income Tax</Eyebrow>
      <h1 className={cn("display text-[2.5rem] sm:text-[3.5rem]", onDark && "text-white")}>Your income tax, in one place.</h1>
      <p className={cn("max-w-xl text-[15px] leading-relaxed", onDark ? "text-white/80" : "text-muted")}>
        File your return, see what your employer has reported, pay and get your notices from the Gelephu Mindfulness City Authority. Most of your return is filled in for you.
      </p>
      <ul className="grid gap-4 pt-2 sm:grid-cols-3">
        {[
          { icon: FileCheck2, text: "Returns pre-filled from employer declarations" },
          { icon: CalendarClock, text: "Every deadline with a countdown" },
          { icon: ShieldCheck, text: "Sign-in confirmed with Bhutan NDI or a one-time code" }
        ].map((item) => (
          <li key={item.text} className={cn("flex items-start gap-3 text-sm", onDark ? "text-white/85" : "text-fg-2")}>
            <IconTile icon={item.icon} size={28} tone={onDark ? "onGreen" : "brand"} />
            {item.text}
          </li>
        ))}
      </ul>
    </>
  );
}

/** V1: logo bar, intro on the left, sign-in panel on the right. */
function SignInV1({ form }: { form: ReactNode }) {
  return (
    <PublicFrame wide>
      <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
        <section className="grid gap-6 lg:pt-6">
          <SignInIntro />
        </section>
        {form}
      </div>
    </PublicFrame>
  );
}

/** V2: brand panel with the GMC pattern on the left, intro card at its foot; sign-in on a light panel to the right. */
function SignInV2({ form }: { form: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="relative isolate flex flex-col gap-12 overflow-hidden bg-[#772a35] px-6 py-10 sm:px-12 lg:px-[5.5%] lg:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[url('/bg-light.svg')] bg-cover bg-fixed bg-center opacity-[0.05]" />
        <img src="/logo1.svg" alt="Gelephu Mindfulness City" className="h-14 w-auto self-start sm:h-20" />
        <div className="my-auto grid max-w-[42rem] gap-5">
          <SignInIntro onDark />
        </div>
      </section>
      <main id="main" className="grid place-items-center bg-[#fdf9f3] px-4 py-12 sm:px-10 dark:bg-bg">
        <div className="w-full max-w-md [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 sm:[&>section]:p-0">{form}</div>
      </main>
    </div>
  );
}

function CredentialsForm({ onSecondStep }: { onSecondStep: (p: Pending) => void }) {
  const db = useDb();
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const accounts = DEMO_ACCOUNTS.map((a) => ({ label: a.label as string, user: db.users.find((u) => u.id === a.userId) })).filter((a): a is { label: string; user: User } => !!a.user && a.user.status === "ACTIVE");

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    let user: User;
    try {
      user = checkCredentials(db, email, password);
    } catch (err) {
      setError(err instanceof ServiceError ? err.message : "Sign-in failed. Try again.");
      return;
    }
    const factor = signInFactor(db, user);
    if (factor === "NDI") onSecondStep({ kind: "NDI", user, request: startNdiSignIn(db, user) });
    else if (factor === "OTP") onSecondStep({ kind: "OTP", user });
    else signIn(user.id);
  }

  return (
    <section aria-labelledby="signin" className="panel grid gap-5 p-6 sm:p-10">
      <h2 id="signin" className="font-serif text-[1.875rem] leading-tight">
        Sign in
      </h2>
      <p className="text-[15px] leading-relaxed text-muted">Use your GMC account. Bhutanese citizens then confirm in the Bhutan NDI app; foreign nationals and corporate tax payers enter a one-time code sent to their phone. A password alone can't open your tax records.</p>
      {error ? (
        <Alert tone="rejected" title="Couldn't sign you in">
          {error}
        </Alert>
      ) : null}
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <TextField label="Email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button size="lg" type="submit">
          Sign in <ArrowRight />
        </Button>
      </form>
      <p className="text-sm text-muted">
        New to the portal?{" "}
        <Link to="/register" className="font-medium text-brand-ink underline underline-offset-4">
          Register for a tax account
        </Link>
      </p>
      <details className="border-t border-line-soft pt-4 text-sm">
        <summary className="cursor-pointer font-medium">Sample accounts (password {SAMPLE_PASSWORD})</summary>
        <ul className="mt-3 grid gap-1.5">
          {accounts.map((a) => (
            <li key={a.user.id}>
              <button
                type="button"
                className="text-left text-brand-ink underline-offset-4 hover:underline"
                onClick={() => {
                  setEmail(a.user.email);
                  setPassword(SAMPLE_PASSWORD);
                  setError(undefined);
                }}
              >
                {a.user.name}
              </button>{" "}
              <span className="text-muted">· {a.label}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs leading-relaxed text-muted">Sessions end when you sign out. Tax information is confidential under section 6 of the Income Tax Act 2025.</p>
    </section>
  );
}

type NdiPhase = "WAITING" | "SCANNED" | "APPROVED";

/**
 * Second step for Bhutanese citizens: scan the code with the Bhutan NDI app and approve.
 * The simulated wallet scans after 1.4 seconds and approves 0.7 seconds later; the account
 * opens only once the approval arrives.
 */
const NDI_SCAN_MS = 1400;
const NDI_APPROVE_MS = 2100;
const NDI_SIGN_IN_MS = 2600;

function NdiApproval({ pending, onCancel, onRetry }: { pending: NdiPending; onCancel: () => void; onRetry: (r: NdiSignInRequest) => void }) {
  const db = useDb();
  const { signIn } = useSession();
  const { user, request } = pending;
  const [phase, setPhase] = useState<NdiPhase>("WAITING");
  const taxpayer = db.taxpayers.find((t) => t.id === user.taxpayerId);

  useEffect(() => {
    setPhase("WAITING");
    if (request.status === "UNAVAILABLE") return;
    const scan = window.setTimeout(() => setPhase("SCANNED"), NDI_SCAN_MS);
    if (request.status === "NO_MATCH") return () => window.clearTimeout(scan);
    const approve = window.setTimeout(() => setPhase("APPROVED"), NDI_APPROVE_MS);
    const done = window.setTimeout(() => signIn(user.id), NDI_SIGN_IN_MS);
    return () => [scan, approve, done].forEach((t) => window.clearTimeout(t));
  }, [request, user.id, signIn]);

  const declined = request.status === "NO_MATCH" && phase === "SCANNED";
  return (
    <section aria-labelledby="ndi" className="panel grid gap-6 p-6 sm:p-10">
      <div className="grid gap-2">
        <p className="text-sm text-muted">Step 2 of 2</p>
        <h2 id="ndi" className="font-serif text-[1.875rem] leading-tight">
          Approve this sign-in with Bhutan NDI
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Your password is right. To keep your income private, confirm it's you in the Bhutan NDI app on your phone.
        </p>
      </div>
      {request.status === "UNAVAILABLE" ? (
        <Alert tone="rejected" title="Bhutan NDI isn't answering" action={<Button size="sm" variant="secondary" onClick={() => onRetry(startNdiSignIn(db, user))}>Try again</Button>}>
          We couldn't create a sign-in request. Try again in a few minutes. Reference {request.reference}.
        </Alert>
      ) : (
        <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className={cn("relative grid w-fit place-items-center border border-line bg-surface p-3", phase !== "WAITING" && "opacity-40")}>
            <DemoQr seed={request.reference} className="size-48" label="Bhutan NDI sign-in code" />
            {phase === "APPROVED" ? <CheckCircle2 aria-hidden="true" className="absolute size-16 text-ok-fg" /> : null}
          </div>
          <ol className="grid gap-3 text-sm text-fg-2">
            {["Open the Bhutan NDI app on your phone.", "Tap Scan and point the camera at this code.", "Check the request is from GMCA Income Tax, then tap Approve."].map((t, i) => (
              <li key={t} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-medium text-brand-ink">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      )}
      {request.status !== "UNAVAILABLE" ? (
        <div role="status" aria-live="polite">
          {declined ? (
            <Alert tone="rejected" title="This NDI wallet doesn't match the account" action={<Button size="sm" variant="secondary" onClick={() => onRetry(startNdiSignIn(db, user))}>Show a new code</Button>}>
              The identity in the wallet that scanned the code isn't {user.name}. Nobody has been signed in.
            </Alert>
          ) : phase === "APPROVED" ? (
            <Alert tone="approved" title="Approved in Bhutan NDI">Signing you in…</Alert>
          ) : (
            <p className="flex items-center gap-3 border border-line bg-sunk px-4 py-3 text-sm">
              <span className="spinner text-brand-ink" aria-hidden="true" />
              {phase === "SCANNED" ? "Code scanned. Approve the request on your phone." : "Waiting for you to scan the code…"}
            </p>
          )}
        </div>
      ) : null}
      <div className="grid gap-1 border-t border-line-soft pt-4 text-sm">
        <p>
          Signing in as <span className="font-medium">{user.name}</span>
          {taxpayer ? <span className="text-muted"> · {taxpayer.tin}</span> : null}
        </p>
        <p className="text-xs text-muted">Request {request.reference}. The code works once and expires after 5 minutes.</p>
      </div>
      <div>
        <Button variant="secondary" onClick={onCancel}>
          Use a different account
        </Button>
      </div>
    </section>
  );
}

/** Second sign-in step for foreign nationals and company representatives, who have no NDI identity. */
function OtpSignIn({ user, onCancel }: { user: User; onCancel: () => void }) {
  const db = useDb();
  const { signIn } = useSession();
  return (
    <section aria-labelledby="otp" className="panel grid gap-6 p-6 sm:p-10">
      <div className="grid gap-2">
        <p className="text-sm text-muted">Step 2 of 2</p>
        <h2 id="otp" className="font-serif text-[1.875rem] leading-tight">
          Enter your one-time code
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">Your password is right. To keep your tax records private, confirm it's you with the code we sent to your phone.</p>
      </div>
      <OtpVerification destination={otpDestination(db, user)} submitLabel="Verify and sign in" onVerified={() => signIn(user.id)} />
      <div className="grid gap-1 border-t border-line-soft pt-4 text-sm">
        <p>
          Signing in as <span className="font-medium">{user.name}</span>
        </p>
      </div>
      <div>
        <Button variant="secondary" onClick={onCancel}>
          Use a different account
        </Button>
      </div>
    </section>
  );
}

const SMS_DELIVERY_MS = 1200;
const RESEND_AFTER_S = 30;

/**
 * One-time code check, shared by sign-in and sign-up. The SMS is simulated: the message appears on
 * the page a moment after the code is issued. Codes expire after 5 minutes and allow 3 tries.
 */
function OtpVerification({ destination, submitLabel, onVerified }: { destination: string; submitLabel: string; onVerified: () => void }) {
  const [challenge, setChallenge] = useState<OtpChallenge>(() => issueOtp(destination));
  const [delivered, setDelivered] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [wait, setWait] = useState(RESEND_AFTER_S);
  const locked = challenge.attemptsLeft <= 0;

  useEffect(() => {
    setDelivered(false);
    const t = window.setTimeout(() => setDelivered(true), SMS_DELIVERY_MS);
    return () => window.clearTimeout(t);
  }, [challenge.reference]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  function resend() {
    setChallenge(issueOtp(destination));
    setCode("");
    setError(undefined);
    setWait(RESEND_AFTER_S);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = verifyOtp(challenge, code);
    if (r.ok) return onVerified();
    setChallenge(r.challenge);
    setError(
      r.reason === "EMPTY"
        ? "Enter the 6-digit code."
        : r.reason === "EXPIRED"
          ? "This code has expired. Send a new code."
          : r.reason === "LOCKED"
            ? "Too many wrong codes. Send a new code to try again."
            : `That code isn't right. ${r.challenge.attemptsLeft} ${r.challenge.attemptsLeft === 1 ? "try" : "tries"} left.`
    );
  }

  return (
    <div className="grid gap-5">
      <p className="text-[15px]">
        We sent a 6-digit code by SMS to <span className="num font-medium">{maskDestination(destination)}</span>. It expires in 5 minutes.
      </p>
      <div role="status" aria-live="polite">
        {delivered ? (
          <div className="flex gap-3 border border-line bg-sunk px-4 py-3 text-sm">
            <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-ink" />
            <p className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.08em] text-muted">Simulated SMS · GMCA</span>
              <span>
                <span className="num font-medium">{challenge.code}</span> is your GMCA Income Tax verification code. It expires in 5 minutes. Don't share it.{" "}
                <button type="button" className="text-brand-ink underline underline-offset-4" onClick={() => { setCode(challenge.code); setError(undefined); }}>
                  Fill in
                </button>
              </span>
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-3 border border-line bg-sunk px-4 py-3 text-sm">
            <span className="spinner text-brand-ink" aria-hidden="true" />
            Sending the code…
          </p>
        )}
      </div>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <TextField
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="max-w-[12rem]"
          value={code}
          error={error}
          disabled={locked}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(undefined); }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={locked}>
            {submitLabel}
          </Button>
          <Button variant="ghost" disabled={wait > 0 && !locked} onClick={resend}>
            {wait > 0 && !locked ? `Send a new code in ${wait}s` : "Send a new code"}
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted">Reference {challenge.reference}.</p>
    </div>
  );
}

export function RegisterChooser() {
  useDocumentTitle("Register");
  const options = [
    { to: "/register/citizen", icon: IdCard, title: "Individual · Bhutanese citizen", body: "Verify with your Citizenship ID through NDI." },
    { to: "/register/foreign", icon: Globe2, title: "Individual · Foreign national", body: "Verify with your work permit or passport through the Immigration System, then confirm your phone with a one-time code." },
    { to: "/register/company", icon: Building2, title: "Company / Employer", body: "Look up your company or sole proprietorship by its registration number, then confirm the representative's phone with a one-time code." }
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

/** Sample record for trying registration: a quiet hint, not a banner. */
function SimulatedNotice({ samples }: { system: string; samples: ReactNode }) {
  return <p className="text-sm text-muted">Sample record: {samples}</p>;
}

function LookupFailure({ result, system }: { result: LookupResult<unknown>; system: string }) {
  if (result.status === "MATCH") return null;
  return (
    <Alert tone="rejected" title={result.status === "NO_MATCH" ? "No matching record" : `${system} is unavailable`}>
      {result.status === "NO_MATCH" ? `The ${system} has no record with these details. Check them and try again.` : "The service isn't answering. Try again later."} Reference {result.reference}.
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

/** Foreign nationals have no NDI identity, so their phone is confirmed with a one-time code instead. */
const FOREIGN_STEPS = [...STEPS, { key: "verify", label: "Verify phone" }];

type ContactDetails = { email: string; phone: string; address: string };

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
              <Button type="submit">Verify with NDI</Button>
            </div>
          </form>
        ) : null}
        {step === "confirm" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <Alert tone="approved" title="Identity verified with NDI">
              Reference {result.reference}. These details come from NDI and can't be edited here.
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
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const step = !result || result.status !== "MATCH" ? "identify" : !confirmed ? "confirm" : contact ? "verify" : "contact";
  return (
    <PublicFrame>
      <div className="grid gap-8">
        <div className="grid gap-3">
          <Link to="/register" className="w-fit text-sm text-muted hover:text-fg">
            ← Choose another account type
          </Link>
          <h1 className="display text-[2.25rem]">Register as a foreign national</h1>
        </div>
        <Stepper steps={FOREIGN_STEPS} current={step} />
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
              <Button type="submit">Verify with Immigration</Button>
            </div>
          </form>
        ) : null}
        {step === "confirm" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <Alert tone="approved" title="Identity and employment found in the Immigration System">
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
          <ContactStep initialEmail={contact?.email} busyLabel="Send verification code" onSubmit={(c) => { if (runPublic((d) => { checkNewContact(d, c); return true; })) setContact(c); }} />
        ) : null}
        {step === "verify" && result?.status === "MATCH" && contact ? (
          <div className="grid gap-5">
            <OtpVerification
              destination={contact.phone}
              submitLabel="Verify and create my tax account"
              onVerified={() => {
                const user = runPublic((d) => registerForeign(d, result.record, result.reference, contact));
                if (user) signIn(user.id);
              }}
            />
            <div>
              <Button variant="secondary" onClick={() => setContact(null)}>
                Change contact details
              </Button>
            </div>
          </div>
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
  const [repDone, setRepDone] = useState(false);
  const step = !result || result.status !== "MATCH" ? "identify" : !confirmed ? "confirm" : repDone ? "verify" : "contact";
  const already = result?.status === "MATCH" && db.companies.some((c) => c.uen === result.record.uen && c.representatives.length > 0);
  return (
    <PublicFrame>
      <div className="grid gap-8">
        <div className="grid gap-3">
          <Link to="/register" className="w-fit text-sm text-muted hover:text-fg">
            ← Choose another account type
          </Link>
          <h1 className="display text-[2.25rem]">Register a company or sole proprietorship</h1>
        </div>
        <Stepper steps={[{ key: "identify", label: "Find company" }, { key: "confirm", label: "Confirm details" }, { key: "contact", label: "Representative" }, { key: "verify", label: "Verify phone" }]} current={step} />
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
              <Button type="submit">Look up</Button>
            </div>
          </form>
        ) : null}
        {step === "confirm" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <Alert tone="approved" title="Company found in the Corporate Registry">
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
              if (runPublic((d) => { checkRepresentative(d, rep); return true; })) setRepDone(true);
            }}
          >
            <TextField label="Representative's full name" required autoComplete="name" value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} />
            <TextField label="Designation" required value={rep.designation} onChange={(e) => setRep({ ...rep, designation: e.target.value })} hint="For example Director or Finance Manager" />
            <TextField label="Work email" type="email" required autoComplete="email" value={rep.email} onChange={(e) => setRep({ ...rep, email: e.target.value })} />
            <TextField label="Phone" type="tel" required autoComplete="tel" value={rep.phone} onChange={(e) => setRep({ ...rep, phone: e.target.value })} />
            <div>
              <Button type="submit">Send verification code</Button>
            </div>
          </form>
        ) : null}
        {step === "verify" && result?.status === "MATCH" ? (
          <div className="grid gap-5">
            <OtpVerification
              destination={rep.phone}
              submitLabel="Verify and create company account"
              onVerified={() => {
                const user = runPublic((d) => registerCompany(d, result.record, result.reference, rep));
                if (user) signIn(user.id);
              }}
            />
            <div>
              <Button variant="secondary" onClick={() => setRepDone(false)}>
                Change representative details
              </Button>
            </div>
          </div>
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

