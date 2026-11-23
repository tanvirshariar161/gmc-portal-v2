import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "../domain/seed";
import type { Actor } from "../domain/store";
import type { Db } from "../domain/types";
import { toMinor } from "../lib/money";
import { assignToMe, completeAssessment, recordVerification, requestInformation, respondToRequest, startReview } from "./assessment";
import { bracketFor, calculateCorporate, calculateIndividual, progressiveTax, ruleSetForYear } from "./calc";
import { convert } from "./currency";
import { ensureDeclaration, saveDeclarationLines, submitDeclaration } from "./employer";
import { ensureDraftReturn, saveDraft, submitReturn, validateReturn } from "./individual";
import { initiatePayment, liabilityStatus, recheckPayment, settlePayment } from "./payments";
import { uploadDocument } from "./documents";

let d: Db;
const actor = (id: string): Actor => {
  const u = d.users.find((x) => x.id === id)!;
  return { id: u.id, name: u.name, role: u.role, taxpayerId: u.taxpayerId, companyId: u.companyId };
};

beforeEach(() => {
  d = buildSeed();
});

describe("seed", () => {
  it("builds the demo story", () => {
    expect(d.individualReturns.filter((r) => r.submissionStatus === "SUBMITTED").length).toBeGreaterThanOrEqual(6);
    expect(d.assessments.map((a) => a.status)).toEqual(expect.arrayContaining(["NOT_ASSIGNED", "UNDER_REVIEW", "INFO_REQUIRED", "RESPONSE_RECEIVED", "COMPLETED"]));
    const karma25 = d.individualReturns.find((r) => r.taxpayerId === "tp-karma" && r.year === 2025)!;
    expect(karma25.ackDocId).toBeTruthy();
    expect(d.documents.some((x) => x.category === "PAYMENT_RECEIPT" && x.owner.id === "tp-karma")).toBe(true);
    const anikaOutstanding = d.liabilities.find((l) => l.owner.id === "tp-anika")!;
    expect(liabilityStatus(d, anikaOutstanding)).toBe("UNPAID");
  });
});

describe("currency", () => {
  it("keeps the original and converts with the latest rate on or before the date", () => {
    const c = convert(d.config, toMinor(1000), "SGD", "2026-03-31");
    expect(c).toMatchObject({ originalMinor: 100000, currency: "SGD", status: "CONVERTED", rate: 0.75, rateDate: "2026-01-01", isDemoRate: true, reportingMinor: 75000 });
    expect(convert(d.config, toMinor(1000), "SGD", "2025-06-30").rate).toBe(0.74);
  });
  it("reports pending when no rate is configured", () => {
    const c = convert(d.config, toMinor(50), "GBP", "2026-06-30");
    expect(c.status).toBe("PENDING");
    expect(c.reportingMinor).toBeNull();
  });
});

describe("calculation engine", () => {
  const rules = () => ruleSetForYear(d.ruleSets, 2026);
  it("applies progressive demo bands", () => {
    expect(progressiveTax(toMinor(40_000), rules().individualBands)).toBe(toMinor(1_000 + 700));
  });
  it("uses the whole-amount TDS bracket", () => {
    expect(bracketFor(toMinor(4_200), rules().tdsBands)?.ratePct).toBe(5);
  });
  it("caps reliefs, excludes exempt income and nets TDS", () => {
    const s = calculateIndividual(
      {
        employment: [{ employerName: "X", months: 12, grossMinor: toMinor(40_000), tdsMinor: toMinor(1_000), currency: "USD", source: "EMPLOYER_DECLARATIONS" }],
        incomeSources: [{ id: "a", category: "GIFT", description: "Gift", payer: "", amountMinor: toMinor(5000), currency: "USD", periodFrom: "", periodTo: "", classification: "EXEMPT", conversion: convert(d.config, toMinor(5000), "USD", "2026-12-31"), supportingDocIds: [] }],
        reliefs: [{ id: "r", reliefKey: "SPOUSE", declaredMinor: toMinor(5_000), note: "", docIds: [] }],
        residency: "NOT_DETERMINED"
      },
      rules(),
      "USD"
    );
    expect(s.taxMinor).toBe(progressiveTax(toMinor(38_000), rules().individualBands));
    expect(s.balanceMinor).toBe(s.taxMinor - toMinor(1_000));
    expect(s.warnings.join(" ")).toMatch(/cap/);
  });
  it("applies the non-resident rate only when GMCA recorded non-residency", () => {
    const input = { employment: [{ employerName: "X", months: 12, grossMinor: toMinor(80_000), tdsMinor: 0, currency: "USD", source: "EMPLOYER_DECLARATIONS" as const }], incomeSources: [], reliefs: [] };
    expect(calculateIndividual({ ...input, residency: "NON_RESIDENT" }, rules(), "USD").taxMinor).toBe(0);
    expect(calculateIndividual({ ...input, residency: "NOT_DETERMINED" }, rules(), "USD").taxMinor).toBeGreaterThan(0);
  });
  it("applies an approved incentive rate", () => {
    const f = { revenueMinor: toMinor(1_000_000), otherIncomeMinor: 0, expensesMinor: toMinor(600_000), adjustments: [] };
    expect(calculateCorporate(f, rules(), undefined, "USD").taxMinor).toBe(toMinor(60_000));
    expect(calculateCorporate(f, rules(), d.incentives[0], "USD").taxMinor).toBe(toMinor(20_000));
  });
});

describe("permissions", () => {
  it("stops a taxpayer editing another taxpayer's return", () => {
    const anikaReturn = d.individualReturns.find((r) => r.taxpayerId === "tp-anika")!;
    expect(() => saveDraft(d, actor("usr-karma"), anikaReturn.id, { declarationAccepted: true })).toThrow(/own records/);
  });
  it("stops an assessor acting on a case assigned to someone else", () => {
    const lucas = d.assessments.find((a) => a.owner.id === "tp-lucas")!;
    expect(() => startReview(d, actor("usr-ugyen"), lucas.id)).toThrow(/Assign/);
    expect(() => assignToMe(d, actor("usr-ugyen"), lucas.id)).toThrow(/assigned to Kinley/);
  });
  it("stops an administrator assessing", () => {
    const a = d.assessments.find((x) => x.status === "NOT_ASSIGNED")!;
    expect(() => assignToMe(d, actor("usr-admin"), a.id)).toThrow(/role/);
  });
});

describe("individual return submission", () => {
  it("requires a bank statement per source, then locks the return and opens an assessment", () => {
    const karma = actor("usr-karma");
    const ret = ensureDraftReturn(d, karma, 2026);
    expect(ret.employment[0]?.months).toBe(10);
    const src = { id: "s1", category: "RENTAL", description: "Rent", payer: "Tenant", amountMinor: toMinor(3000), currency: "SGD", periodFrom: "2026-01-01", periodTo: "2026-10-31", classification: "TAXABLE" as const, supportingDocIds: [] };
    saveDraft(d, karma, ret.id, { incomeSources: [src], declarationAccepted: true });
    expect(validateReturn(d, ret).map((i) => i.message).join(" ")).toMatch(/bank statement/);
    const doc = uploadDocument(d, karma, { category: "BANK_STATEMENT", fileName: "s.pdf", mimeType: "application/pdf", sizeBytes: 1000, owner: { kind: "INDIVIDUAL", id: "tp-karma" }, related: { kind: "INDIVIDUAL_RETURN", id: ret.id, incomeSourceId: "s1" } });
    saveDraft(d, karma, ret.id, { incomeSources: [{ ...src, bankStatementDocId: doc.id }] });
    submitReturn(d, karma, ret.id);
    expect(ret.submissionStatus).toBe("SUBMITTED");
    expect(ret.reference).toMatch(/^IIT-2026-/);
    expect(d.assessments.find((a) => a.id === ret.assessmentId)?.status).toBe("NOT_ASSIGNED");
    expect(() => saveDraft(d, karma, ret.id, { declarationAccepted: false })).toThrow(/submitted/);
  });

  it("runs request → response → completion → liability", () => {
    const ugyen = actor("usr-ugyen");
    const tashiCase = d.assessments.find((a) => a.owner.id === "tp-tashi")!;
    assignToMe(d, ugyen, tashiCase.id);
    startReview(d, ugyen, tashiCase.id);
    const req = requestInformation(d, ugyen, tashiCase.id, "Send invoices", ["Invoices"]);
    expect(() => completeAssessment(d, ugyen, tashiCase.id, "x")).toThrow(/response/);
    respondToRequest(d, actor("usr-tashi"), req.id, "Attached", []);
    startReview(d, ugyen, tashiCase.id);
    recordVerification(d, ugyen, tashiCase.id, "VERIFIED", "");
    completeAssessment(d, ugyen, tashiCase.id, "Assessed as filed.");
    expect(tashiCase.status).toBe("COMPLETED");
    expect(tashiCase.noaDocId).toBeTruthy();
    expect(d.liabilities.some((l) => l.sourceId === tashiCase.id)).toBe(true);
  });
});

describe("payments", () => {
  it("only success reduces the balance; pending then recheck settles", () => {
    const anika = actor("usr-anika");
    const l = d.liabilities.find((x) => x.owner.id === "tp-anika")!;
    const p1 = initiatePayment(d, anika, l.id);
    settlePayment(d, anika, p1.id, "FAILURE");
    expect(l.paidMinor).toBe(0);
    expect(liabilityStatus(d, l)).toBe("FAILED");
    const p2 = initiatePayment(d, anika, l.id);
    settlePayment(d, anika, p2.id, "PENDING");
    expect(liabilityStatus(d, l)).toBe("PENDING");
    expect(() => initiatePayment(d, anika, l.id)).toThrow(/pending/);
    recheckPayment(d, anika, p2.id);
    expect(liabilityStatus(d, l)).toBe("PAID");
    expect(p2.receiptDocId).toBeTruthy();
  });
});

describe("employer declaration", () => {
  it("converts per-employee currency and creates a liability on submit", () => {
    const pema = actor("usr-pema");
    const decl = ensureDeclaration(d, pema, "co-gge", "2026-11");
    expect(decl.lines.find((l) => l.employeeId === "emp-jigme")).toBeUndefined();
    const anikaLine = decl.lines.find((l) => l.employeeId === "emp-anika")!;
    expect(anikaLine.currency).toBe("INR");
    saveDeclarationLines(d, pema, decl.id, decl.lines.map((l) => ({ employeeId: l.employeeId, amountMinor: l.amountMinor || toMinor(1000), currency: l.employeeId === "emp-karma" ? "EUR" : l.currency })));
    const karmaLine = decl.lines.find((l) => l.employeeId === "emp-karma")!;
    expect(karmaLine.conversion).toMatchObject({ currency: "EUR", rate: 1.1 });
    submitDeclaration(d, pema, decl.id);
    expect(decl.reference).toMatch(/^TDS-202611-/);
    expect(d.liabilities.find((l) => l.id === decl.liabilityId)?.amountMinor).toBe(decl.calculation!.balanceMinor);
  });
});
