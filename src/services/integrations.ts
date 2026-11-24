import type { IntegrationMode, PaymentOutcome, PlatformConfig } from "../domain/types";

/**
 * Integration boundary. Pages never talk to providers directly; services call these
 * interfaces. Every implementation here is SEEDED: no network, no credentials.
 * Swap in real adapters by implementing the same interfaces.
 */

export type LookupResult<T> = { status: "MATCH"; record: T; reference: string } | { status: "NO_MATCH"; reference: string } | { status: "UNAVAILABLE"; reference: string };

export type NdiRecord = { cid: string; fullName: string; dateOfBirth: string; gender: string; dzongkhag: string; nationality: "Bhutanese" };
export type ImmigrationRecord = {
  identifierType: "WORK_PERMIT" | "PASSPORT";
  identifier: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  passportNumber: string;
  permitNumber?: string;
  permitExpiry?: string;
  employer?: string;
  position?: string;
  employedSince?: string;
};
export type RegistryRecord = { uen: string; name: string; type: "COMPANY" | "SOLE_PROPRIETORSHIP"; sector: string; registeredAddress: string; incorporatedOn: string; status: "LIVE"; directors: string[] };

export interface IdentityVerificationProvider {
  verifyCitizen(cid: string, dateOfBirth: string): LookupResult<NdiRecord>;
}
export interface ImmigrationVerificationProvider {
  verifyForeign(type: "WORK_PERMIT" | "PASSPORT", identifier: string): LookupResult<ImmigrationRecord>;
}
export interface CompanyRegistryProvider {
  lookupCompany(uen: string): LookupResult<RegistryRecord>;
}
export interface PaymentProvider {
  /** Opens a simulated DK Bank session and returns a bank-side reference. */
  createIntent(amountMinor: number, currency: string, merchantRef: string): { bankSessionRef: string };
  /** The simulated bank's answer for this attempt. */
  settle(bankSessionRef: string, chosen: PaymentOutcome): { outcome: PaymentOutcome; bankTransactionRef?: string; failureReason?: string };
  recheck(bankSessionRef: string): { outcome: PaymentOutcome; bankTransactionRef?: string; failureReason?: string };
  /** Income credits on the account holder's DK Bank statement for a year. null when the bank is unavailable. */
  statementCredits(year: number): StatementSync | null;
}

export type StatementCredit = { category: string; description: string; payer: string; amountMinor: number; currency: string; periodFrom: string; periodTo: string };
export type StatementSync = { reference: string; account: string; credits: StatementCredit[] };

// ---------- Seeded external records (fictional) ----------

export const NDI_RECORDS: NdiRecord[] = [
  { cid: "10000000001", fullName: "Karma Dorji", dateOfBirth: "1988-04-12", gender: "Male", dzongkhag: "Sarpang", nationality: "Bhutanese" },
  { cid: "10000000002", fullName: "Sonam Choden", dateOfBirth: "1992-09-03", gender: "Female", dzongkhag: "Thimphu", nationality: "Bhutanese" },
  { cid: "10000000003", fullName: "Pema Wangchuk", dateOfBirth: "1985-01-22", gender: "Male", dzongkhag: "Paro", nationality: "Bhutanese" },
  { cid: "10000000004", fullName: "Dechen Yangzom", dateOfBirth: "1996-06-18", gender: "Female", dzongkhag: "Sarpang", nationality: "Bhutanese" },
  { cid: "10000000005", fullName: "Tashi Namgay", dateOfBirth: "1990-11-30", gender: "Male", dzongkhag: "Trongsa", nationality: "Bhutanese" }
];

export const IMMIGRATION_RECORDS: ImmigrationRecord[] = [
  { identifierType: "WORK_PERMIT", identifier: "WP-DEMO-2026-0001", fullName: "Anika Rao", dateOfBirth: "1987-02-14", nationality: "Indian", passportNumber: "DEMO-IN-4411", permitNumber: "WP-DEMO-2026-0001", permitExpiry: "2028-03-31", employer: "Gelephu Green Energy Pvt Ltd", position: "Senior Engineer", employedSince: "2025-04-01" },
  { identifierType: "PASSPORT", identifier: "DEMO-IN-4411", fullName: "Anika Rao", dateOfBirth: "1987-02-14", nationality: "Indian", passportNumber: "DEMO-IN-4411", permitNumber: "WP-DEMO-2026-0001", permitExpiry: "2028-03-31", employer: "Gelephu Green Energy Pvt Ltd", position: "Senior Engineer", employedSince: "2025-04-01" },
  { identifierType: "WORK_PERMIT", identifier: "WP-DEMO-2026-0002", fullName: "Lucas Tan", dateOfBirth: "1991-07-08", nationality: "Singaporean", passportNumber: "DEMO-SG-7720", permitNumber: "WP-DEMO-2026-0002", permitExpiry: "2027-12-31", employer: "Gelephu Green Energy Pvt Ltd", position: "Finance Manager", employedSince: "2025-09-15" },
  { identifierType: "WORK_PERMIT", identifier: "WP-DEMO-2026-0003", fullName: "Maya Fischer", dateOfBirth: "1984-12-01", nationality: "German", passportNumber: "DEMO-DE-0093", permitNumber: "WP-DEMO-2026-0003", permitExpiry: "2027-06-30", employer: "Mindful Valley Hospitality", position: "General Manager", employedSince: "2026-01-10" },
  { identifierType: "PASSPORT", identifier: "DEMO-TH-5521", fullName: "Niran Chaiyaporn", dateOfBirth: "1993-03-25", nationality: "Thai", passportNumber: "DEMO-TH-5521", permitNumber: "WP-DEMO-2026-0004", permitExpiry: "2027-09-30", employer: "Mindful Valley Hospitality", position: "Chef de Cuisine", employedSince: "2026-02-01" }
];

export const REGISTRY_RECORDS: RegistryRecord[] = [
  { uen: "GMC-UEN-2025-0001", name: "Gelephu Green Energy Pvt Ltd", type: "COMPANY", sector: "Renewable energy", registeredAddress: "Plot 14, Energy Park, Gelephu", incorporatedOn: "2025-02-10", status: "LIVE", directors: ["Pema Wangchuk", "Lucas Tan"] },
  { uen: "GMC-UEN-2025-0002", name: "Mindful Valley Hospitality", type: "COMPANY", sector: "Hospitality", registeredAddress: "Riverside Road 3, Gelephu", incorporatedOn: "2025-06-01", status: "LIVE", directors: ["Maya Fischer"] },
  { uen: "GMC-UEN-2026-0003", name: "Druk Digital Labs", type: "COMPANY", sector: "Software", registeredAddress: "Innovation Block B, Gelephu", incorporatedOn: "2026-03-15", status: "LIVE", directors: ["Tashi Namgay"] },
  { uen: "GMC-SP-2026-0004", name: "Dechen's Tailoring (sole proprietorship)", type: "SOLE_PROPRIETORSHIP", sector: "Retail and services", registeredAddress: "Market Lane 7, Gelephu", incorporatedOn: "2026-05-20", status: "LIVE", directors: ["Dechen Yangzom"] }
];

// ---------- Seeded implementations ----------

let counter = 0;
const ref = (prefix: string) => `${prefix}-SIM-${Date.now().toString(36).toUpperCase()}${(counter++).toString(36).toUpperCase()}`;

function gate(mode: IntegrationMode, prefix: string): LookupResult<never> | null {
  if (mode === "FORCE_NO_MATCH") return { status: "NO_MATCH", reference: ref(prefix) };
  if (mode === "FORCE_UNAVAILABLE") return { status: "UNAVAILABLE", reference: ref(prefix) };
  return null;
}

export class SeededNdiProvider implements IdentityVerificationProvider {
  constructor(private mode: IntegrationMode) {}
  verifyCitizen(cid: string, dateOfBirth: string): LookupResult<NdiRecord> {
    const forced = gate(this.mode, "NDI");
    if (forced) return forced;
    const record = NDI_RECORDS.find((r) => r.cid === cid.trim() && r.dateOfBirth === dateOfBirth);
    return record ? { status: "MATCH", record, reference: ref("NDI") } : { status: "NO_MATCH", reference: ref("NDI") };
  }
}

export class SeededImmigrationProvider implements ImmigrationVerificationProvider {
  constructor(private mode: IntegrationMode) {}
  verifyForeign(type: "WORK_PERMIT" | "PASSPORT", identifier: string): LookupResult<ImmigrationRecord> {
    const forced = gate(this.mode, "IMM");
    if (forced) return forced;
    const record = IMMIGRATION_RECORDS.find((r) => r.identifierType === type && r.identifier.toUpperCase() === identifier.trim().toUpperCase());
    return record ? { status: "MATCH", record, reference: ref("IMM") } : { status: "NO_MATCH", reference: ref("IMM") };
  }
}

export class SeededCompanyRegistryProvider implements CompanyRegistryProvider {
  constructor(private mode: IntegrationMode) {}
  lookupCompany(uen: string): LookupResult<RegistryRecord> {
    const forced = gate(this.mode, "CRS");
    if (forced) return forced;
    const record = REGISTRY_RECORDS.find((r) => r.uen.toUpperCase() === uen.trim().toUpperCase());
    return record ? { status: "MATCH", record, reference: ref("CRS") } : { status: "NO_MATCH", reference: ref("CRS") };
  }
}

export class SeededDkBankProvider implements PaymentProvider {
  constructor(private config: PlatformConfig["integrations"]) {}
  createIntent() {
    return { bankSessionRef: ref("DKB") };
  }
  private answer(outcome: PaymentOutcome) {
    if (outcome === "SUCCESS") return { outcome, bankTransactionRef: ref("DKBTXN") };
    if (outcome === "FAILURE") return { outcome, failureReason: "Declined by DK Bank." };
    return { outcome };
  }
  settle(_session: string, chosen: PaymentOutcome) {
    const forced = this.config.dkBank;
    return this.answer(forced === "CHOOSE" ? chosen : forced);
  }
  recheck() {
    return this.answer(this.config.pendingResolvesTo);
  }
  /** Seeded statement: the same demo credits for every account holder, in round ngultrum amounts. */
  statementCredits(year: number): StatementSync | null {
    if (this.config.dkBank === "FAILURE") return null;
    return {
      reference: ref("DKBSTM"),
      account: "Savings account ••••4021",
      credits: [
        { category: "RENTAL", description: "Rent received, Gelephu apartment (Nu 20,000 a month)", payer: "Tenant", amountMinor: 24_000_000, currency: "BTN", periodFrom: `${year}-01-01`, periodTo: `${year}-12-31` },
        { category: "INTEREST", description: "Savings interest", payer: "DK Bank", amountMinor: 1_000_000, currency: "BTN", periodFrom: `${year}-01-01`, periodTo: `${year}-12-31` }
      ]
    };
  }
}

export function providers(config: PlatformConfig) {
  return {
    ndi: new SeededNdiProvider(config.integrations.ndi) as IdentityVerificationProvider,
    immigration: new SeededImmigrationProvider(config.integrations.immigration) as ImmigrationVerificationProvider,
    registry: new SeededCompanyRegistryProvider(config.integrations.companyRegistry) as CompanyRegistryProvider,
    bank: new SeededDkBankProvider(config.integrations) as PaymentProvider
  };
}
