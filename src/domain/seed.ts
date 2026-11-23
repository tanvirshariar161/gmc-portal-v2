import type { Actor } from "./store";
import type { Company, Db, Employee, IncomeSource, IndividualTaxpayer, ReliefClaim, TaxRuleSet, User } from "./types";
import { withClock } from "../services/clock";
import { uploadDocument } from "../services/documents";
import { ensureDraftReturn, saveDraft, submitReturn } from "../services/individual";
import { ensureCorporateDraft, ensureDeclaration, saveCorporateDraft, saveDeclarationLines, submitDeclaration, submitCorporate } from "../services/employer";
import { addAdjustment, assignToMe, completeAssessment, recordVerification, requestInformation, respondToRequest, startReview, addNote } from "../services/assessment";
import { initiatePayment, settlePayment } from "../services/payments";
import { toMinor } from "../lib/money";

/**
 * Fictional demonstration data. Identifiers use obviously synthetic patterns
 * (CID 1000000000x, WP-DEMO-…, DEMO-xx-…, GMC-UEN-…). History before FY2026 is demo
 * data for the presentation only; it does not represent migrated legacy records.
 */

const SEED_AT = "2025-01-01T08:00:00.000Z";
const k = (major: number) => toMinor(major);

const DEMO_RULES = (id: string, version: string, year: number): TaxRuleSet => ({
  id,
  version,
  label: `Income Tax Act 2025 bands and GMCA TDS table (${year})`,
  effectiveFromYear: year,
  status: "ACTIVE",
  individualBands: [
    { fromMinor: 0, toMinor: k(10_000), ratePct: 0 },
    { fromMinor: k(10_000), toMinor: k(30_000), ratePct: 5 },
    { fromMinor: k(30_000), toMinor: k(60_000), ratePct: 7 },
    { fromMinor: k(60_000), toMinor: k(100_000), ratePct: 9 },
    { fromMinor: k(100_000), toMinor: k(200_000), ratePct: 11 },
    { fromMinor: k(200_000), toMinor: k(500_000), ratePct: 13 },
    { fromMinor: k(500_000), toMinor: null, ratePct: 15 }
  ],
  nonResidentRatePct: 0,
  tdsMethod: "BRACKET_WHOLE_AMOUNT",
  tdsBands: [
    { fromMinor: 0, toMinor: k(1_000), ratePct: 0 },
    { fromMinor: k(1_000), toMinor: k(3_000), ratePct: 2 },
    { fromMinor: k(3_000), toMinor: k(25_000), ratePct: 5 },
    { fromMinor: k(25_000), toMinor: null, ratePct: 10 }
  ],
  healthRatePct: 1,
  healthAppliesTo: "ALL",
  corporateRatePct: 15,
  reliefs: [
    { key: "SPOUSE", label: "Spouse relief", description: "For a taxpayer supporting a spouse. Demo value.", capMinor: k(2_000), evidenceExamples: ["Marriage certificate"], enabled: true },
    { key: "DISABILITY", label: "Disability relief", description: "For a taxpayer or dependant with a certified disability. Demo value.", capMinor: k(3_000), evidenceExamples: ["Disability certificate from a recognised medical board"], enabled: true },
    { key: "CHILD_EDUCATION", label: "Child education relief", description: "School fees for dependent children. Demo value.", capMinor: k(1_500), evidenceExamples: ["School fee receipts", "Birth certificate"], enabled: true },
    { key: "LIFE_INSURANCE", label: "Life insurance premium", description: "Premiums on a life policy for the taxpayer. Demo value.", capMinor: k(1_000), evidenceExamples: ["Premium statement from the insurer"], enabled: true }
  ],
  incomeCategories: [
    { key: "RENTAL", label: "Rental income", defaultClassification: "TAXABLE" },
    { key: "BUSINESS", label: "Business or professional income", defaultClassification: "TAXABLE" },
    { key: "DIVIDEND", label: "Dividends", defaultClassification: "TAXABLE" },
    { key: "INTEREST", label: "Interest", defaultClassification: "TAXABLE" },
    { key: "FOREIGN_EMPLOYMENT", label: "Employment income outside GMC", defaultClassification: "TAXABLE" },
    { key: "GIFT", label: "Gifts and inheritance", defaultClassification: "EXEMPT" },
    { key: "OTHER", label: "Other income", defaultClassification: "TAXABLE" }
  ],
  excessCreditCarryForward: null,
  createdBy: "usr-admin",
  createdAt: SEED_AT
});

function verified(provider: "NDI" | "IMMIGRATION" | "COMPANY_REGISTRY", ref: string) {
  return { provider, status: "VERIFIED" as const, reference: ref, checkedAt: SEED_AT, simulated: true as const };
}

function base(): Db {
  const users: User[] = [
    { id: "usr-karma", name: "Karma Dorji", email: "karma.dorji@demo.gmca.test", role: "INDIVIDUAL", status: "ACTIVE", taxpayerId: "tp-karma", createdAt: SEED_AT, demoLabel: "Citizen taxpayer" },
    { id: "usr-anika", name: "Anika Rao", email: "anika.rao@demo.gmca.test", role: "INDIVIDUAL", status: "ACTIVE", taxpayerId: "tp-anika", createdAt: SEED_AT, demoLabel: "Foreign taxpayer" },
    { id: "usr-pema", name: "Pema Wangchuk", email: "pema@gge.demo.test", role: "EMPLOYER", status: "ACTIVE", companyId: "co-gge", title: "Director", createdAt: SEED_AT, demoLabel: "Employer representative" },
    { id: "usr-ugyen", name: "Ugyen Tshering", email: "ugyen.tshering@gmca.demo.test", role: "ASSESSOR", status: "ACTIVE", title: "Tax Officer (Assessment)", createdAt: SEED_AT, demoLabel: "GMCA assessor" },
    { id: "usr-admin", name: "Deki Pelden", email: "deki.pelden@gmca.demo.test", role: "ADMIN", status: "ACTIVE", title: "System Administrator", createdAt: SEED_AT, demoLabel: "GMCA administrator" },
    { id: "usr-sonam", name: "Sonam Choden", email: "sonam.choden@demo.gmca.test", role: "INDIVIDUAL", status: "ACTIVE", taxpayerId: "tp-sonam", createdAt: SEED_AT },
    { id: "usr-tashi", name: "Tashi Namgay", email: "tashi.namgay@demo.gmca.test", role: "INDIVIDUAL", status: "ACTIVE", taxpayerId: "tp-tashi", createdAt: SEED_AT },
    { id: "usr-lucas", name: "Lucas Tan", email: "lucas.tan@demo.gmca.test", role: "INDIVIDUAL", status: "ACTIVE", taxpayerId: "tp-lucas", createdAt: SEED_AT },
    { id: "usr-maya", name: "Maya Fischer", email: "maya@mvh.demo.test", role: "EMPLOYER", status: "ACTIVE", companyId: "co-mvh", title: "General Manager", createdAt: SEED_AT },
    { id: "usr-kinley", name: "Kinley Wangmo", email: "kinley.wangmo@gmca.demo.test", role: "ASSESSOR", status: "ACTIVE", title: "Senior Tax Officer", createdAt: SEED_AT }
  ];

  const tp = (t: Omit<IndividualTaxpayer, "registeredAt" | "phone" | "address" | "email"> & { email: string }): IndividualTaxpayer => ({ phone: "+975 17 000 000", address: "Gelephu (demo address)", registeredAt: SEED_AT, ...t });
  const taxpayers: IndividualTaxpayer[] = [
    tp({ id: "tp-karma", tin: "TIN-000101", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000001", fullName: "Karma Dorji", dateOfBirth: "1988-04-12", nationality: "Bhutanese", email: "karma.dorji@demo.gmca.test", residencyStatus: "NOT_DETERMINED", verification: verified("NDI", "NDI-SIM-SEED01"), employmentSummary: { employer: "Gelephu Green Energy Pvt Ltd (demo)", position: "Site Operations Lead", since: "2025-04-01" } }),
    tp({ id: "tp-anika", tin: "TIN-000102", category: "FOREIGN", identifierType: "WORK_PERMIT", identifierValue: "WP-DEMO-2026-0001", fullName: "Anika Rao", dateOfBirth: "1987-02-14", nationality: "Indian", email: "anika.rao@demo.gmca.test", residencyStatus: "NOT_DETERMINED", verification: verified("IMMIGRATION", "IMM-SIM-SEED01"), employmentSummary: { employer: "Gelephu Green Energy Pvt Ltd (demo)", position: "Senior Engineer", since: "2025-04-01", permitExpiry: "2028-03-31" } }),
    tp({ id: "tp-sonam", tin: "TIN-000103", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000002", fullName: "Sonam Choden", dateOfBirth: "1992-09-03", nationality: "Bhutanese", email: "sonam.choden@demo.gmca.test", residencyStatus: "NOT_DETERMINED", verification: verified("NDI", "NDI-SIM-SEED02") }),
    tp({ id: "tp-tashi", tin: "TIN-000104", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000005", fullName: "Tashi Namgay", dateOfBirth: "1990-11-30", nationality: "Bhutanese", email: "tashi.namgay@demo.gmca.test", residencyStatus: "NOT_DETERMINED", verification: verified("NDI", "NDI-SIM-SEED03") }),
    tp({ id: "tp-lucas", tin: "TIN-000105", category: "FOREIGN", identifierType: "WORK_PERMIT", identifierValue: "WP-DEMO-2026-0002", fullName: "Lucas Tan", dateOfBirth: "1991-07-08", nationality: "Singaporean", email: "lucas.tan@demo.gmca.test", residencyStatus: "NON_RESIDENT", verification: verified("IMMIGRATION", "IMM-SIM-SEED02"), employmentSummary: { employer: "Gelephu Green Energy Pvt Ltd (demo)", position: "Finance Manager", since: "2025-09-15", permitExpiry: "2027-12-31" } })
  ];

  const co = (c: Omit<Company, "registeredAt">): Company => ({ ...c, registeredAt: SEED_AT });
  const companies: Company[] = [
    co({ id: "co-gge", uen: "GMC-UEN-2025-0001", name: "Gelephu Green Energy Pvt Ltd (demo)", type: "COMPANY", sector: "Renewable energy", registeredAddress: "Plot 14, Energy Park, Gelephu (demo)", incorporatedOn: "2025-02-10", verification: verified("COMPANY_REGISTRY", "CRS-SIM-SEED01"), representatives: [{ name: "Pema Wangchuk", designation: "Director", email: "pema@gge.demo.test", phone: "+975 17 111 222" }] }),
    co({ id: "co-mvh", uen: "GMC-UEN-2025-0002", name: "Mindful Valley Hospitality (demo)", type: "COMPANY", sector: "Hospitality", registeredAddress: "Riverside Road 3, Gelephu (demo)", incorporatedOn: "2025-06-01", verification: verified("COMPANY_REGISTRY", "CRS-SIM-SEED02"), representatives: [{ name: "Maya Fischer", designation: "General Manager", email: "maya@mvh.demo.test", phone: "+975 17 333 444" }] })
  ];

  const emp = (e: Omit<Employee, "verification"> & { verified?: boolean }): Employee => {
    const { verified: v = true, ...rest } = e;
    return { ...rest, verification: { provider: e.category === "FOREIGN" ? "IMMIGRATION" : "NDI", status: v ? "VERIFIED" : "NOT_VERIFIED", checkedAt: SEED_AT, simulated: true } };
  };
  const employees: Employee[] = [
    emp({ id: "emp-pema", companyId: "co-gge", fullName: "Pema Wangchuk", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000003", position: "Director", startDate: "2025-02-10", status: "ACTIVE", defaultCurrency: "USD" }),
    emp({ id: "emp-karma", companyId: "co-gge", fullName: "Karma Dorji", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000001", taxpayerId: "tp-karma", position: "Site Operations Lead", startDate: "2025-04-01", status: "ACTIVE", defaultCurrency: "USD" }),
    emp({ id: "emp-anika", companyId: "co-gge", fullName: "Anika Rao", category: "FOREIGN", identifierType: "WORK_PERMIT", identifierValue: "WP-DEMO-2026-0001", taxpayerId: "tp-anika", position: "Senior Engineer", startDate: "2025-04-01", status: "ACTIVE", defaultCurrency: "INR" }),
    emp({ id: "emp-sonam", companyId: "co-gge", fullName: "Sonam Choden", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000002", taxpayerId: "tp-sonam", position: "HR Officer", startDate: "2025-04-01", status: "ACTIVE", defaultCurrency: "BTN" }),
    emp({ id: "emp-lucas", companyId: "co-gge", fullName: "Lucas Tan", category: "FOREIGN", identifierType: "WORK_PERMIT", identifierValue: "WP-DEMO-2026-0002", taxpayerId: "tp-lucas", position: "Finance Manager", startDate: "2025-09-15", status: "ACTIVE", defaultCurrency: "SGD" }),
    emp({ id: "emp-jigme", companyId: "co-gge", fullName: "Jigme Tenzin", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000006", position: "Electrician", startDate: "2025-05-01", endDate: "2026-06-30", status: "LEFT", defaultCurrency: "BTN", verified: false }),
    emp({ id: "emp-yeshi", companyId: "co-gge", fullName: "Yeshi Lhamo", category: "CITIZEN", identifierType: "CID", identifierValue: "10000000007", position: "Procurement Assistant", startDate: "2026-02-01", status: "ON_LEAVE", defaultCurrency: "BTN", verified: false }),
    emp({ id: "emp-maya", companyId: "co-mvh", fullName: "Maya Fischer", category: "FOREIGN", identifierType: "WORK_PERMIT", identifierValue: "WP-DEMO-2026-0003", position: "General Manager", startDate: "2026-01-10", status: "ACTIVE", defaultCurrency: "EUR" }),
    emp({ id: "emp-niran", companyId: "co-mvh", fullName: "Niran Chaiyaporn", category: "FOREIGN", identifierType: "PASSPORT", identifierValue: "DEMO-TH-5521", position: "Chef de Cuisine", startDate: "2026-02-01", status: "ACTIVE", defaultCurrency: "THB" })
  ];

  return {
    schemaVersion: 5,
    seededAt: new Date().toISOString(),
    counters: {},
    users,
    taxpayers,
    companies,
    incentives: [
      { id: "inc-gge", companyId: "co-gge", ratePct: 5, effectiveFrom: "2025-01-01", effectiveTo: "2029-12-31", approvalReference: "GMCA-INC-DEMO-0001", notes: "Approved outside the platform. Demo record.", recordedBy: "usr-admin", recordedAt: SEED_AT, status: "ACTIVE" }
    ],
    employees,
    individualReturns: [],
    monthlyDeclarations: [],
    corporateReturns: [],
    assessments: [],
    infoRequests: [],
    liabilities: [],
    payments: [],
    documents: [],
    notifications: [],
    audit: [],
    integrationEvents: [],
    ruleSets: [DEMO_RULES("rules-2025", "DEMO-2025.1", 2025), DEMO_RULES("rules-2026", "DEMO-2026.1", 2026)],
    config: {
      reportingCurrency: "USD",
      conversionDateRule: "PERIOD_END",
      currencies: [
        { code: "USD", name: "US dollar", enabled: true },
        { code: "BTN", name: "Bhutanese ngultrum", enabled: true },
        { code: "INR", name: "Indian rupee", enabled: true },
        { code: "SGD", name: "Singapore dollar", enabled: true },
        { code: "THB", name: "Thai baht", enabled: true },
        { code: "EUR", name: "Euro", enabled: true },
        { code: "GBP", name: "Pound sterling", enabled: true },
        { code: "AUD", name: "Australian dollar", enabled: false }
      ],
      exchangeRates: [
        ...[["BTN", 0.0119], ["INR", 0.0119], ["SGD", 0.74], ["THB", 0.028], ["EUR", 1.08]].map(([c, r], i) => ({ id: `fx-25-${i}`, currency: c as string, rate: r as number, effectiveDate: "2025-01-01", source: "Demo rate", isDemo: true })),
        ...[["BTN", 0.0118], ["INR", 0.0118], ["SGD", 0.75], ["THB", 0.029], ["EUR", 1.1], ["AUD", 0.65]].map(([c, r], i) => ({ id: `fx-26-${i}`, currency: c as string, rate: r as number, effectiveDate: "2026-01-01", source: "Demo rate", isDemo: true })),
        // GMCA TDS note: US$1 = Nu 96.35 as at 30 Apr 2026, so Nu 96,350 = US$1,000 exactly.
        { id: "fx-gmca-btn-2026-04", currency: "BTN", rate: 1 / 96.35, effectiveDate: "2026-04-30", source: "GMCA TDS note (US$1 = Nu 96.35)", isDemo: false }
      ],
      informationRequestDays: 14,
      currentFilingYear: 2026,
      filingDeadlineMonthDay: "04-30",
      currentPayrollPeriod: "2026-11",
      integrations: { ndi: "SEEDED", immigration: "SEEDED", companyRegistry: "SEEDED", dkBank: "CHOOSE", pendingResolvesTo: "SUCCESS" }
    }
  };
}

const actorOf = (d: Db, id: string): Actor => {
  const u = d.users.find((x) => x.id === id)!;
  return { id: u.id, name: u.name, role: u.role, taxpayerId: u.taxpayerId, companyId: u.companyId };
};

const PAY: Record<string, [number, string]> = {
  "emp-pema": [6_500, "USD"],
  "emp-karma": [4_200, "USD"],
  "emp-anika": [350_000, "INR"],
  "emp-sonam": [95_000, "BTN"],
  "emp-lucas": [7_500, "SGD"],
  "emp-jigme": [60_000, "BTN"],
  "emp-yeshi": [70_000, "BTN"],
  "emp-maya": [6_000, "EUR"],
  "emp-niran": [120_000, "THB"]
};

function months(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function nextMonthDay(period: string, day: number) {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}T09:30:00.000Z`;
}

function seedPayroll(d: Db, userId: string, companyId: string, from: string, to: string, leaveUnpaid: string[]) {
  const actor = actorOf(d, userId);
  for (const period of months(from, to)) {
    withClock(nextMonthDay(period, 8), () => {
      const decl = ensureDeclaration(d, actor, companyId, period);
      saveDeclarationLines(d, actor, decl.id, decl.lines.map((l) => ({ employeeId: l.employeeId, amountMinor: k(PAY[l.employeeId]![0]), currency: PAY[l.employeeId]![1] })));
      submitDeclaration(d, actor, decl.id);
      if (decl.liabilityId && !leaveUnpaid.includes(period)) {
        const p = initiatePayment(d, actor, decl.liabilityId);
        settlePayment(d, actor, p.id, "SUCCESS");
      }
    });
  }
}

function seededUpload(d: Db, actor: Actor, category: Parameters<typeof uploadDocument>[2]["category"], fileName: string, related: Parameters<typeof uploadDocument>[2]["related"], owner: Parameters<typeof uploadDocument>[2]["owner"]) {
  const doc = uploadDocument(d, actor, { category, fileName, mimeType: "application/pdf", sizeBytes: 180_000 + fileName.length * 1_000, owner, related });
  doc.demoSeeded = true;
  return doc;
}

function fileIndividual(d: Db, userId: string, year: number, at: string, sources: Omit<IncomeSource, "id" | "bankStatementDocId" | "supportingDocIds">[], reliefs: { key: string; amount: number; file: string }[], submit = true) {
  const actor = actorOf(d, userId);
  return withClock(at, () => {
    const ret = ensureDraftReturn(d, actor, year);
    const owner = { kind: "INDIVIDUAL" as const, id: actor.taxpayerId! };
    const srcs: IncomeSource[] = sources.map((s, i) => {
      const id = `${ret.id}-src-${i + 1}`;
      const doc = seededUpload(d, actor, "BANK_STATEMENT", `bank-statement-${s.category.toLowerCase()}-${year}.pdf`, { kind: "INDIVIDUAL_RETURN", id: ret.id, incomeSourceId: id }, owner);
      return { ...s, id, bankStatementDocId: doc.id, supportingDocIds: [] };
    });
    const rels: ReliefClaim[] = reliefs.map((r, i) => {
      const id = `${ret.id}-rel-${i + 1}`;
      const doc = seededUpload(d, actor, "RELIEF_EVIDENCE", r.file, { kind: "INDIVIDUAL_RETURN", id: ret.id, reliefId: id }, owner);
      return { id, reliefKey: r.key, declaredMinor: k(r.amount), note: "", docIds: [doc.id] };
    });
    saveDraft(d, actor, ret.id, { incomeSources: srcs, reliefs: rels, declarationAccepted: submit });
    if (submit) submitReturn(d, actor, ret.id);
    return ret;
  });
}

function assess(d: Db, assessorId: string, assessmentId: string, steps: { at: string; to: "ASSIGNED" | "UNDER_REVIEW" | "INFO" | "COMPLETED"; summary?: string; adjustment?: [string, number, string]; info?: [string, string[]] }[]) {
  const actor = actorOf(d, assessorId);
  for (const s of steps) {
    withClock(s.at, () => {
      if (s.to === "ASSIGNED") assignToMe(d, actor, assessmentId);
      if (s.to === "UNDER_REVIEW") startReview(d, actor, assessmentId);
      if (s.to === "INFO") requestInformation(d, actor, assessmentId, s.info![0], s.info![1]);
      if (s.to === "COMPLETED") {
        startReview(d, actor, assessmentId);
        recordVerification(d, actor, assessmentId, "VERIFIED", "");
        if (s.adjustment) addAdjustment(d, actor, assessmentId, s.adjustment[0], k(s.adjustment[1]), s.adjustment[2]);
        completeAssessment(d, actor, assessmentId, s.summary ?? "Return reviewed. Declared income agrees with employer declarations and evidence.");
      }
    });
  }
}

export function buildSeed(): Db {
  const d = base();

  // Employer monthly declarations: paid history, latest month left outstanding for the demo.
  seedPayroll(d, "usr-pema", "co-gge", "2025-04", "2026-10", ["2026-10"]);
  seedPayroll(d, "usr-maya", "co-mvh", "2026-01", "2026-10", []);

  // Karma Dorji · FY2025: submitted, assessed, paid. The historical example with certificates.
  const k25 = fileIndividual(d, "usr-karma", 2025, "2026-03-14T10:12:00.000Z", [
    { category: "BUSINESS", description: "Freelance site surveys", payer: "Various clients (demo)", amountMinor: k(12_000), currency: "USD", periodFrom: "2025-01-01", periodTo: "2025-12-31", classification: "TAXABLE" },
    { category: "RENTAL", description: "Apartment rent, Sarpang", payer: "Tenant (demo)", amountMinor: k(240_000), currency: "BTN", periodFrom: "2025-01-01", periodTo: "2025-12-31", classification: "TAXABLE" }
  ], [{ key: "SPOUSE", amount: 2_000, file: "marriage-certificate.pdf" }]);
  assess(d, "usr-ugyen", k25.assessmentId!, [
    { at: "2026-03-20T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-04-18T11:00:00.000Z", to: "COMPLETED" }
  ]);
  const karmaLiability = d.liabilities.find((l) => l.sourceId === k25.assessmentId);
  if (karmaLiability) withClock("2026-04-25T07:45:00.000Z", () => {
    const a = actorOf(d, "usr-karma");
    const p = initiatePayment(d, a, karmaLiability.id);
    settlePayment(d, a, p.id, "SUCCESS");
  });

  // Karma Dorji · FY2026: draft in progress (live demo continues from here).
  fileIndividual(d, "usr-karma", 2026, "2026-11-20T15:20:00.000Z", [], [], false);

  // Anika Rao · FY2025: assessed, balance unpaid (foreign taxpayer pays in the demo).
  const a25 = fileIndividual(d, "usr-anika", 2025, "2026-03-28T09:00:00.000Z", [
    { category: "INTEREST", description: "Savings interest, Bengaluru", payer: "Bank in India (demo)", amountMinor: k(180_000), currency: "INR", periodFrom: "2025-01-01", periodTo: "2025-12-31", classification: "TAXABLE" },
    { category: "GIFT", description: "Gift from parents", payer: "Family (demo)", amountMinor: k(300_000), currency: "INR", periodFrom: "2025-06-01", periodTo: "2025-06-30", classification: "EXEMPT" }
  ], [{ key: "LIFE_INSURANCE", amount: 800, file: "insurance-premium-statement.pdf" }]);
  assess(d, "usr-ugyen", a25.assessmentId!, [
    { at: "2026-04-02T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-05-02T10:30:00.000Z", to: "COMPLETED", adjustment: ["Consultancy fee omitted from return", 420, "Payment of USD 6,000 found on the bank statement for the interest account; taxed at the marginal demo rate."], summary: "Assessed with one adjustment for income found on the supporting bank statement." }
  ]);

  // Anika Rao · FY2026: submitted, GMCA needs more information.
  const a26 = fileIndividual(d, "usr-anika", 2026, "2026-11-10T12:00:00.000Z", [
    { category: "FOREIGN_EMPLOYMENT", description: "Remote advisory work for former employer", payer: "Engineering firm, Singapore (demo)", amountMinor: k(9_000), currency: "SGD", periodFrom: "2026-01-01", periodTo: "2026-06-30", classification: "TAXABLE" }
  ], []);
  assess(d, "usr-ugyen", a26.assessmentId!, [
    { at: "2026-11-12T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-11-13T09:00:00.000Z", to: "UNDER_REVIEW" },
    { at: "2026-11-14T10:00:00.000Z", to: "INFO", info: ["Please send the advisory contract and confirm whether this work was performed while you were in GMC.", ["Signed advisory contract", "Travel record for January to June 2026"]] }
  ]);

  // Sonam Choden · FY2026: responded to a request.
  const s26 = fileIndividual(d, "usr-sonam", 2026, "2026-11-05T08:30:00.000Z", [
    { category: "DIVIDEND", description: "Dividends from a Thimphu company", payer: "Listed company (demo)", amountMinor: k(85_000), currency: "BTN", periodFrom: "2026-01-01", periodTo: "2026-09-30", classification: "TAXABLE" }
  ], [{ key: "DISABILITY", amount: 3_000, file: "disability-certificate.pdf" }]);
  assess(d, "usr-ugyen", s26.assessmentId!, [
    { at: "2026-11-06T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-11-07T08:00:00.000Z", to: "UNDER_REVIEW" },
    { at: "2026-11-07T09:00:00.000Z", to: "INFO", info: ["The disability certificate has expired. Please upload the current certificate.", ["Current disability certificate"]] }
  ]);
  withClock("2026-11-18T14:10:00.000Z", () => {
    const actor = actorOf(d, "usr-sonam");
    const req = d.infoRequests.find((r) => r.assessmentId === s26.assessmentId)!;
    const doc = seededUpload(d, actor, "INFO_RESPONSE", "disability-certificate-renewed.pdf", { kind: "INFO_REQUEST", id: req.id }, req.owner);
    respondToRequest(d, actor, req.id, "Attached is the renewed certificate issued in October 2026.", [doc.id]);
  });

  // Tashi Namgay · FY2026: waiting to be assigned.
  fileIndividual(d, "usr-tashi", 2026, "2026-11-18T16:45:00.000Z", [
    { category: "BUSINESS", description: "Software consultancy", payer: "Druk Digital Labs (demo)", amountMinor: k(30_000), currency: "USD", periodFrom: "2026-01-01", periodTo: "2026-10-31", classification: "TAXABLE" }
  ], [{ key: "CHILD_EDUCATION", amount: 1_200, file: "school-fee-receipts.pdf" }]);

  // Lucas Tan · FY2026: non-resident (recorded by GMCA), assigned to another officer.
  const l26 = fileIndividual(d, "usr-lucas", 2026, "2026-11-08T11:00:00.000Z", [], []);
  assess(d, "usr-kinley", l26.assessmentId!, [
    { at: "2026-11-09T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-11-10T08:00:00.000Z", to: "UNDER_REVIEW" }
  ]);
  withClock("2026-11-10T09:00:00.000Z", () => addNote(d, actorOf(d, "usr-kinley"), l26.assessmentId!, "Non-resident status recorded by GMCA administration. Checking the demo non-resident rate is applied."));

  // Corporate returns FY2025.
  const pema = actorOf(d, "usr-pema");
  const gge = withClock("2026-06-10T10:00:00.000Z", () => {
    const r = ensureCorporateDraft(d, pema, "co-gge", 2025);
    const owner = { kind: "COMPANY" as const, id: "co-gge" };
    const fs = seededUpload(d, pema, "AUDITED_FINANCIALS", "gge-audited-financial-statements-2025.pdf", { kind: "CORPORATE_RETURN", id: r.id }, owner);
    const fa = seededUpload(d, pema, "FIXED_ASSET_REPORT", "gge-fixed-asset-register-2025.pdf", { kind: "CORPORATE_RETURN", id: r.id }, owner);
    saveCorporateDraft(d, pema, r.id, { financials: { revenueMinor: k(2_450_000), otherIncomeMinor: k(35_000), expensesMinor: k(1_720_000), adjustments: [{ id: "adj-1", label: "Entertainment expenses added back", amountMinor: k(18_000) }] }, auditedFsDocIds: [fs.id], fixedAssetDocIds: [fa.id], declarationAccepted: true });
    submitCorporate(d, pema, r.id);
    return r;
  });
  assess(d, "usr-ugyen", gge.assessmentId!, [
    { at: "2026-06-15T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-08-04T09:00:00.000Z", to: "COMPLETED", summary: "Assessed at the approved incentive rate recorded by GMCA (GMCA-INC-DEMO-0001)." }
  ]);
  const ggeLiability = d.liabilities.find((l) => l.sourceId === gge.assessmentId);
  if (ggeLiability) withClock("2026-08-20T06:30:00.000Z", () => {
    const p = initiatePayment(d, pema, ggeLiability.id);
    settlePayment(d, pema, p.id, "SUCCESS");
  });

  const maya = actorOf(d, "usr-maya");
  const mvh = withClock("2026-07-01T10:00:00.000Z", () => {
    const r = ensureCorporateDraft(d, maya, "co-mvh", 2025);
    const owner = { kind: "COMPANY" as const, id: "co-mvh" };
    const fs = seededUpload(d, maya, "AUDITED_FINANCIALS", "mvh-audited-financial-statements-2025.pdf", { kind: "CORPORATE_RETURN", id: r.id }, owner);
    const fa = seededUpload(d, maya, "FIXED_ASSET_REPORT", "mvh-fixed-assets-2025.pdf", { kind: "CORPORATE_RETURN", id: r.id }, owner);
    saveCorporateDraft(d, maya, r.id, { financials: { revenueMinor: k(640_000), otherIncomeMinor: 0, expensesMinor: k(590_000), adjustments: [] }, auditedFsDocIds: [fs.id], fixedAssetDocIds: [fa.id], declarationAccepted: true });
    submitCorporate(d, maya, r.id);
    return r;
  });
  assess(d, "usr-kinley", mvh.assessmentId!, [
    { at: "2026-07-03T08:00:00.000Z", to: "ASSIGNED" },
    { at: "2026-07-05T08:00:00.000Z", to: "UNDER_REVIEW" },
    { at: "2026-11-16T08:00:00.000Z", to: "INFO", info: ["The fixed asset report lists kitchen equipment bought in 2024, before incorporation. Please explain how these assets were acquired.", ["Purchase invoices or transfer agreement"]] }
  ]);

  // Older notifications count as read so the demo inbox shows only recent activity.
  for (const n of d.notifications) if (n.createdAt < "2026-11-01") n.readBy = ["*"];
  for (const r of d.individualReturns) if (r.year < 2026) r.demoSeeded = true;
  for (const r of d.corporateReturns) r.demoSeeded = true;
  return d;
}
