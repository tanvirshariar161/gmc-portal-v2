import { audit, notify, ServiceError, SYSTEM_ACTOR, type Actor } from "../domain/store";
import { require } from "../domain/permissions";
import type { Assessment, Db, ID, OwnerRef } from "../domain/types";
import { nowIso } from "./clock";

/**
 * Officer assignments by organization. The GMCA Tax Administrator assigns one tax officer to each
 * organization; an officer can cover many. Returns from the organization, and from individuals it
 * employs, are assigned to that officer as soon as they are submitted.
 */

/** Organizations an individual works for, current employment first. */
function employersOf(d: Db, taxpayerId: ID): ID[] {
  const rank = { ACTIVE: 0, ON_LEAVE: 1, LEFT: 2 } as const;
  return d.employees
    .filter((e) => e.taxpayerId === taxpayerId)
    .sort((a, b) => rank[a.status] - rank[b.status] || b.startDate.localeCompare(a.startDate))
    .map((e) => e.companyId);
}

export function assignmentFor(d: Db, companyId: ID) {
  return d.officerAssignments.find((a) => a.companyId === companyId);
}

/** The officer responsible for a taxpayer or company, if their organization has one. */
export function officerForOwner(d: Db, owner: OwnerRef): ID | undefined {
  const companies = owner.kind === "COMPANY" ? [owner.id] : employersOf(d, owner.id);
  for (const c of companies) {
    const officerId = assignmentFor(d, c)?.officerId;
    const officer = d.users.find((u) => u.id === officerId);
    if (officer && officer.role === "ASSESSOR" && officer.status === "ACTIVE") return officer.id;
  }
  return undefined;
}

/** Organizations an officer covers. */
export function organizationsOf(d: Db, officerId: ID) {
  return d.officerAssignments.filter((a) => a.officerId === officerId).map((a) => a.companyId);
}

/** Hands an unassigned case to its organization's officer. Returns the officer, or undefined if none. */
export function autoAssign(d: Db, a: Assessment): ID | undefined {
  if (a.assignedTo || a.status !== "NOT_ASSIGNED") return a.assignedTo;
  const officerId = officerForOwner(d, a.owner);
  if (!officerId) return undefined;
  a.assignedTo = officerId;
  a.assignedAt = nowIso();
  a.status = "ASSIGNED";
  const officer = d.users.find((u) => u.id === officerId)!;
  audit(d, SYSTEM_ACTOR, "CASE_ASSIGNED", "Assessment", a.id, `Assigned to ${officer.name}, the officer for the taxpayer's organization`);
  notify(d, { userId: officerId }, "New return assigned to you", "A return from one of your organizations was submitted and assigned to you.", `/gmca/cases/${a.id}`);
  return officerId;
}

/**
 * Sets (or clears, with null) the officer for an organization. Open cases of the organization and its
 * employees that nobody has picked up yet move to the new officer; cases already in progress stay put.
 */
export function setOrganizationOfficer(d: Db, actor: Actor, companyId: ID, officerId: ID | null) {
  require(actor, "admin.assignments");
  const company = d.companies.find((c) => c.id === companyId);
  if (!company) throw new ServiceError("Organization not found.", "NOT_FOUND");
  const before = assignmentFor(d, companyId);
  d.officerAssignments = d.officerAssignments.filter((a) => a.companyId !== companyId);
  if (officerId === null) {
    if (before) audit(d, actor, "OFFICER_UNASSIGNED", "Company", companyId, `${company.name} no longer has an assigned officer`);
    return 0;
  }
  const officer = d.users.find((u) => u.id === officerId);
  if (!officer || officer.role !== "ASSESSOR") throw new ServiceError("Choose a GMCA tax officer.");
  if (officer.status !== "ACTIVE") throw new ServiceError(`${officer.name}'s account is deactivated.`);
  d.officerAssignments.push({ companyId, officerId, assignedBy: actor.id, assignedAt: nowIso() });
  audit(d, actor, "OFFICER_ASSIGNED", "Company", companyId, `${officer.name} assigned to ${company.name}`);
  let moved = 0;
  for (const a of d.assessments) {
    if (a.assignedTo || a.status !== "NOT_ASSIGNED" || officerForOwner(d, a.owner) !== officerId) continue;
    autoAssign(d, a);
    moved += 1;
  }
  notify(d, { userId: officerId }, "Organization assigned to you", `You are the tax officer for ${company.name}. Its returns, and those of its employees, now come to you.`, "/gmca/queue");
  return moved;
}
