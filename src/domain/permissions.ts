import type { Actor } from "./store";
import { ServiceError } from "./store";
import type { Assessment, Db, OwnerRef, Role, TaxDocument } from "./types";

/**
 * Role permissions (prototype proposal; GMCA's permission matrix is an open question).
 * Record-level rules live in the `can*` functions below and are enforced inside services,
 * not only by hiding navigation.
 */
export const PERMISSIONS = {
  "individual.file": "File own individual return",
  "employer.manage": "Manage own company, employees and declarations",
  "payments.pay": "Pay own liabilities",
  "assessment.view": "View submitted returns centrally",
  "assessment.act": "Review and assess assigned returns",
  "taxpayers.manage": "Manage taxpayer and company records, including tax residency",
  "admin.users": "Manage user accounts and roles",
  "admin.assignments": "Assign tax officers to organizations",
  "admin.config": "Configure tax rules, reliefs, currencies",
  "admin.incentives": "Record approved company incentives",
  "admin.integrations": "Change integration behaviour and reset data",
  "audit.view": "View the audit log",
  "reports.view": "View reports and dashboards"
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  INDIVIDUAL: ["individual.file", "payments.pay"],
  EMPLOYER: ["employer.manage", "payments.pay"],
  ASSESSOR: ["assessment.view", "assessment.act", "taxpayers.manage", "reports.view"],
  ADMIN: ["admin.config", "admin.assignments", "admin.incentives", "admin.integrations", "audit.view", "reports.view"],
  SYSADMIN: ["admin.users"]
};

export const ROLE_LABEL: Record<Role, string> = {
  INDIVIDUAL: "Individual taxpayer",
  EMPLOYER: "Corporate Tax Payer",
  ASSESSOR: "GMCA Tax Officer",
  ADMIN: "GMCA Tax Administrator",
  SYSADMIN: "GMCA System Admin"
};

export function hasPermission(actor: Actor, p: Permission) {
  return ROLE_PERMISSIONS[actor.role]?.includes(p) ?? false;
}

export function require(actor: Actor, p: Permission) {
  if (!hasPermission(actor, p)) throw new ServiceError(`Your role cannot do this (${PERMISSIONS[p]}).`, "FORBIDDEN");
}

/** Does the actor own this taxpayer/company record? */
export function ownsOwner(actor: Actor, owner: OwnerRef) {
  if (owner.kind === "INDIVIDUAL") return actor.role === "INDIVIDUAL" && actor.taxpayerId === owner.id;
  return actor.role === "EMPLOYER" && actor.companyId === owner.id;
}

/** Read access to a taxpayer's or company's tax records. */
export function canViewOwner(actor: Actor, owner: OwnerRef) {
  return ownsOwner(actor, owner) || hasPermission(actor, "assessment.view");
}

export function requireViewOwner(actor: Actor, owner: OwnerRef) {
  if (!canViewOwner(actor, owner)) throw new ServiceError("You don't have access to this record.", "FORBIDDEN");
}

export function requireOwner(actor: Actor, owner: OwnerRef) {
  if (!ownsOwner(actor, owner)) throw new ServiceError("You can only change your own records.", "FORBIDDEN");
}

/** Assessors act only on cases assigned to them; unassigned cases can be picked up. */
export function canActOnAssessment(actor: Actor, a: Assessment) {
  return hasPermission(actor, "assessment.act") && a.assignedTo === actor.id;
}

export function canViewDocument(actor: Actor, doc: TaxDocument) {
  return canViewOwner(actor, doc.owner);
}

export function requireDocument(db: Db, actor: Actor, id: string): TaxDocument {
  const doc = db.documents.find((d) => d.id === id);
  if (!doc) throw new ServiceError("Document not found.", "NOT_FOUND");
  if (!canViewDocument(actor, doc)) throw new ServiceError("You don't have access to this document.", "FORBIDDEN");
  return doc;
}
