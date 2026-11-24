import { audit, nextId, nextReference, notify, ServiceError, type Actor } from "../domain/store";
import { canActOnAssessment, require, requireOwner } from "../domain/permissions";
import type { Assessment, Db, InformationRequest } from "../domain/types";
import { addDays, nowIso, today } from "./clock";
import { generateDocument } from "./documents";

/**
 * Human-in-the-loop assessment. A calculated amount never becomes an assessment on its own:
 * an assigned officer records the outcome. The taxpayer's submitted declaration is never edited;
 * changes are explicit adjustments with a reason and an audit entry.
 */

export function getAssessment(d: Db, id: string) {
  const a = d.assessments.find((x) => x.id === id);
  if (!a) throw new ServiceError("Case not found.", "NOT_FOUND");
  return a;
}

export function returnFor(d: Db, a: Assessment) {
  return a.returnKind === "INDIVIDUAL" ? d.individualReturns.find((r) => r.id === a.returnId) : d.corporateReturns.find((r) => r.id === a.returnId);
}

export function caseLabel(d: Db, a: Assessment) {
  const name = a.owner.kind === "INDIVIDUAL" ? d.taxpayers.find((t) => t.id === a.owner.id)?.fullName : d.companies.find((c) => c.id === a.owner.id)?.name;
  return { name: name ?? "Unknown", reference: returnFor(d, a)?.reference ?? a.id };
}

function requireAct(actor: Actor, a: Assessment) {
  require(actor, "assessment.act");
  if (!canActOnAssessment(actor, a)) throw new ServiceError("Assign this case to yourself before working on it.", "FORBIDDEN");
  if (a.status === "COMPLETED") throw new ServiceError("This assessment is completed and locked.", "CONFLICT");
}

export function assignToMe(d: Db, actor: Actor, id: string) {
  require(actor, "assessment.act");
  const a = getAssessment(d, id);
  if (a.status === "COMPLETED") throw new ServiceError("This assessment is already completed.", "CONFLICT");
  if (a.assignedTo && a.assignedTo !== actor.id) {
    const other = d.users.find((u) => u.id === a.assignedTo)?.name ?? "another officer";
    throw new ServiceError(`This case is assigned to ${other}.`, "CONFLICT");
  }
  a.assignedTo = actor.id;
  a.assignedAt = nowIso();
  if (a.status === "NOT_ASSIGNED") a.status = "ASSIGNED";
  audit(d, actor, "CASE_ASSIGNED", "Assessment", a.id, `${caseLabel(d, a).reference} assigned to ${actor.name}`);
}

export function startReview(d: Db, actor: Actor, id: string) {
  const a = getAssessment(d, id);
  requireAct(actor, a);
  if (a.status === "ASSIGNED" || a.status === "RESPONSE_RECEIVED") {
    a.status = "UNDER_REVIEW";
    audit(d, actor, "REVIEW_STARTED", "Assessment", a.id, `Review started on ${caseLabel(d, a).reference}`);
    notify(d, { owner: a.owner }, "Your return is under review", `GMCA has started reviewing ${caseLabel(d, a).reference}.`);
  }
}

export function addNote(d: Db, actor: Actor, id: string, text: string) {
  const a = getAssessment(d, id);
  requireAct(actor, a);
  if (!text.trim()) throw new ServiceError("Write a note first.");
  a.notes.push({ id: nextId(d, "NOTE"), by: actor.id, at: nowIso(), text: text.trim() });
  audit(d, actor, "REVIEW_NOTE_ADDED", "Assessment", a.id, `Review note added to ${caseLabel(d, a).reference}`);
}

export function recordVerification(d: Db, actor: Actor, id: string, result: "VERIFIED" | "ISSUE_FLAGGED", note: string) {
  const a = getAssessment(d, id);
  requireAct(actor, a);
  if (result === "ISSUE_FLAGGED" && !note.trim()) throw new ServiceError("Describe the calculation issue.");
  a.calculationVerified = { by: actor.id, at: nowIso(), result, note: note.trim() };
  audit(d, actor, result === "VERIFIED" ? "CALCULATION_VERIFIED" : "CALCULATION_FLAGGED", "Assessment", a.id, `${caseLabel(d, a).reference}: ${result === "VERIFIED" ? "system calculation verified" : `issue flagged: ${note.trim()}`}`);
}

export function addAdjustment(d: Db, actor: Actor, id: string, label: string, amountMinor: number, reason: string) {
  const a = getAssessment(d, id);
  requireAct(actor, a);
  if (!label.trim() || !reason.trim()) throw new ServiceError("An adjustment needs a description and a reason.");
  if (!Number.isInteger(amountMinor) || amountMinor === 0) throw new ServiceError("Enter a non-zero adjustment amount.");
  a.adjustments.push({ id: nextId(d, "ADJ"), label: label.trim(), amountMinor, reason: reason.trim(), by: actor.id, at: nowIso() });
  audit(d, actor, "ASSESSMENT_ADJUSTMENT", "Assessment", a.id, `Adjustment "${label.trim()}" of ${amountMinor / 100} recorded: ${reason.trim()}`);
}

export function requestInformation(d: Db, actor: Actor, id: string, message: string, requiredDocuments: string[], dueDate?: string): InformationRequest {
  const a = getAssessment(d, id);
  requireAct(actor, a);
  if (!message.trim()) throw new ServiceError("Explain what you need from the taxpayer.");
  if (d.infoRequests.some((r) => r.assessmentId === a.id && r.status === "OPEN")) throw new ServiceError("There is already an open request on this case.", "CONFLICT");
  const due = dueDate || addDays(today(), d.config.informationRequestDays);
  if (due < today()) throw new ServiceError("The response due date can't be in the past.");
  const req: InformationRequest = {
    id: nextId(d, "AIR"),
    reference: nextReference(d, "AIR", today().slice(0, 4)),
    assessmentId: a.id,
    owner: a.owner,
    message: message.trim(),
    requiredDocuments: requiredDocuments.map((x) => x.trim()).filter(Boolean),
    dueDate: due,
    requestedBy: actor.id,
    requestedAt: nowIso(),
    status: "OPEN"
  };
  req.letterDocId = generateDocument(d, actor.id, "CORRESPONDENCE", `Request for Additional Information ${req.reference}`, a.owner, { kind: "INFO_REQUEST", id: req.id }).id;
  d.infoRequests.push(req);
  a.status = "INFO_REQUIRED";
  const { reference } = caseLabel(d, a);
  audit(d, actor, "INFO_REQUESTED", "InformationRequest", req.id, `Additional information requested on ${reference}, due ${due}`);
  notify(d, { owner: a.owner }, "Additional Information Required", `GMCA needs more information about ${reference} by ${due}.`, `/requests/${req.id}`);
  return req;
}

export function respondToRequest(d: Db, actor: Actor, requestId: string, message: string, docIds: string[]) {
  const req = d.infoRequests.find((r) => r.id === requestId);
  if (!req) throw new ServiceError("Request not found.", "NOT_FOUND");
  requireOwner(actor, req.owner);
  if (req.status !== "OPEN") throw new ServiceError("This request has already been answered.", "CONFLICT");
  if (!message.trim() && !docIds.length) throw new ServiceError("Add a message or upload at least one document.");
  for (const id of docIds) if (!d.documents.some((x) => x.id === id)) throw new ServiceError("One of the uploaded documents is missing. Upload it again.");
  req.response = { by: actor.id, at: nowIso(), message: message.trim(), docIds };
  req.status = "RESPONDED";
  const a = getAssessment(d, req.assessmentId);
  a.status = "RESPONSE_RECEIVED";
  audit(d, actor, "INFO_RESPONDED", "InformationRequest", req.id, `Response to ${req.reference} sent with ${docIds.length} document(s)`);
  if (a.assignedTo) notify(d, { userId: a.assignedTo }, "Response received", `${caseLabel(d, a).name} answered ${req.reference}.`, `/gmca/cases/${a.id}`);
}

export function closeRequest(d: Db, actor: Actor, requestId: string) {
  const req = d.infoRequests.find((r) => r.id === requestId);
  if (!req) throw new ServiceError("Request not found.", "NOT_FOUND");
  requireAct(actor, getAssessment(d, req.assessmentId));
  req.status = "CLOSED";
  audit(d, actor, "INFO_REQUEST_CLOSED", "InformationRequest", req.id, `${req.reference} closed`);
}

export function completeAssessment(d: Db, actor: Actor, id: string, summary: string) {
  const a = getAssessment(d, id);
  requireAct(actor, a);
  if (a.status !== "UNDER_REVIEW") throw new ServiceError(a.status === "INFO_REQUIRED" ? "Wait for the taxpayer's response, or close the request, before completing." : "Start the review before completing the assessment.");
  if (!a.calculationVerified) throw new ServiceError("Verify the system calculation, or flag an issue, before completing.");
  if (!summary.trim()) throw new ServiceError("Write the assessment outcome summary.");
  const ret = returnFor(d, a);
  const calc = ret?.calculation;
  if (!ret || !calc) throw new ServiceError("The return has no calculation snapshot.");
  const adjustmentTotal = a.adjustments.reduce((s, x) => s + x.amountMinor, 0);
  const assessedTax = Math.max(0, calc.taxMinor + adjustmentTotal);
  // Anything already paid with the return (version 1 flow) counts against the assessed tax.
  const prepaid = d.liabilities.filter((l) => l.source === "INDIVIDUAL_SELF_ASSESSMENT" && l.sourceId === a.returnId).reduce((s, l) => s + l.paidMinor, 0);
  const balance = assessedTax - calc.creditsMinor - prepaid;
  const now = nowIso();
  a.outcome = { assessedTaxMinor: assessedTax, creditsMinor: calc.creditsMinor, prepaidMinor: prepaid, balanceMinor: balance, summary: summary.trim(), by: actor.id, at: now };
  a.status = "COMPLETED";
  for (const r of d.infoRequests) if (r.assessmentId === a.id && r.status !== "CLOSED") r.status = "CLOSED";
  const label = a.returnKind === "INDIVIDUAL" ? "Individual Income Tax" : "Corporate Income Tax";
  a.noaDocId = generateDocument(d, actor.id, "NOTICE_OF_ASSESSMENT", `Notice of Assessment · ${label} ${a.year}`, a.owner, { kind: "ASSESSMENT", id: a.id }).id;
  if (balance > 0) {
    const liability = {
      id: nextId(d, "LIA"),
      reference: nextReference(d, "LIA", a.year),
      owner: a.owner,
      source: a.returnKind === "INDIVIDUAL" ? ("INDIVIDUAL_ASSESSMENT" as const) : ("CORPORATE_ASSESSMENT" as const),
      sourceId: a.id,
      description: `${label} ${a.year} · assessed balance`,
      amountMinor: balance,
      currency: calc.reportingCurrency,
      paidMinor: 0,
      createdAt: now
    };
    d.liabilities.push(liability);
    a.liabilityId = liability.id;
  }
  const { reference } = caseLabel(d, a);
  audit(d, actor, "ASSESSMENT_COMPLETED", "Assessment", a.id, `${reference} assessed: tax ${assessedTax / 100}, balance ${balance / 100}`);
  notify(d, { owner: a.owner }, "Notice of Assessment issued", `GMCA has completed the assessment of ${reference}.${balance > 0 ? " A balance is payable." : ""}`, a.owner.kind === "INDIVIDUAL" ? `/returns/${a.returnId}` : `/company/corporate/return/${a.returnId}`);
}
