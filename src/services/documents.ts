import { audit, nextId, nextReference, ServiceError, type Actor } from "../domain/store";
import { requireViewOwner } from "../domain/permissions";
import type { Db, DocumentCategory, DocumentReviewStatus, OwnerRef, RelatedRef, TaxDocument } from "../domain/types";
import { nowIso } from "./clock";

export const ALLOWED_TYPES: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" };
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Uploads larger than this keep metadata only, so demo browser storage does not fill up. */
export const MAX_STORED_BYTES = 400 * 1024;

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  BANK_STATEMENT: "Bank statement",
  INCOME_SUPPORTING: "Income supporting document",
  RELIEF_EVIDENCE: "Relief evidence",
  AUDITED_FINANCIALS: "Audited financial statements",
  FIXED_ASSET_REPORT: "Fixed asset report",
  IDENTITY: "Identity or registration document",
  INFO_RESPONSE: "Additional information response",
  NOTICE_OF_ASSESSMENT: "Notice of Assessment",
  SUBMISSION_ACK: "Acknowledgement Certificate",
  PAYMENT_RECEIPT: "Payment Acknowledgement",
  CORRESPONDENCE: "Official correspondence"
};

export type UploadInput = { category: DocumentCategory; fileName: string; mimeType: string; sizeBytes: number; dataUrl?: string; owner: OwnerRef; related: RelatedRef; title?: string };

export function validateUpload(file: { name: string; type: string; size: number }): string | null {
  if (!ALLOWED_TYPES[file.type]) return `${file.name} is not a PDF, JPG or PNG file.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than 10 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export function uploadDocument(d: Db, actor: Actor, input: UploadInput): TaxDocument {
  requireViewOwner(actor, input.owner);
  const problem = validateUpload({ name: input.fileName, type: input.mimeType, size: input.sizeBytes });
  if (problem) throw new ServiceError(problem);
  const doc: TaxDocument = {
    id: nextId(d, "DOC"),
    reference: nextReference(d, "DOC"),
    category: input.category,
    title: input.title ?? CATEGORY_LABEL[input.category],
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    owner: input.owner,
    related: input.related,
    uploadedBy: actor.id,
    uploadedAt: nowIso(),
    reviewStatus: "UPLOADED",
    generated: false,
    dataUrl: input.dataUrl && input.sizeBytes <= MAX_STORED_BYTES ? input.dataUrl : undefined
  };
  d.documents.unshift(doc);
  audit(d, actor, "DOCUMENT_UPLOADED", "Document", doc.id, `${CATEGORY_LABEL[doc.category]} uploaded (${doc.fileName})`);
  return doc;
}

/** Certificates, notices and receipts: rendered from stored data by the document viewer. */
export function generateDocument(d: Db, actorId: string, category: DocumentCategory, title: string, owner: OwnerRef, related: RelatedRef): TaxDocument {
  const reference = nextReference(d, category === "SUBMISSION_ACK" ? "ACK" : category === "NOTICE_OF_ASSESSMENT" ? "NOA" : category === "PAYMENT_RECEIPT" ? "RCP" : "LTR", nowIso().slice(0, 4));
  const doc: TaxDocument = {
    id: nextId(d, "DOC"),
    reference,
    category,
    title,
    fileName: `${reference}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 0,
    owner,
    related,
    uploadedBy: actorId,
    uploadedAt: nowIso(),
    generated: true
  };
  d.documents.unshift(doc);
  return doc;
}

export function setDocumentReview(d: Db, actor: Actor, docId: string, status: DocumentReviewStatus) {
  if (actor.role !== "ASSESSOR") throw new ServiceError("Only GMCA assessors review documents.", "FORBIDDEN");
  const doc = d.documents.find((x) => x.id === docId);
  if (!doc) throw new ServiceError("Document not found.", "NOT_FOUND");
  if (doc.generated) throw new ServiceError("Generated documents are not reviewed.");
  doc.reviewStatus = status;
  audit(d, actor, "DOCUMENT_REVIEWED", "Document", doc.id, `${doc.title} marked ${status.toLowerCase().replace(/_/g, " ")}`);
}

/** Remove an upload from a draft. Only the uploader's own, not-yet-submitted evidence. */
export function removeDraftDocument(d: Db, actor: Actor, docId: string) {
  const i = d.documents.findIndex((x) => x.id === docId);
  const doc = d.documents[i];
  if (!doc) return;
  if (doc.generated || doc.uploadedBy !== actor.id) throw new ServiceError("This document can't be removed.", "FORBIDDEN");
  d.documents.splice(i, 1);
  audit(d, actor, "DOCUMENT_REMOVED", "Document", doc.id, `${doc.title} removed from a draft`);
}
