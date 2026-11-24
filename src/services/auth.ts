import { ServiceError } from "../domain/store";
import type { Db, User } from "../domain/types";

/**
 * Sign-in for this browser-only build: email and password, then, for individual taxpayers,
 * approval in the Bhutan NDI app. A password alone never opens an individual's tax records.
 * Every seeded account shares one sample password; a real deployment uses the GMC identity
 * service and a live NDI verifier session.
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

/** Individual taxpayers confirm every sign-in in the Bhutan NDI app. */
export const needsNdiApproval = (user: User) => user.role === "INDIVIDUAL";

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
