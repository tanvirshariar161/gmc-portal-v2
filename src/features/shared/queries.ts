import type { Actor } from "../../domain/store";
import type { Db, Notification, OwnerRef, User } from "../../domain/types";
import { liabilityStatus, outstanding } from "../../services/payments";

export function ownerOf(actor: Actor): OwnerRef | null {
  if (actor.role === "INDIVIDUAL" && actor.taxpayerId) return { kind: "INDIVIDUAL", id: actor.taxpayerId };
  if (actor.role === "EMPLOYER" && actor.companyId) return { kind: "COMPANY", id: actor.companyId };
  return null;
}

export const sameOwner = (a: OwnerRef, b: OwnerRef) => a.kind === b.kind && a.id === b.id;

export function isRead(n: Notification, userId: string) {
  return n.readBy.includes(userId) || n.readBy.includes("*");
}

export function notificationsFor(db: Db, user: User) {
  return db.notifications.filter((n) => {
    const r = n.recipient;
    if ("userId" in r) return r.userId === user.id;
    if ("role" in r) return r.role === user.role;
    if (r.owner.kind === "INDIVIDUAL") return user.taxpayerId === r.owner.id;
    return user.companyId === r.owner.id;
  });
}

export function liabilitiesFor(db: Db, owner: OwnerRef) {
  return db.liabilities
    .filter((l) => sameOwner(l.owner, owner))
    .map((l) => ({ liability: l, status: liabilityStatus(db, l), outstanding: outstanding(l) }))
    .sort((a, b) => b.liability.createdAt.localeCompare(a.liability.createdAt));
}

export function paymentsFor(db: Db, owner: OwnerRef) {
  const ids = new Set(db.liabilities.filter((l) => sameOwner(l.owner, owner)).map((l) => l.id));
  return db.payments.filter((p) => ids.has(p.liabilityId)).sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
}

export function openRequestsFor(db: Db, owner: OwnerRef) {
  return db.infoRequests.filter((r) => sameOwner(r.owner, owner) && r.status === "OPEN");
}

export function documentsFor(db: Db, owner: OwnerRef) {
  return db.documents.filter((d) => sameOwner(d.owner, owner));
}
