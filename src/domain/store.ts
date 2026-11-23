import type { AuditEntry, Db, ID, Notification, Recipient, Role, User } from "./types";
import { buildSeed } from "./seed";
import { nowIso } from "../services/clock";

/**
 * Prototype persistence: one versioned JSON document in this browser's localStorage.
 * Every write goes through `transact`, which services wrap with permission checks
 * and audit entries. Replace this module with an API client to move to a server.
 */
const KEY = "gmca-v2:db";
export const SCHEMA_VERSION = 5;

let db: Db | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Db {
  const raw = storage()?.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.schemaVersion === SCHEMA_VERSION) return parsed;
    } catch {
      /* corrupt or old: reseed */
    }
  }
  const fresh = buildSeed();
  persist(fresh);
  return fresh;
}

let persistError: string | null = null;
function persist(next: Db) {
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
    persistError = null;
  } catch {
    persistError = "This browser's storage is full, so the latest change is kept only until you reload. Remove large uploads or reset the demo data.";
  }
}

export function getPersistError() {
  return persistError;
}

export function getDb(): Db {
  if (!db) db = load();
  return db;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) l();
}

/** Run a mutation on a structural copy so a thrown error leaves the stored state untouched. */
export function transact<T>(fn: (draft: Db) => T): T {
  const draft = structuredClone(getDb());
  const result = fn(draft);
  db = draft;
  persist(draft);
  emit();
  return result;
}

export function resetDemoData() {
  db = buildSeed();
  persist(db);
  emit();
}

/** Test hook: start from a fresh seed without touching storage listeners. */
export function __setDbForTests(next: Db) {
  db = next;
}

// ---------- helpers used inside transactions ----------

export function nextId(draft: Db, prefix: string): ID {
  const n = (draft.counters[prefix] ?? 0) + 1;
  draft.counters[prefix] = n;
  return `${prefix.toLowerCase()}-${n.toString().padStart(4, "0")}`;
}

/** Human reference like IIT-2026-000123. */
export function nextReference(draft: Db, prefix: string, year?: number | string): string {
  const key = `ref:${prefix}:${year ?? ""}`;
  const n = (draft.counters[key] ?? 100) + 1;
  draft.counters[key] = n;
  return year ? `${prefix}-${year}-${n.toString().padStart(6, "0")}` : `${prefix}-${n.toString().padStart(6, "0")}`;
}

export type Actor = Pick<User, "id" | "name" | "role"> & { taxpayerId?: ID; companyId?: ID };

export const SYSTEM_ACTOR = { id: "system", name: "Platform", role: "SYSTEM" as const };

export function audit(draft: Db, actor: Actor | typeof SYSTEM_ACTOR, action: string, entity: string, entityId: ID, summary: string) {
  const entry: AuditEntry = {
    id: nextId(draft, "AUD"),
    at: nowIso(),
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role as Role | "SYSTEM",
    action,
    entity,
    entityId,
    summary
  };
  draft.audit.unshift(entry);
}

export function notify(draft: Db, recipient: Recipient, title: string, body: string, link?: string) {
  const n: Notification = { id: nextId(draft, "NTF"), recipient, title, body, link, createdAt: nowIso(), readBy: [] };
  draft.notifications.unshift(n);
}

export class ServiceError extends Error {
  constructor(
    message: string,
    public code: "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT" = "INVALID"
  ) {
    super(message);
  }
}
