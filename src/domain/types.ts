import type { Minor } from "../lib/money";

export type ID = string;

// ---------- Users and roles ----------

export type Role = "INDIVIDUAL" | "EMPLOYER" | "ASSESSOR" | "ADMIN";

export type User = {
  id: ID;
  name: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "DEACTIVATED";
  taxpayerId?: ID;
  companyId?: ID;
  /** Officer or administrator job title shown in GMCA screens. */
  title?: string;
  createdAt: string;
  lastSignInAt?: string;
  demoLabel?: string;
};

// ---------- Parties ----------

export type TaxpayerCategory = "CITIZEN" | "FOREIGN";
export type IdentifierType = "CID" | "WORK_PERMIT" | "PASSPORT";
/** Recorded by GMCA. Nationality alone never sets this. */
export type ResidencyStatus = "NOT_DETERMINED" | "RESIDENT" | "NON_RESIDENT";

export type Verification = {
  provider: "NDI" | "IMMIGRATION" | "COMPANY_REGISTRY";
  status: "VERIFIED" | "NOT_VERIFIED" | "NO_MATCH";
  reference?: string;
  checkedAt?: string;
  simulated: true;
};

export type IndividualTaxpayer = {
  id: ID;
  tin: string;
  category: TaxpayerCategory;
  identifierType: IdentifierType;
  identifierValue: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  phone: string;
  address: string;
  residencyStatus: ResidencyStatus;
  verification: Verification;
  /** From the immigration record for foreign nationals, or the employer link for citizens. */
  employmentSummary?: { employer: string; position: string; since: string; permitExpiry?: string };
  registeredAt: string;
};

export type CompanyType = "COMPANY" | "SOLE_PROPRIETORSHIP";

export type Company = {
  id: ID;
  uen: string;
  name: string;
  type: CompanyType;
  sector: string;
  registeredAddress: string;
  incorporatedOn: string;
  verification: Verification;
  representatives: { name: string; email: string; designation: string; phone: string }[];
  registeredAt: string;
};

export type CompanyTaxIncentive = {
  id: ID;
  companyId: ID;
  ratePct: number;
  effectiveFrom: string;
  effectiveTo: string;
  approvalReference: string;
  notes: string;
  recordedBy: ID;
  recordedAt: string;
  status: "ACTIVE" | "REVOKED";
};

export type EmploymentStatus = "ACTIVE" | "ON_LEAVE" | "LEFT";

export type Employee = {
  id: ID;
  companyId: ID;
  fullName: string;
  category: TaxpayerCategory;
  identifierType: IdentifierType;
  identifierValue: string;
  taxpayerId?: ID;
  position: string;
  startDate: string;
  endDate?: string;
  status: EmploymentStatus;
  defaultCurrency: string;
  verification: Verification;
};

// ---------- Currency ----------

export type Conversion = {
  originalMinor: Minor;
  currency: string;
  reportingCurrency: string;
  status: "CONVERTED" | "PENDING";
  reportingMinor: Minor | null;
  /** Reporting-currency units per one unit of `currency`. */
  rate: number | null;
  rateDate: string | null;
  conversionDate: string;
  source: string | null;
  isDemoRate: boolean;
};

// ---------- Documents ----------

export type DocumentCategory =
  | "BANK_STATEMENT"
  | "INCOME_SUPPORTING"
  | "RELIEF_EVIDENCE"
  | "AUDITED_FINANCIALS"
  | "FIXED_ASSET_REPORT"
  | "IDENTITY"
  | "INFO_RESPONSE"
  | "NOTICE_OF_ASSESSMENT"
  | "SUBMISSION_ACK"
  | "PAYMENT_RECEIPT"
  | "CORRESPONDENCE";

export type DocumentReviewStatus = "UPLOADED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "EVIDENCE_REQUIRED";

export type OwnerRef = { kind: "INDIVIDUAL"; id: ID } | { kind: "COMPANY"; id: ID };

export type RelatedRef =
  | { kind: "INDIVIDUAL_RETURN"; id: ID; incomeSourceId?: ID; reliefId?: ID }
  | { kind: "CORPORATE_RETURN"; id: ID }
  | { kind: "MONTHLY_DECLARATION"; id: ID }
  | { kind: "PAYMENT"; id: ID }
  | { kind: "INFO_REQUEST"; id: ID }
  | { kind: "ASSESSMENT"; id: ID }
  | { kind: "PROFILE"; id: ID };

export type TaxDocument = {
  id: ID;
  reference: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  owner: OwnerRef;
  related: RelatedRef;
  uploadedBy: ID;
  uploadedAt: string;
  reviewStatus?: DocumentReviewStatus;
  /** Generated documents (certificates, notices, receipts) render from stored data; uploads keep a data URL when small enough for browser storage. */
  generated: boolean;
  dataUrl?: string;
  demoSeeded?: boolean;
};

// ---------- Calculations ----------

export type CalcLine = { key: string; label: string; amountMinor: Minor; note?: string; tone?: "sub" | "total" | "credit" };

export type CalculationSnapshot = {
  id: ID;
  kind: "INDIVIDUAL" | "MONTHLY" | "CORPORATE";
  ruleSetId: ID;
  ruleSetVersion: string;
  reportingCurrency: string;
  computedAt: string;
  lines: CalcLine[];
  /** Headline result: tax liability for returns, total due for monthly declarations. */
  taxMinor: Minor;
  creditsMinor: Minor;
  balanceMinor: Minor;
  warnings: string[];
  assumptions: string[];
  /** Individual returns only: the headline figures of the working. */
  figures?: { totalIncomeMinor: Minor; exemptMinor: Minor; taxableMinor: Minor; reliefsMinor: Minor; chargeableMinor: Minor; nonResidentRatePct?: number };
};

// ---------- Individual returns ----------

export type EmploymentIncomeLine = {
  employerName: string;
  companyId?: ID;
  months: number;
  grossMinor: Minor;
  tdsMinor: Minor;
  healthMinor: Minor;
  currency: string;
  source: "EMPLOYER_DECLARATIONS";
};

export type IncomeSource = {
  id: ID;
  category: string;
  description: string;
  payer: string;
  amountMinor: Minor;
  currency: string;
  periodFrom: string;
  periodTo: string;
  classification: "TAXABLE" | "EXEMPT";
  conversion?: Conversion;
  bankStatementDocId?: ID;
  supportingDocIds: ID[];
};

export type ReliefClaim = {
  id: ID;
  reliefKey: string;
  declaredMinor: Minor;
  note: string;
  docIds: ID[];
};

export type SubmissionStatus = "DRAFT" | "SUBMITTED";

export type IndividualTaxReturn = {
  id: ID;
  reference?: string;
  taxpayerId: ID;
  year: number;
  submissionStatus: SubmissionStatus;
  employment: EmploymentIncomeLine[];
  incomeSources: IncomeSource[];
  reliefs: ReliefClaim[];
  declarationAccepted: boolean;
  calculation?: CalculationSnapshot;
  submittedAt?: string;
  ackDocId?: ID;
  assessmentId?: ID;
  lastSavedAt: string;
  createdAt: string;
  demoSeeded?: boolean;
};

// ---------- Employer monthly declarations ----------

export type EmployeeRemuneration = {
  employeeId: ID;
  employeeName: string;
  amountMinor: Minor;
  currency: string;
  conversion?: Conversion;
  tdsMinor: Minor;
  healthMinor: Minor;
  tdsNote?: string;
};

export type EmployerMonthlyDeclaration = {
  id: ID;
  reference?: string;
  companyId: ID;
  period: string;
  submissionStatus: SubmissionStatus;
  lines: EmployeeRemuneration[];
  calculation?: CalculationSnapshot;
  submittedAt?: string;
  submittedBy?: ID;
  ackDocId?: ID;
  liabilityId?: ID;
  lastSavedAt: string;
  demoSeeded?: boolean;
};

// ---------- Corporate returns ----------

export type CorporateFinancials = {
  revenueMinor: Minor;
  otherIncomeMinor: Minor;
  expensesMinor: Minor;
  /** Free-labelled adjustments: positive adds back, negative deducts. No statutory schedule is assumed. */
  adjustments: { id: ID; label: string; amountMinor: Minor }[];
};

export type CorporateTaxReturn = {
  id: ID;
  reference?: string;
  companyId: ID;
  year: number;
  submissionStatus: SubmissionStatus;
  financials: CorporateFinancials;
  auditedFsDocIds: ID[];
  fixedAssetDocIds: ID[];
  declarationAccepted: boolean;
  calculation?: CalculationSnapshot;
  submittedAt?: string;
  submittedBy?: ID;
  ackDocId?: ID;
  assessmentId?: ID;
  lastSavedAt: string;
  demoSeeded?: boolean;
};

// ---------- Assessment ----------

export type AssessmentStatus = "NOT_ASSIGNED" | "ASSIGNED" | "UNDER_REVIEW" | "INFO_REQUIRED" | "RESPONSE_RECEIVED" | "COMPLETED";
export type ReturnKind = "INDIVIDUAL" | "CORPORATE";

export type AssessmentAdjustment = { id: ID; label: string; amountMinor: Minor; reason: string; by: ID; at: string };

export type Assessment = {
  id: ID;
  returnKind: ReturnKind;
  returnId: ID;
  owner: OwnerRef;
  year: number;
  status: AssessmentStatus;
  assignedTo?: ID;
  assignedAt?: string;
  calculationVerified?: { by: ID; at: string; result: "VERIFIED" | "ISSUE_FLAGGED"; note: string };
  notes: { id: ID; by: ID; at: string; text: string }[];
  adjustments: AssessmentAdjustment[];
  outcome?: { assessedTaxMinor: Minor; creditsMinor: Minor; prepaidMinor?: Minor; balanceMinor: Minor; summary: string; by: ID; at: string };
  noaDocId?: ID;
  liabilityId?: ID;
  createdAt: string;
};

export type InformationRequest = {
  id: ID;
  reference: string;
  assessmentId: ID;
  owner: OwnerRef;
  message: string;
  requiredDocuments: string[];
  dueDate: string;
  requestedBy: ID;
  requestedAt: string;
  status: "OPEN" | "RESPONDED" | "CLOSED";
  letterDocId?: ID;
  response?: { by: ID; at: string; message: string; docIds: ID[] };
};

// ---------- Liabilities and payments ----------

/** INDIVIDUAL_SELF_ASSESSMENT: the estimated balance paid with the return, before it is submitted. */
export type LiabilitySource = "INDIVIDUAL_SELF_ASSESSMENT" | "INDIVIDUAL_ASSESSMENT" | "CORPORATE_ASSESSMENT" | "MONTHLY_DECLARATION";
export type PaymentStatus = "NOT_DUE" | "UNPAID" | "PENDING" | "PARTIALLY_PAID" | "PAID" | "FAILED";

export type Liability = {
  id: ID;
  reference: string;
  owner: OwnerRef;
  source: LiabilitySource;
  sourceId: ID;
  description: string;
  amountMinor: Minor;
  currency: string;
  paidMinor: Minor;
  createdAt: string;
};

export type PaymentOutcome = "SUCCESS" | "PENDING" | "FAILURE";

export type Payment = {
  id: ID;
  intentReference: string;
  liabilityId: ID;
  amountMinor: Minor;
  currency: string;
  status: "INITIATED" | "PENDING" | "SUCCESS" | "FAILED";
  bankTransactionRef?: string;
  failureReason?: string;
  initiatedBy: ID;
  initiatedAt: string;
  settledAt?: string;
  receiptDocId?: ID;
  simulated: true;
};

// ---------- Messaging and audit ----------

export type Recipient = { owner: OwnerRef } | { userId: ID } | { role: Role };

export type Notification = {
  id: ID;
  recipient: Recipient;
  title: string;
  body: string;
  link?: string;
  createdAt: string;
  readBy: ID[];
};

export type AuditEntry = {
  id: ID;
  at: string;
  actorId: ID;
  actorName: string;
  actorRole: Role | "SYSTEM";
  action: string;
  entity: string;
  entityId: ID;
  summary: string;
};

export type IntegrationEvent = {
  id: ID;
  at: string;
  provider: "NDI" | "IMMIGRATION" | "COMPANY_REGISTRY" | "DK_BANK";
  operation: string;
  /** Masked identifier only. */
  subject: string;
  outcome: string;
  reference: string;
};

// ---------- Configuration ----------

export type Band = { fromMinor: Minor; toMinor: Minor | null; ratePct: number };

export type ReliefRule = { key: string; label: string; description: string; capMinor: Minor | null; evidenceExamples: string[]; enabled: boolean };
export type IncomeCategory = { key: string; label: string; defaultClassification: "TAXABLE" | "EXEMPT" };

export type TaxRuleSet = {
  id: ID;
  version: string;
  label: string;
  effectiveFromYear: number;
  status: "ACTIVE" | "RETIRED";
  individualBands: Band[];
  /** Flat rate applied only when GMCA has recorded the taxpayer as non-resident; null means not configured. */
  nonResidentRatePct: number | null;
  tdsMethod: "BRACKET_WHOLE_AMOUNT" | "PROGRESSIVE_MONTHLY";
  tdsBands: Band[];
  healthRatePct: number;
  healthAppliesTo: "ALL" | "CITIZENS";
  corporateRatePct: number;
  reliefs: ReliefRule[];
  incomeCategories: IncomeCategory[];
  /** null: carry-forward rule not configured, so excess TDS is shown but not carried. */
  excessCreditCarryForward: boolean | null;
  createdBy: ID;
  createdAt: string;
};

export type Currency = { code: string; name: string; enabled: boolean };
export type ExchangeRate = { id: ID; currency: string; rate: number; effectiveDate: string; source: string; isDemo: boolean };

export type IntegrationMode = "SEEDED" | "FORCE_NO_MATCH" | "FORCE_UNAVAILABLE";
export type BankMode = "CHOOSE" | "SUCCESS" | "PENDING" | "FAILURE";

export type PlatformConfig = {
  reportingCurrency: string;
  conversionDateRule: "PERIOD_END" | "FILING_DATE";
  currencies: Currency[];
  exchangeRates: ExchangeRate[];
  informationRequestDays: number;
  /** Income year open for filing. Its year of assessment (YA) is the following year. */
  currentFilingYear: number;
  /** MM-DD in the year of assessment, e.g. "04-30" → YA 2027 return due 30 April 2027. */
  filingDeadlineMonthDay: string;
  /** Version 1 flow: a return with an estimated balance is paid through DK Bank first, then submitted. */
  payBeforeSubmit: boolean;
  currentPayrollPeriod: string;
  integrations: { ndi: IntegrationMode; immigration: IntegrationMode; companyRegistry: IntegrationMode; dkBank: BankMode; pendingResolvesTo: "SUCCESS" | "FAILURE" };
};

// ---------- Database ----------

export type Db = {
  schemaVersion: number;
  seededAt: string;
  counters: Record<string, number>;
  users: User[];
  taxpayers: IndividualTaxpayer[];
  companies: Company[];
  incentives: CompanyTaxIncentive[];
  employees: Employee[];
  individualReturns: IndividualTaxReturn[];
  monthlyDeclarations: EmployerMonthlyDeclaration[];
  corporateReturns: CorporateTaxReturn[];
  assessments: Assessment[];
  infoRequests: InformationRequest[];
  liabilities: Liability[];
  payments: Payment[];
  documents: TaxDocument[];
  notifications: Notification[];
  audit: AuditEntry[];
  integrationEvents: IntegrationEvent[];
  ruleSets: TaxRuleSet[];
  config: PlatformConfig;
};
