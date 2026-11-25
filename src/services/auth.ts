import { ServiceError } from "../domain/store";
import type { Db, User } from "../domain/types";

/**
 * Sign-in for this browser-only build: email and password, then a second step for taxpayers.
 * Bhutanese citizens approve in the Bhutan NDI app. Foreign nationals and company representatives
 * have no NDI identity, so they enter a one-time code sent by SMS (simulated). A password alone
 * never opens a taxpayer's records. Every seeded account shares one sample password; a real
 * deployment uses the GMC identity service, a live NDI verifier and an SMS gateway.
 */
export const SAMPLE_PASSWORD = "Gmca@2026";

export function checkCredentials(d: Db, email: string, password: string): User {
  const e = email.trim().toLowerCase();
  if (!e || !password) throw new ServiceError("Enter your email and password.");
  const user = d.users.find((u) => u.email.toLowerCase() === e);
  if (!user || password !== SAMPLE_PASSWORD) throw new ServiceError("The email or password is not right. Check them and try again.");
  if (user.status !== "ACTIVE") throw new ServiceError("This account is deactivated. Contact GMCA to reactivate it.");
  return user;
}

export type SignInFactor = "NDI" | "OTP" | null;

/** The second step a sign-in needs: NDI for citizens, a one-time code for foreign nationals and representatives. */
export function signInFactor(d: Db, user: User): SignInFactor {
  if (user.role === "EMPLOYER") return "OTP";
  if (user.role !== "INDIVIDUAL") return null;
  return d.taxpayers.find((t) => t.id === user.taxpayerId)?.category === "CITIZEN" ? "NDI" : "OTP";
}

/** Where the one-time code goes: the mobile number on the taxpayer or representative record. */
export function otpDestination(d: Db, user: User): string {
  const taxpayer = d.taxpayers.find((t) => t.id === user.taxpayerId);
  if (taxpayer?.phone) return taxpayer.phone;
  const rep = d.companies.find((c) => c.id === user.companyId)?.representatives.find((r) => r.email.toLowerCase() === user.email.toLowerCase());
  return rep?.phone || user.email;
}

/** Shows only the last three digits of a number, or the first letter of an email's name. */
export function maskDestination(destination: string) {
  if (destination.includes("@")) {
    const [name, domain] = destination.split("@");
    return `${name!.slice(0, 1)}•••@${domain}`;
  }
  const digits = destination.replace(/\D/g, "");
  return `•••• ${digits.slice(-3)}`;
}

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_ATTEMPTS = 3;

export type OtpChallenge = { reference: string; destination: string; code: string; expiresAt: number; attemptsLeft: number };

/** Issues a 6-digit one-time code. The simulated SMS shows it on screen; nothing is sent. */
export function issueOtp(destination: string, now = Date.now()): OtpChallenge {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  const code = String(n[0]! % 1_000_000).padStart(6, "0");
  return { reference: `OTP-${now.toString(36).toUpperCase()}`, destination, code, expiresAt: now + OTP_TTL_MS, attemptsLeft: OTP_ATTEMPTS };
}

export type OtpResult = { ok: true } | { ok: false; reason: "EMPTY" | "WRONG" | "EXPIRED" | "LOCKED"; challenge: OtpChallenge };

/** Checks a code. Three wrong tries, or five minutes, and a new code is needed. */
export function verifyOtp(challenge: OtpChallenge, input: string, now = Date.now()): OtpResult {
  if (challenge.attemptsLeft <= 0) return { ok: false, reason: "LOCKED", challenge };
  if (now > challenge.expiresAt) return { ok: false, reason: "EXPIRED", challenge };
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "EMPTY", challenge };
  if (code === challenge.code) return { ok: true };
  const next = { ...challenge, attemptsLeft: challenge.attemptsLeft - 1 };
  return { ok: false, reason: next.attemptsLeft <= 0 ? "LOCKED" : "WRONG", challenge: next };
}

export type NdiSignInRequest =
  | { status: "WAITING"; reference: string }
  | { status: "UNAVAILABLE"; reference: string }
  | { status: "NO_MATCH"; reference: string };

/** Starts an NDI proof request for the account. The simulator follows the NDI mode set by an administrator. */
export function startNdiSignIn(d: Db, user: User): NdiSignInRequest {
  const reference = `NDI-LOGIN-${Date.now().toString(36).toUpperCase()}`;
  const mode = d.config.integrations.ndi;
  if (mode === "FORCE_UNAVAILABLE") return { status: "UNAVAILABLE", reference };
  if (mode === "FORCE_NO_MATCH" || !user.taxpayerId) return { status: "NO_MATCH", reference };
  return { status: "WAITING", reference };
}
