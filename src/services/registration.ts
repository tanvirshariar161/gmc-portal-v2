import { maskId } from "../lib/format";
import { audit, nextId, nextReference, notify, ServiceError } from "../domain/store";
import type { Company, Db, IndividualTaxpayer, IntegrationEvent, Role, User } from "../domain/types";
import { nowIso } from "./clock";
import { providers, type ImmigrationRecord, type LookupResult, type NdiRecord, type RegistryRecord } from "./integrations";

export function logIntegration(d: Db, provider: IntegrationEvent["provider"], operation: string, subject: string, outcome: string, reference: string) {
  d.integrationEvents.unshift({ id: nextId(d, "INT"), at: nowIso(), provider, operation, subject: maskId(subject), outcome, reference });
}

function emailTaken(d: Db, email: string) {
  return d.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase());
}

function validateContact(c: { email: string; phone: string }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) throw new ServiceError("Enter a valid email address, like name@example.com.");
  if (!/^[+\d][\d\s-]{6,}$/.test(c.phone.trim())) throw new ServiceError("Enter a phone number with at least 7 digits.");
}

// ---------- Lookups (record an integration event, create nothing else) ----------

/**
 * Checks contact details before a one-time code is sent at sign-up, so a typo or an email that
 * already has an account shows up before the phone is verified, not after.
 */
export function checkNewContact(d: Db, contact: { email: string; phone: string }) {
  validateContact(contact);
  if (emailTaken(d, contact.email)) throw new ServiceError("This email address is already used by another account.", "CONFLICT");
}

export function checkRepresentative(d: Db, rep: { name: string; designation: string; email: string; phone: string }) {
  if (!rep.name.trim()) throw new ServiceError("Enter the representative's full name.");
  if (!rep.designation.trim()) throw new ServiceError("Enter the representative's designation.");
  checkNewContact(d, rep);
}

/** An organization GMCA imported that no representative has registered for yet. */
export function unclaimedImport(d: Db, uen: string) {
  const u = uen.trim().toUpperCase();
  return d.companies.find((c) => c.uen === u && c.importedBy && c.representatives.length === 0);
}

export function lookupCitizen(d: Db, cid: string, dateOfBirth: string): LookupResult<NdiRecord> {
  if (!/^\d{11}$/.test(cid.trim())) throw new ServiceError("A Citizenship ID has 11 digits.");
  if (!dateOfBirth) throw new ServiceError("Enter your date of birth.");
  const r = providers(d.config).ndi.verifyCitizen(cid, dateOfBirth);
  logIntegration(d, "NDI", "verifyCitizen", cid, r.status, r.reference);
  return r;
}

export function lookupForeign(d: Db, type: "WORK_PERMIT" | "PASSPORT", identifier: string): LookupResult<ImmigrationRecord> {
  if (!identifier.trim()) throw new ServiceError(type === "WORK_PERMIT" ? "Enter your work permit number." : "Enter your passport number.");
  const r = providers(d.config).immigration.verifyForeign(type, identifier);
  logIntegration(d, "IMMIGRATION", "verifyForeign", identifier, r.status, r.reference);
  return r;
}

export function lookupCompany(d: Db, uen: string): LookupResult<RegistryRecord> {
  if (!uen.trim()) throw new ServiceError("Enter the UEN or sole proprietorship number.");
  const r = providers(d.config).registry.lookupCompany(uen);
  logIntegration(d, "COMPANY_REGISTRY", "lookupCompany", uen, r.status, r.reference);
  // An organization GMCA imported is known even when the (simulated) registry has no record of it.
  const imported = r.status === "NO_MATCH" ? unclaimedImport(d, uen) : undefined;
  if (imported) {
    return {
      status: "MATCH",
      reference: `GMCA-IMPORT-${imported.id}`,
      record: { uen: imported.uen, name: imported.name, type: imported.type, sector: imported.sector, registeredAddress: imported.registeredAddress, incorporatedOn: imported.incorporatedOn, status: "LIVE", directors: [] }
    };
  }
  return r;
}

// ---------- Account creation ----------

type Contact = { email: string; phone: string; address: string };

function newIndividualUser(d: Db, t: IndividualTaxpayer): User {
  const user: User = { id: nextId(d, "USR"), name: t.fullName, email: t.email, role: "INDIVIDUAL", status: "ACTIVE", taxpayerId: t.id, createdAt: nowIso() };
  d.users.push(user);
  return user;
}

export function registerCitizen(d: Db, record: NdiRecord, reference: string, contact: Contact): User {
  validateContact(contact);
  if (d.taxpayers.some((t) => t.identifierValue === record.cid)) throw new ServiceError("A tax account already exists for this Citizenship ID. Sign in instead.", "CONFLICT");
  if (emailTaken(d, contact.email)) throw new ServiceError("This email address is already used by another account.", "CONFLICT");
  const t: IndividualTaxpayer = {
    id: nextId(d, "TP"),
    tin: nextReference(d, "TIN"),
    category: "CITIZEN",
    identifierType: "CID",
    identifierValue: record.cid,
    fullName: record.fullName,
    dateOfBirth: record.dateOfBirth,
    nationality: "Bhutanese",
    email: contact.email.trim(),
    phone: contact.phone.trim(),
    address: contact.address.trim(),
    residencyStatus: "NOT_DETERMINED",
    verification: { provider: "NDI", status: "VERIFIED", reference, checkedAt: nowIso(), simulated: true },
    registeredAt: nowIso()
  };
  d.taxpayers.push(t);
  for (const e of d.employees) if (e.identifierValue === t.identifierValue) e.taxpayerId = t.id;
  const user = newIndividualUser(d, t);
  audit(d, { id: user.id, name: user.name, role: "INDIVIDUAL" }, "TAXPAYER_REGISTERED", "IndividualTaxpayer", t.id, `Citizen taxpayer registered through simulated NDI (${maskId(t.identifierValue)})`);
  notify(d, { userId: user.id }, "Welcome to GMCA Income Tax", `Your Taxpayer Identification Number is ${t.tin}.`, "/profile");
  return user;
}

export function registerForeign(d: Db, record: ImmigrationRecord, reference: string, contact: Contact): User {
  validateContact(contact);
  const ids = [record.permitNumber, record.passportNumber].filter(Boolean) as string[];
  if (d.taxpayers.some((t) => ids.includes(t.identifierValue))) throw new ServiceError("A tax account already exists for this person. Sign in instead.", "CONFLICT");
  if (emailTaken(d, contact.email)) throw new ServiceError("This email address is already used by another account.", "CONFLICT");
  const t: IndividualTaxpayer = {
    id: nextId(d, "TP"),
    tin: nextReference(d, "TIN"),
    category: "FOREIGN",
    identifierType: record.identifierType,
    identifierValue: record.identifier,
    fullName: record.fullName,
    dateOfBirth: record.dateOfBirth,
    nationality: record.nationality,
    email: contact.email.trim(),
    phone: contact.phone.trim(),
    address: contact.address.trim(),
    residencyStatus: "NOT_DETERMINED",
    verification: { provider: "IMMIGRATION", status: "VERIFIED", reference, checkedAt: nowIso(), simulated: true },
    employmentSummary: record.employer ? { employer: record.employer, position: record.position ?? "", since: record.employedSince ?? "", permitExpiry: record.permitExpiry } : undefined,
    registeredAt: nowIso()
  };
  d.taxpayers.push(t);
  for (const e of d.employees) if (ids.includes(e.identifierValue)) e.taxpayerId = t.id;
  const user = newIndividualUser(d, t);
  audit(d, { id: user.id, name: user.name, role: "INDIVIDUAL" }, "TAXPAYER_REGISTERED", "IndividualTaxpayer", t.id, `Foreign taxpayer registered through simulated Immigration System (${maskId(t.identifierValue)})`);
  notify(d, { userId: user.id }, "Welcome to GMCA Income Tax", `Your Taxpayer Identification Number is ${t.tin}.`, "/profile");
  return user;
}

export function registerCompany(d: Db, record: RegistryRecord, reference: string, rep: { name: string; designation: string; email: string; phone: string }): User {
  validateContact(rep);
  if (!rep.name.trim()) throw new ServiceError("Enter the representative's full name.");
  if (!rep.designation.trim()) throw new ServiceError("Enter the representative's designation.");
  const imported = unclaimedImport(d, record.uen);
  if (!imported && d.companies.some((c) => c.uen === record.uen)) throw new ServiceError("This company already has a tax account. Ask its representative to add you.", "CONFLICT");
  if (emailTaken(d, rep.email)) throw new ServiceError("This email address is already used by another account.", "CONFLICT");
  const representative = { name: rep.name.trim(), designation: rep.designation.trim(), email: rep.email.trim(), phone: rep.phone.trim() };
  if (imported) {
    // Take over the organization GMCA imported: same record, so its officer assignment carries on.
    imported.representatives = [representative];
    imported.verification = { provider: "COMPANY_REGISTRY", status: "VERIFIED", reference, checkedAt: nowIso(), simulated: true };
    const user: User = { id: nextId(d, "USR"), name: representative.name, email: representative.email, role: "EMPLOYER", status: "ACTIVE", companyId: imported.id, title: representative.designation, createdAt: nowIso() };
    d.users.push(user);
    audit(d, { id: user.id, name: user.name, role: "EMPLOYER" }, "COMPANY_REGISTERED", "Company", imported.id, `${imported.name} (${imported.uen}), imported by GMCA, claimed by its representative`);
    notify(d, { role: "ASSESSOR" }, "New company account", `${imported.name} (${imported.uen}) registered.`, "/gmca/taxpayers");
    return user;
  }
  const c: Company = {
    id: nextId(d, "CO"),
    uen: record.uen,
    name: record.name,
    type: record.type,
    sector: record.sector,
    registeredAddress: record.registeredAddress,
    incorporatedOn: record.incorporatedOn,
    verification: { provider: "COMPANY_REGISTRY", status: "VERIFIED", reference, checkedAt: nowIso(), simulated: true },
    representatives: [{ name: rep.name.trim(), designation: rep.designation.trim(), email: rep.email.trim(), phone: rep.phone.trim() }],
    registeredAt: nowIso()
  };
  d.companies.push(c);
  const user: User = { id: nextId(d, "USR"), name: rep.name.trim(), email: rep.email.trim(), role: "EMPLOYER", status: "ACTIVE", companyId: c.id, title: rep.designation.trim(), createdAt: nowIso() };
  d.users.push(user);
  audit(d, { id: user.id, name: user.name, role: "EMPLOYER" }, "COMPANY_REGISTERED", "Company", c.id, `${c.type === "SOLE_PROPRIETORSHIP" ? "Sole proprietorship" : "Company"} ${c.uen} registered through simulated Corporate Registration System`);
  notify(d, { role: "ASSESSOR" }, "New company account", `${c.name} (${c.uen}) registered.`, "/gmca/taxpayers");
  return user;
}


// ---------- Self-service profile ----------

/** Contact details are the taxpayer's own; verified identity fields are not editable here. */
export function updateContact(d: Db, actor: { id: string; name: string; role: Role; taxpayerId?: string }, contact: Contact) {
  const t = d.taxpayers.find((x) => x.id === actor.taxpayerId);
  if (!t || actor.role !== "INDIVIDUAL") throw new ServiceError("Only the taxpayer can change these details.", "FORBIDDEN");
  validateContact(contact);
  if (d.users.some((u) => u.id !== actor.id && u.email.toLowerCase() === contact.email.trim().toLowerCase())) throw new ServiceError("This email address is already used by another account.", "CONFLICT");
  t.email = contact.email.trim();
  t.phone = contact.phone.trim();
  t.address = contact.address.trim();
  const u = d.users.find((x) => x.id === actor.id);
  if (u) u.email = t.email;
  audit(d, actor, "CONTACT_UPDATED", "IndividualTaxpayer", t.id, "Contact details updated");
}

/** Verified registry data can't be overwritten by the taxpayer; a correction goes to GMCA instead. */
export function requestCorrection(d: Db, actor: { id: string; name: string; role: Role }, text: string) {
  if (!text.trim()) throw new ServiceError("Describe what is wrong and what it should be.");
  audit(d, actor, "CORRECTION_REQUESTED", "User", actor.id, `Correction requested: ${text.trim().slice(0, 200)}`);
  notify(d, { role: "ADMIN" }, "Profile correction requested", `${actor.name}: ${text.trim().slice(0, 200)}`, "/admin/audit");
}
