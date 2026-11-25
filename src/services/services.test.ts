import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "../domain/seed";
import type { Actor } from "../domain/store";
import type { Db } from "../domain/types";
import { formatAmount, toMinor } from "../lib/money";
import { addAdjustment, assignToMe, completeAssessment, recordVerification, requestInformation, respondToRequest, startReview } from "./assessment";
import { bracketFor, calculateCorporate, calculateIndividual, monthlyTds, progressiveTax, ruleSetForYear } from "./calc";
import { convert } from "./currency";
import { classForCompany, classForTaxpayer, resolveTaxpayerClass } from "./classification";
import { createStaffUser, publishRuleSet, setResidency, setStaffRole, setUserStatus, validateRuleSet } from "./admin";
import { officerForOwner, setOrganizationOfficer } from "./assignments";
import { buildRuleWorkbook } from "./ruleWorkbook";
import { checkNewContact } from "./registration";
import { checkCredentials, issueOtp, maskDestination, otpDestination, SAMPLE_PASSWORD, signInFactor, startNdiSignIn, verifyOtp } from "./auth";
import { corporateIssues, declarationByCurrency, ensureCorporateDraft, ensureDeclaration, saveCorporateDraft, saveDeclarationLines, submitDeclaration } from "./employer";
import { ensureDraftReturn, payAndSubmit, returnScope, saveDraft, submitReturn, syncDkBankStatement, validateReturn } from "./individual";
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

describe("money", () => {
  it("shows Nu and $ signs, other currencies by code, and drops decimals on whole amounts", () => {
    expect(formatAmount(toMinor(95_000), "BTN")).toBe("Nu\u00a095,000");
    expect(formatAmount(toMinor(-2_400), "USD")).toBe("−$2,400");
    expect(formatAmount(toMinor(1_234.5), "BTN")).toBe("Nu\u00a01,234.50");
    expect(formatAmount(toMinor(8_000), "SGD")).toBe("SGD 8,000");
  });
});

describe("seed", () => {
  it("builds the demo story", () => {
    expect(d.individualReturns.filter((r) => r.submissionStatus === "SUBMITTED").length).toBeGreaterThanOrEqual(4);
    expect(d.assessments.map((a) => a.status)).toEqual(expect.arrayContaining(["NOT_ASSIGNED", "UNDER_REVIEW", "INFO_REQUIRED", "RESPONSE_RECEIVED", "COMPLETED"]));
    const karma25 = d.individualReturns.find((r) => r.taxpayerId === "tp-karma" && r.year === 2025)!;
    expect(karma25.ackDocId).toBeTruthy();
    expect(d.documents.some((x) => x.category === "PAYMENT_RECEIPT" && x.owner.id === "tp-karma")).toBe(true);
    const october = d.monthlyDeclarations.find((x) => x.companyId === "co-gge" && x.period === "2026-10")!;
    expect(liabilityStatus(d, d.liabilities.find((l) => l.id === october.liabilityId)!)).toBe("UNPAID");
    // The foreign taxpayer starts clean: nothing filed, nothing owed.
    expect(d.individualReturns.filter((r) => r.taxpayerId === "tp-anika")).toEqual([]);
    expect(d.liabilities.filter((l) => l.owner.id === "tp-anika")).toEqual([]);
  });
});

describe("currency", () => {
  it("keeps the original and converts with the latest rate on or before the date", () => {
    const c = convert(d.config, toMinor(1000), "SGD", "2026-03-31");
    expect(c).toMatchObject({ originalMinor: 100000, currency: "SGD", reportingCurrency: "BTN", status: "CONVERTED", rate: 75, rateDate: "2026-01-01", reportingMinor: toMinor(75_000) });
    expect(convert(d.config, toMinor(1000), "USD", "2025-06-30")).toMatchObject({ rate: 100, reportingMinor: toMinor(100_000) });
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
    // Nu 4,000,000: nothing on the first Nu 1,000,000, 5% of Nu 2,000,000, 7% of Nu 1,000,000.
    expect(progressiveTax(toMinor(4_000_000), rules().individualBands)).toBe(toMinor(100_000 + 70_000));
  });
  it("uses the GMCA TDS table: inclusive upper limits, rate on the whole month", () => {
    const r = (nu: number) => bracketFor(toMinor(nu), rules().tdsBands)?.ratePct;
    expect([r(100_000), r(100_000.01), r(300_000), r(300_000.01), r(2_500_000), r(2_500_000.01)]).toEqual([0, 2, 2, 5, 5, 10]);
    expect(monthlyTds(toMinor(420_000), rules(), classForTaxpayer(rules(), { category: "CITIZEN", residencyStatus: "NOT_DETERMINED" }, 2026)).tdsMinor).toBe(toMinor(21_000));
  });
  it("puts US dollar pay on the brackets at US$1 = Nu 100", () => {
    const nuOf = (usd: number) => convert(d.config, toMinor(usd), "USD", "2026-05-31").reportingMinor!;
    const r = (usd: number) => bracketFor(nuOf(usd), rules().tdsBands)?.ratePct;
    expect([r(1_000), r(1_001), r(3_000), r(3_001), r(25_000), r(25_001)]).toEqual([0, 2, 2, 5, 5, 10]);
  });
  it("caps reliefs, excludes exempt income and nets TDS", () => {
    const s = calculateIndividual(
      {
        employment: [{ employerName: "X", months: 12, grossMinor: toMinor(4_000_000), tdsMinor: toMinor(100_000), healthMinor: 0, currency: "BTN", source: "EMPLOYER_DECLARATIONS" }],
        incomeSources: [{ id: "a", category: "GIFT", description: "Gift", payer: "", amountMinor: toMinor(5000), currency: "USD", periodFrom: "", periodTo: "", classification: "EXEMPT", conversion: convert(d.config, toMinor(5000), "USD", "2026-12-31"), supportingDocIds: [] }],
        reliefs: [{ id: "r", reliefKey: "SPOUSE", declaredMinor: toMinor(500_000), note: "", docIds: [] }],
        citizenship: "CITIZEN",
        residency: "NOT_DETERMINED",
        year: 2026
      },
      rules(),
      "BTN"
    );
    // Spouse relief is capped at Nu 200,000.
    expect(s.taxMinor).toBe(progressiveTax(toMinor(3_800_000), rules().individualBands));
    expect(s.balanceMinor).toBe(s.taxMinor - toMinor(100_000));
    expect(s.warnings.join(" ")).toMatch(/cap/);
  });
  it("applies the non-resident rate only when GMCA recorded non-residency", () => {
    const input = { employment: [{ employerName: "X", months: 12, grossMinor: toMinor(8_000_000), tdsMinor: 0, healthMinor: 0, currency: "BTN", source: "EMPLOYER_DECLARATIONS" as const }], incomeSources: [], reliefs: [], citizenship: "FOREIGN" as const, year: 2026 };
    expect(calculateIndividual({ ...input, residency: "NON_RESIDENT" }, rules(), "BTN").taxMinor).toBe(0);
    expect(calculateIndividual({ ...input, residency: "NOT_DETERMINED" }, rules(), "BTN").taxMinor).toBeGreaterThan(0);
  });
  it("applies an approved incentive rate", () => {
    const f = { revenueMinor: toMinor(100_000_000), otherIncomeMinor: 0, expensesMinor: toMinor(60_000_000), adjustments: [] };
    const company = classForCompany(rules(), "COMPANY", 2026);
    expect(calculateCorporate(f, rules(), company, undefined, "BTN").taxMinor).toBe(toMinor(6_000_000));
    expect(calculateCorporate(f, rules(), company, d.incentives[0], "BTN").taxMinor).toBe(toMinor(2_000_000));
  });
});

describe("taxpayer classes and tax items", () => {
  const rules = () => ruleSetForYear(d.ruleSets, 2026);
  const admin = () => actor("usr-admin");
  const input = { employment: [{ employerName: "X", months: 12, grossMinor: toMinor(8_000_000), tdsMinor: 0, healthMinor: 0, currency: "BTN", source: "EMPLOYER_DECLARATIONS" as const }], incomeSources: [], reliefs: [], residency: "NOT_DETERMINED" as const };

  it("seeds a publishable rule set", () => {
    expect(() => validateRuleSet(rules())).not.toThrow();
  });
  it("uses the first enabled class in order, and honours its last income year", () => {
    const r = structuredClone(rules());
    r.taxpayerClasses.find((c) => c.key === "IND_NON_CITIZEN_2030")!.enabled = true;
    const foreign = { regime: "INDIVIDUAL" as const, citizenship: "FOREIGN" as const, residency: "NOT_DETERMINED" as const };
    expect(resolveTaxpayerClass(r, foreign, 2030).key).toBe("IND_NON_CITIZEN_2030");
    expect(resolveTaxpayerClass(r, foreign, 2031).key).toBe("IND_STANDARD");
    expect(calculateIndividual({ ...input, citizenship: "FOREIGN", year: 2030 }, r, "BTN").taxMinor).toBe(0);
    expect(calculateIndividual({ ...input, citizenship: "CITIZEN", year: 2030 }, r, "BTN").taxMinor).toBeGreaterThan(0);
  });
  it("leaves foreign-source income out for a class taxed on GMC-source income only", () => {
    const r = structuredClone(rules());
    r.taxpayerClasses.find((c) => c.key === "IND_STANDARD")!.incomeScope = "GMC_SOURCE";
    const src = { id: "f", category: "FOREIGN_EMPLOYMENT", description: "Payslips", payer: "", amountMinor: toMinor(20_000), currency: "USD", periodFrom: "", periodTo: "", classification: "TAXABLE" as const, conversion: convert(d.config, toMinor(20_000), "USD", "2026-12-31"), supportingDocIds: [] };
    const s = calculateIndividual({ ...input, incomeSources: [src], citizenship: "CITIZEN", year: 2026 }, r, "BTN");
    expect(s.figures!.taxableMinor).toBe(toMinor(8_000_000));
    expect(s.lines.some((l) => l.key === "out-of-scope")).toBe(true);
  });
  it("taxes a business class on the Income Tax Act bands when configured", () => {
    const r = structuredClone(rules());
    const sole = r.taxpayerClasses.find((c) => c.key === "CORP_SOLE_PROP")!;
    Object.assign(sole, { rateBasis: "INDIVIDUAL_BANDS", flatRatePct: null });
    const f = { revenueMinor: toMinor(4_000_000), otherIncomeMinor: 0, expensesMinor: 0, adjustments: [] };
    expect(calculateCorporate(f, r, sole, undefined, "BTN").taxMinor).toBe(progressiveTax(toMinor(4_000_000), r.individualBands));
  });
  it("publishes a changed catalogue as a new version and rejects broken ones", () => {
    const base = rules();
    const items = base.taxItems.map((i) => (i.key === "AST_PLANT" ? { ...i, ratePct: 25 } : i));
    const next = publishRuleSet(d, admin(), base.id, { taxItems: items }, "Plant allowance confirmed");
    expect(next.version).not.toBe(base.version);
    expect(ruleSetForYear(d.ruleSets, 2026).taxItems.find((i) => i.key === "AST_PLANT")!.ratePct).toBe(25);
    const noFallback = next.taxpayerClasses.map((c) => (c.key === "IND_STANDARD" ? { ...c, enabled: false } : c));
    expect(() => publishRuleSet(d, admin(), next.id, { taxpayerClasses: noFallback }, "x")).toThrow(/covers/);
    const badRate = next.taxItems.map((i) => (i.key === "AST_PLANT" ? { ...i, ratePct: null } : i));
    expect(() => publishRuleSet(d, admin(), next.id, { taxItems: badRate }, "x")).toThrow(/allowance/);
    const wrongKind = next.taxItems.map((i) => (i.key === "LIA_PROVISIONS" ? { ...i, treatment: "TAXABLE" as const } : i));
    expect(() => publishRuleSet(d, admin(), next.id, { taxItems: wrongKind }, "x")).toThrow(/treatment/);
  });
});

describe("permissions", () => {
  it("stops a taxpayer editing another taxpayer's return", () => {
    const tashiReturn = d.individualReturns.find((r) => r.taxpayerId === "tp-tashi")!;
    expect(() => saveDraft(d, actor("usr-karma"), tashiReturn.id, { declarationAccepted: true })).toThrow(/own records/);
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
    d.config.payBeforeSubmit = false;
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
    // Karma works for Gelephu Green Energy, whose assigned officer is Ugyen: the case goes straight to him.
    expect(d.assessments.find((a) => a.id === ret.assessmentId)).toMatchObject({ status: "ASSIGNED", assignedTo: "usr-ugyen" });
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
    addAdjustment(d, ugyen, tashiCase.id, "Unreported interest", toMinor(10_000), "Found on bank statement");
    completeAssessment(d, ugyen, tashiCase.id, "Assessed with one adjustment.");
    expect(tashiCase.status).toBe("COMPLETED");
    expect(tashiCase.noaDocId).toBeTruthy();
    // Tashi paid the estimated balance with the return, so only the adjustment is owed.
    expect(tashiCase.outcome!.prepaidMinor).toBeGreaterThan(0);
    expect(d.liabilities.find((l) => l.sourceId === tashiCase.id)?.amountMinor).toBe(toMinor(10_000));
  });
});

describe("pay, then submit (version 1 flow)", () => {
  it("blocks direct submission with a balance, then submits on confirmed payment", () => {
    const karma = actor("usr-karma");
    const ret = ensureDraftReturn(d, karma, 2026);
    const doc = uploadDocument(d, karma, { category: "BANK_STATEMENT", fileName: "s.pdf", mimeType: "application/pdf", sizeBytes: 1000, owner: { kind: "INDIVIDUAL", id: "tp-karma" }, related: { kind: "INDIVIDUAL_RETURN", id: ret.id, incomeSourceId: "s1" } });
    saveDraft(d, karma, ret.id, { incomeSources: [{ id: "s1", category: "BUSINESS", description: "Consulting", payer: "Client", amountMinor: toMinor(20_000), currency: "USD", periodFrom: "2026-01-01", periodTo: "2026-10-31", classification: "TAXABLE", bankStatementDocId: doc.id, supportingDocIds: [] }], declarationAccepted: true });
    expect(ret.calculation!.balanceMinor).toBeGreaterThan(0);
    expect(() => submitReturn(d, karma, ret.id)).toThrow(/Pay the balance/);
    const p = payAndSubmit(d, karma, ret.id);
    settlePayment(d, karma, p.id, "PENDING");
    expect(ret.submissionStatus).toBe("DRAFT");
    expect(() => saveDraft(d, karma, ret.id, { declarationAccepted: true })).toThrow(/pending/);
    recheckPayment(d, karma, p.id);
    expect(ret.submissionStatus).toBe("SUBMITTED");
    expect(ret.reference).toMatch(/^IIT-2026-/);
  });
});

describe("payments", () => {
  it("only success reduces the balance; pending then recheck settles", () => {
    const pema = actor("usr-pema");
    const october = d.monthlyDeclarations.find((x) => x.companyId === "co-gge" && x.period === "2026-10")!;
    const l = d.liabilities.find((x) => x.id === october.liabilityId)!;
    const p1 = initiatePayment(d, pema, l.id);
    settlePayment(d, pema, p1.id, "FAILURE");
    expect(l.paidMinor).toBe(0);
    expect(liabilityStatus(d, l)).toBe("FAILED");
    const p2 = initiatePayment(d, pema, l.id);
    settlePayment(d, pema, p2.id, "PENDING");
    expect(liabilityStatus(d, l)).toBe("PENDING");
    expect(() => initiatePayment(d, pema, l.id)).toThrow(/pending/);
    recheckPayment(d, pema, p2.id);
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
    expect(karmaLine.conversion).toMatchObject({ currency: "EUR", rate: 120 });
    submitDeclaration(d, pema, decl.id);
    expect(decl.reference).toMatch(/^TDS-202611-/);
    expect(d.liabilities.find((l) => l.id === decl.liabilityId)?.amountMinor).toBe(decl.calculation!.balanceMinor);
  });
});

describe("easy numbers", () => {
  it("pays round salaries that convert to round ngultrum", () => {
    const oct = d.monthlyDeclarations.find((x) => x.companyId === "co-gge" && x.period === "2026-10")!;
    const nu = Object.fromEntries(oct.lines.map((l) => [l.employeeId, l.conversion!.reportingMinor]));
    expect(nu).toMatchObject({ "emp-karma": toMinor(500_000), "emp-anika": toMinor(1_000_000), "emp-sonam": toMinor(500_000), "emp-lucas": toMinor(3_000_000) });
    expect(oct.lines.find((l) => l.employeeId === "emp-karma")).toMatchObject({ tdsMinor: toMinor(25_000), healthMinor: toMinor(5_000) });
    // Totals come out round too: Nu 8,000,000 pay, Nu 250,000 TDS, Nu 80,000 health.
    expect(oct.calculation!.lines.map((l) => l.amountMinor)).toEqual([toMinor(8_000_000), toMinor(250_000), toMinor(80_000), toMinor(330_000)]);
  });
});

describe("declaration by pay currency", () => {
  it("adds up pay and the amount due per currency, matching the total", () => {
    const oct = d.monthlyDeclarations.find((x) => x.companyId === "co-gge" && x.period === "2026-10")!;
    const rows = declarationByCurrency(oct);
    expect(rows.map((r) => r.currency).sort()).toEqual(["BTN", "INR", "SGD", "USD"]);
    expect(rows.find((r) => r.currency === "USD")).toMatchObject({ employees: 2, payMinor: toMinor(25_000), reportingMinor: toMinor(2_500_000) });
    expect(rows.reduce((s, r) => s + r.dueMinor, 0)).toBe(oct.calculation!.balanceMinor);
  });
});

describe("paid in DK Bank before submitting", () => {
  it("needs a reference and a receipt, then records the month as paid", () => {
    const pema = actor("usr-pema");
    const decl = ensureDeclaration(d, pema, "co-gge", "2026-11");
    expect(() => submitDeclaration(d, pema, decl.id, { bankTransactionRef: "DKB-1", evidenceDocId: "nope" })).toThrow(/receipt/);
    const doc = uploadDocument(d, pema, { category: "PAYMENT_EVIDENCE", fileName: "receipt.pdf", mimeType: "application/pdf", sizeBytes: 1000, owner: { kind: "COMPANY", id: "co-gge" }, related: { kind: "MONTHLY_DECLARATION", id: decl.id } });
    expect(() => submitDeclaration(d, pema, decl.id, { bankTransactionRef: " ", evidenceDocId: doc.id })).toThrow(/reference/);
    submitDeclaration(d, pema, decl.id, { bankTransactionRef: "DKB-TXN-1", evidenceDocId: doc.id });
    const l = d.liabilities.find((x) => x.id === decl.liabilityId)!;
    expect(liabilityStatus(d, l)).toBe("PAID");
    expect(d.payments.find((p) => p.liabilityId === l.id)).toMatchObject({ method: "EVIDENCE", evidenceDocId: doc.id, amountMinor: l.amountMinor });
  });
});

describe("return scope", () => {
  it("keeps foreign nationals to employment income, with no assets step", () => {
    const anika = actor("usr-anika");
    const draft = ensureDraftReturn(d, anika, 2026);
    expect(returnScope(d, draft)).toEqual({ additionalIncome: false, balanceSheet: false });
    expect(() => syncDkBankStatement(d, anika, draft.id)).toThrow(/employment income only/);
    expect(() => saveDraft(d, anika, draft.id, { balanceSheet: [{ id: "x", itemKey: "AST_CASH", description: "Cash", valueMinor: 1, docIds: [] }] })).toThrow(/assets/);
  });

  it("syncs a DK Bank statement into income sources, replacing an earlier sync", () => {
    const karma = actor("usr-karma");
    const ret = d.individualReturns.find((r) => r.taxpayerId === "tp-karma" && r.year === 2026)!;
    syncDkBankStatement(d, karma, ret.id);
    syncDkBankStatement(d, karma, ret.id);
    expect(ret.incomeSources.filter((s) => s.statementSource === "DK_BANK").map((s) => [s.category, s.conversion?.reportingMinor])).toEqual([["RENTAL", toMinor(900_000)], ["INTEREST", toMinor(100_000)]]);
    expect(validateReturn(d, ret).filter((i) => i.step === "income")).toEqual([]);
  });

  it("checks declared assets and liabilities before submission", () => {
    const karma = actor("usr-karma");
    const ret = d.individualReturns.find((r) => r.taxpayerId === "tp-karma" && r.year === 2026)!;
    saveDraft(d, karma, ret.id, { balanceSheet: [{ id: "a", itemKey: "AST_SHARES", description: "", valueMinor: 0, docIds: [] }] });
    expect(validateReturn(d, ret).filter((i) => i.step === "assets").map((i) => i.message)).toEqual(["Investment 1: add a description.", "Investment 1: enter a value greater than zero."]);
    const pema = actor("usr-pema");
    const cit = ensureCorporateDraft(d, pema, "co-gge", 2026);
    saveCorporateDraft(d, pema, cit.id, { balanceSheet: [{ id: "b", itemKey: "LIA_BANK_LOANS", description: "Loan", valueMinor: toMinor(1_000), docIds: [] }] });
    expect(corporateIssues(d, cit).some((i) => i.step === "assets")).toBe(false);
  });
});

describe("sign-in", () => {
  it("checks the password, then asks citizens to approve in Bhutan NDI", () => {
    expect(() => checkCredentials(d, "karma.dorji@demo.gmca.test", "wrong")).toThrow(/email or password/);
    const karma = checkCredentials(d, " Karma.Dorji@demo.gmca.test ", SAMPLE_PASSWORD);
    expect(signInFactor(d, karma)).toBe("NDI");
    expect(startNdiSignIn(d, karma).status).toBe("WAITING");
    expect(signInFactor(d, checkCredentials(d, "ugyen.tshering@gmca.demo.test", SAMPLE_PASSWORD))).toBeNull();
    d.config.integrations.ndi = "FORCE_UNAVAILABLE";
    expect(startNdiSignIn(d, karma).status).toBe("UNAVAILABLE");
    d.config.integrations.ndi = "FORCE_NO_MATCH";
    expect(startNdiSignIn(d, karma).status).toBe("NO_MATCH");
  });
});

describe("one-time codes for foreign nationals and representatives", () => {
  it("sends them a code instead of an NDI request, to the phone on their record", () => {
    const anika = d.users.find((u) => u.id === "usr-anika")!;
    const pema = d.users.find((u) => u.id === "usr-pema")!;
    expect(signInFactor(d, anika)).toBe("OTP");
    expect(signInFactor(d, pema)).toBe("OTP");
    expect(otpDestination(d, pema)).toBe("+975 17 111 222");
    expect(maskDestination("+975 17 111 222")).toBe("•••• 222");
    expect(maskDestination("maya@mvh.demo.test")).toBe("m•••@mvh.demo.test");
  });

  it("accepts the right code once, allows three tries and expires after five minutes", () => {
    const now = 1_000_000;
    const c = issueOtp("+975 17 111 222", now);
    expect(c.code).toMatch(/^\d{6}$/);
    expect(verifyOtp(c, c.code, now + 1000)).toEqual({ ok: true });
    expect(verifyOtp(c, c.code, now + 5 * 60_000 + 1)).toMatchObject({ ok: false, reason: "EXPIRED" });
    const wrong = c.code === "000000" ? "111111" : "000000";
    let r = verifyOtp(c, wrong, now);
    expect(r).toMatchObject({ ok: false, reason: "WRONG", challenge: { attemptsLeft: 2 } });
    r = verifyOtp((r as { challenge: typeof c }).challenge, wrong, now);
    r = verifyOtp((r as { challenge: typeof c }).challenge, wrong, now);
    expect(r).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(verifyOtp((r as { challenge: typeof c }).challenge, c.code, now)).toMatchObject({ ok: false, reason: "LOCKED" });
  });

  it("checks sign-up contact details before a code is sent", () => {
    expect(() => checkNewContact(d, { email: "pema@gge.demo.test", phone: "+975 17 000 001" })).toThrow(/already used/);
    expect(() => checkNewContact(d, { email: "new.person@example.com", phone: "+975 17 000 001" })).not.toThrow();
  });
});

describe("GMCA roles", () => {
  it("splits users and roles (System Admin) from tax rules (Tax Administrator)", () => {
    const deki = actor("usr-admin");
    const tandin = actor("usr-sysadmin");
    expect(() => createStaffUser(d, deki, { name: "New Officer", email: "new.officer@gmca.demo.test", role: "ASSESSOR", title: "" })).toThrow(/role cannot/);
    const u = createStaffUser(d, tandin, { name: "New Officer", email: "new.officer@gmca.demo.test", role: "ASSESSOR", title: "" });
    setStaffRole(d, tandin, u.id, "SYSADMIN");
    expect(u.role).toBe("SYSADMIN");
    expect(() => publishRuleSet(d, tandin, ruleSetForYear(d.ruleSets, 2026).id, { healthRatePct: 2 }, "x")).toThrow(/role cannot/);
    expect(() => setStaffRole(d, tandin, "usr-admin", "ASSESSOR")).toThrow(/tax administrator/);
    setUserStatus(d, tandin, u.id, "DEACTIVATED");
    expect(() => setUserStatus(d, actor(u.id), "usr-sysadmin", "DEACTIVATED")).toThrow();
  });
});

describe("officer assignments by organization", () => {
  it("sends returns from an organization and its employees to the assigned officer", () => {
    expect(officerForOwner(d, { kind: "COMPANY", id: "co-gge" })).toBe("usr-ugyen");
    expect(officerForOwner(d, { kind: "INDIVIDUAL", id: "tp-anika" })).toBe("usr-ugyen");
    expect(officerForOwner(d, { kind: "INDIVIDUAL", id: "tp-tashi" })).toBeUndefined();
    expect(() => setOrganizationOfficer(d, actor("usr-ugyen"), "co-gge", "usr-kinley")).toThrow(/role cannot/);
    expect(() => setOrganizationOfficer(d, actor("usr-admin"), "co-gge", "usr-pema")).toThrow(/tax officer/);
    // One officer can cover several organizations.
    setOrganizationOfficer(d, actor("usr-admin"), "co-gge", "usr-kinley");
    expect(d.officerAssignments.filter((a) => a.officerId === "usr-kinley").map((a) => a.companyId).sort()).toEqual(["co-gge", "co-mvh"]);
    const anika = actor("usr-anika");
    const ret = ensureDraftReturn(d, anika, 2026);
    saveDraft(d, anika, ret.id, { declarationAccepted: true });
    settlePayment(d, anika, payAndSubmit(d, anika, ret.id).id, "SUCCESS");
    expect(d.assessments.find((a) => a.id === ret.assessmentId)).toMatchObject({ status: "ASSIGNED", assignedTo: "usr-kinley" });
  });
});

describe("rule impact workbook", () => {
  it("builds an .xlsx with the demo taxpayer, the rules and live formulas", () => {
    const rules = ruleSetForYear(d.ruleSets, 2026);
    const wb = buildRuleWorkbook(d, rules, "reliefs", { draft: true });
    expect(wb.fileName).toBe("GMCA-rule-impact-FY2026-draft.xlsx");
    expect(String.fromCharCode(wb.bytes[0]!, wb.bytes[1]!)).toBe("PK");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Read me", "Individual tax", "Monthly TDS", "Reliefs", "Classification", "Corporate tax", "Currencies"]);
    const ind = wb.sheets[1]!;
    expect(ind.rows[5]).toEqual(["Monthly salary (Nu)", { v: 500_000, style: "input" }]);
    expect(JSON.stringify(ind.rows)).toContain("'Monthly TDS'!$B$");
    expect(new TextDecoder().decode(wb.bytes)).toContain('activeTab="3"');
  });
});

describe("rules per financial year", () => {
  it("publishes the first rule set for a new year without touching earlier years", () => {
    const base = ruleSetForYear(d.ruleSets, 2027);
    expect(base.effectiveFromYear).toBe(2026);
    const next = publishRuleSet(d, actor("usr-admin"), base.id, { effectiveFromYear: 2027, healthRatePct: 2 }, "2027 health rate");
    expect(next).toMatchObject({ effectiveFromYear: 2027, version: "FY2027.1", status: "ACTIVE" });
    expect(ruleSetForYear(d.ruleSets, 2027).id).toBe(next.id);
    expect(ruleSetForYear(d.ruleSets, 2026).id).toBe(base.id);
    expect(() => publishRuleSet(d, actor("usr-admin"), base.id, { effectiveFromYear: 1999 }, "x")).toThrow(/2025 to 2100/);
    // Any future year can be set directly, not only the next one.
    expect(publishRuleSet(d, actor("usr-admin"), base.id, { effectiveFromYear: 2035 }, "Long-range plan")).toMatchObject({ version: "FY2035.1" });
    expect(ruleSetForYear(d.ruleSets, 2034).effectiveFromYear).toBe(2027);
  });
});

describe("tax officer records", () => {
  it("lets a tax officer, not an administrator, record residency", () => {
    setResidency(d, actor("usr-ugyen"), "tp-karma", "RESIDENT", "Lives in GMC all year");
    expect(d.taxpayers.find((t) => t.id === "tp-karma")?.residencyStatus).toBe("RESIDENT");
    expect(() => setResidency(d, actor("usr-admin"), "tp-karma", "NON_RESIDENT", "x")).toThrow(/role/);
  });
});

describe("foreign taxpayer happy path", () => {
  it("files 2026 from the employer's figures and submits once DK Bank confirms", () => {
    const anika = actor("usr-anika");
    const ret = ensureDraftReturn(d, anika, 2026);
    saveDraft(d, anika, ret.id, { declarationAccepted: true });
    expect(ret.calculation!.balanceMinor).toBe(toMinor(170_000));
    settlePayment(d, anika, payAndSubmit(d, anika, ret.id).id, "SUCCESS");
    expect(ret.submissionStatus).toBe("SUBMITTED");
  });
});
