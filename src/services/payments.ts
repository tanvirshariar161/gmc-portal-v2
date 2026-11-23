import { audit, nextId, notify, ServiceError, type Actor } from "../domain/store";
import { require, requireOwner } from "../domain/permissions";
import type { Db, Liability, Payment, PaymentOutcome, PaymentStatus } from "../domain/types";
import { nowIso } from "./clock";
import { generateDocument } from "./documents";
import { providers } from "./integrations";
import { logIntegration } from "./registration";

/**
 * Payment state is separate from filing and assessment state. Only a SUCCESS from the
 * (simulated) bank reduces the outstanding balance; pending and failed attempts never do.
 */

export function outstanding(l: Liability) {
  return Math.max(0, l.amountMinor - l.paidMinor);
}

export function liabilityStatus(d: Db, l: Liability): PaymentStatus {
  if (l.amountMinor <= 0) return "NOT_DUE";
  if (l.paidMinor >= l.amountMinor) return "PAID";
  const attempts = d.payments.filter((p) => p.liabilityId === l.id).sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  if (attempts.some((p) => p.status === "PENDING")) return "PENDING";
  if (l.paidMinor > 0) return "PARTIALLY_PAID";
  if (attempts[0]?.status === "FAILED") return "FAILED";
  return "UNPAID";
}

function getLiability(d: Db, id: string) {
  const l = d.liabilities.find((x) => x.id === id);
  if (!l) throw new ServiceError("Liability not found.", "NOT_FOUND");
  return l;
}

export function initiatePayment(d: Db, actor: Actor, liabilityId: string, amountMinor?: number): Payment {
  require(actor, "payments.pay");
  const l = getLiability(d, liabilityId);
  requireOwner(actor, l.owner);
  const due = outstanding(l);
  if (due <= 0) throw new ServiceError("Nothing is outstanding on this liability.", "CONFLICT");
  if (d.payments.some((p) => p.liabilityId === l.id && p.status === "PENDING")) throw new ServiceError("A payment for this liability is still pending with the bank. Check its status first.", "CONFLICT");
  const amount = amountMinor ?? due;
  if (!Number.isInteger(amount) || amount <= 0 || amount > due) throw new ServiceError("Enter an amount between 0.01 and the outstanding balance.");
  const intent = providers(d.config).bank.createIntent(amount, l.currency, l.reference);
  const p: Payment = { id: nextId(d, "PAY"), intentReference: intent.bankSessionRef, liabilityId: l.id, amountMinor: amount, currency: l.currency, status: "INITIATED", initiatedBy: actor.id, initiatedAt: nowIso(), simulated: true };
  d.payments.push(p);
  logIntegration(d, "DK_BANK", "createIntent", l.reference, "INITIATED", p.intentReference);
  audit(d, actor, "PAYMENT_INITIATED", "Payment", p.id, `Payment of ${amount / 100} ${l.currency} started for ${l.reference}`);
  return p;
}

function applyOutcome(d: Db, actor: Actor, p: Payment, result: { outcome: PaymentOutcome; bankTransactionRef?: string; failureReason?: string }) {
  const l = getLiability(d, p.liabilityId);
  logIntegration(d, "DK_BANK", "settle", l.reference, result.outcome, result.bankTransactionRef ?? p.intentReference);
  if (result.outcome === "PENDING") {
    p.status = "PENDING";
    audit(d, actor, "PAYMENT_PENDING", "Payment", p.id, `Bank reports payment ${p.intentReference} as pending`);
    notify(d, { owner: l.owner }, "Payment pending", `DK Bank (simulated) has not confirmed ${p.intentReference} yet.`, `/payments/receipt/${p.id}`);
    return;
  }
  p.settledAt = nowIso();
  if (result.outcome === "FAILURE") {
    p.status = "FAILED";
    p.failureReason = result.failureReason;
    audit(d, actor, "PAYMENT_FAILED", "Payment", p.id, `Payment ${p.intentReference} failed`);
    notify(d, { owner: l.owner }, "Payment failed", `Payment ${p.intentReference} was not completed. Your balance is unchanged.`, `/payments/receipt/${p.id}`);
    return;
  }
  p.status = "SUCCESS";
  p.bankTransactionRef = result.bankTransactionRef;
  l.paidMinor += p.amountMinor;
  p.receiptDocId = generateDocument(d, actor.id, "PAYMENT_RECEIPT", `Payment Acknowledgement · ${l.description}`, l.owner, { kind: "PAYMENT", id: p.id }).id;
  audit(d, actor, "PAYMENT_SUCCEEDED", "Payment", p.id, `Payment ${p.bankTransactionRef} of ${p.amountMinor / 100} ${p.currency} confirmed for ${l.reference}`);
  notify(d, { owner: l.owner }, "Payment confirmed", `Your Payment Acknowledgement for ${l.reference} is ready.`, `/payments/receipt/${p.id}`);
}

export function settlePayment(d: Db, actor: Actor, paymentId: string, chosen: PaymentOutcome) {
  const p = d.payments.find((x) => x.id === paymentId);
  if (!p) throw new ServiceError("Payment not found.", "NOT_FOUND");
  requireOwner(actor, getLiability(d, p.liabilityId).owner);
  if (p.status !== "INITIATED") throw new ServiceError("This payment session is already closed.", "CONFLICT");
  applyOutcome(d, actor, p, providers(d.config).bank.settle(p.intentReference, chosen));
  return p;
}

export function recheckPayment(d: Db, actor: Actor, paymentId: string) {
  const p = d.payments.find((x) => x.id === paymentId);
  if (!p) throw new ServiceError("Payment not found.", "NOT_FOUND");
  requireOwner(actor, getLiability(d, p.liabilityId).owner);
  if (p.status !== "PENDING") return p;
  applyOutcome(d, actor, p, providers(d.config).bank.recheck(p.intentReference));
  return p;
}

