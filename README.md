# GMCA Income Tax · Version 2 prototype

A demonstration prototype of the GMCA Digital Income Tax Administration Platform, built from `ROLE_CONTEXT.md`. It runs entirely in the browser with fictional seeded data. Every external system (NDI, Immigration, Corporate Registry, DK Bank) is simulated.

Version 1 (`apps/portal`) is unchanged and can run at the same time.

## Run

```bash
cd apps/portal-v2
npm install
npm run dev        # http://localhost:5175  (version 1 uses 5174)
npm test           # calculation, currency, permissions, payments, submission
npm run build      # typecheck + production build
```

Data lives in this browser's `localStorage` (`gmca-v2:db`). To return to the seeded state, use **Reset demo data**: it's in the account menu for every role, on the sign-in page, and under *Admin → Integration demo settings*.

## Demo accounts

Pick one on the sign-in page. You can switch role from the account menu. Role switching exists only in this demo.

| Account | Person | What to show |
|---|---|---|
| Citizen taxpayer | Karma Dorji | Continue the 2026 return: employer income is prefilled, add a source in another currency with its own bank statement, claim a relief, review the calculation, submit, open the Acknowledgement Certificate. In Tax history, open the 2025 return read-only with its certificate, Notice of Assessment and payment receipt. |
| Foreign taxpayer | Anika Rao | Answer GMCA's open information request. Pay the assessed 2025 balance through the simulated DK Bank, trying the *pending* and *decline* outcomes. |
| Employer representative | Pema Wangchuk | Start the November 2026 declaration, change an employee's pay currency, submit, then pay October (still outstanding). Add a foreign employee (verified by the simulated Immigration System). File the 2026 corporate return and see the recorded 5% incentive applied. |
| GMCA assessor | Ugyen Tshering | Work queue filters. Pick up an unassigned return, review the evidence, verify the calculation, record an adjustment or request information, then complete the assessment and issue the Notice of Assessment. A case assigned to Kinley Wangmo is read-only for Ugyen. |
| GMCA administrator | Deki Pelden | Create an officer, change roles, publish a new rule set version, edit reliefs, record or revoke an incentive, add a demo exchange rate, switch simulators to *no match / unavailable / always fail*, read the audit log. |

Seeded records for registration: citizen CID `10000000004` with date of birth 18 Jun 1996; work permit `WP-DEMO-2026-0003` or passport `DEMO-TH-5521`; company `GMC-UEN-2026-0003`; sole proprietorship `GMC-SP-2026-0004`.

## Architecture

```
src/
  domain/        types (shared model), store (versioned localStorage DB + audit/notify),
                 permissions (role + record-level checks), seed (built by running the real services)
  services/      calc (tax engine), currency, integrations (adapter interfaces + seeded providers),
                 individual, employer (directory, monthly TDS, corporate), assessment, payments,
                 documents, registration, admin
  features/      auth, individual, employer, gmca (assessor), admin, shared (payments, documents,
                 certificates, messages, information requests)
  shared/gmc/    design-system components carried over from version 1
```

- **Services own the rules.** Every write goes through a service op `(db, actor, …)` inside `transact`. The op checks permissions, validates input and writes audit entries. A failed op leaves the stored state untouched. Pages never compute tax or convert currency themselves.
- **Integration boundary.** `IdentityVerificationProvider`, `ImmigrationVerificationProvider`, `CompanyRegistryProvider` and `PaymentProvider` have seeded implementations only. Real adapters can replace them without changes to the UI.
- **Reproducible calculations.** Each return or declaration stores a calculation snapshot with the rule set version it used. Publishing new rules creates a new version, and submitted snapshots keep the version they were filed with.
- **Separate statuses.** Submission (draft/submitted), assessment (not assigned to completed), payment (unpaid, pending, partially paid, paid, failed) and document review are each tracked on their own.
- **Human oversight.** A calculation never becomes an assessment on its own. An assigned officer verifies it and completes the assessment. Adjustments are separate records with a reason, and the taxpayer's declaration is never edited.
- **Persistence.** Storage is replaceable: swap `domain/store.ts` for an API client to move to a server (NestJS/PostgreSQL per `PRODUCT.md`, or SELISE Blocks as in version 1).

## Rules from GMCA sources

- **Individual bands** follow the GMC Income Tax Act 2025: 0% to $10,000, 5% to $30,000, 7% to $60,000, 9% to $100,000, 11% to $200,000, 13% to $500,000, then 15%. These are the values version 1 recorded from the Act; verify them against the Act text.
- **Monthly TDS** follows GMCA's TDS note. The rate applies to the whole month's pay, and each bracket includes its upper limit: up to $1,000 is 0%; over $1,000 up to $3,000 is 2%; over $3,000 up to $25,000 is 5%; over $25,000 is 10%.
- **Nu thresholds.** Ngultrum pay is converted at US$1 = Nu 96.35 (rate as at 30 Apr 2026, stored as a GMCA rate). The Nu thresholds are therefore 96,350 / 289,050 / 2,408,750.
- **Filing deadline.** YA returns (income year + 1) are due 30 April. The date is configurable under Tax configuration and shown as "days left" on the taxpayer overview.

## Demo assumptions (not GMCA rules)

All of these are configurable by an administrator and labelled "demo" in the UI.

- Reporting currency USD, shown with a $ sign; other currencies show their ISO code. Demo exchange rates for INR, SGD, THB, EUR and AUD, plus BTN before 30 Apr 2026. GBP has no rate, to show the *conversion pending* state. Conversion uses the rate in force at the end of the income or payroll period. Rounding is half-up to the cent.
- Health contribution is 1% for all employees. No social security (clean wage policy).
- Corporate rate 15%. The approved incentive for Gelephu Green Energy is 5%.
- The non-resident rate of 0% applies only when GMCA has recorded a taxpayer as non-resident. Nationality alone never changes the treatment.
- Relief limits and evidence examples are illustrative. Carry-forward of excess TDS is *not configured*.
- Financial year equals the calendar year. The information-request response period is 14 days. No penalties or interest.
- History before FY2026 is demonstration data. It does not imply legacy migration.

## Open questions for GMCA

Individual: tax bands and formula, financial year and deadlines, income categories and taxable/exempt treatment, residency definition, reliefs (limits, evidence, approval), TDS reconciliation and carry-forward, amendments.
Employer: monthly deadline, taxable remuneration definition, TDS formula, health contribution rate and scope, joiners, leavers and partial months.
Currency: reporting currency, rate source, conversion date rule, rounding, corrections.
Corporate: schedules, allowable expenses and adjustments, deadlines, incentive effective-date handling.
Assessment and payments: officer assignment and permission matrix, service levels, penalties, interest and refunds, DK Bank API and reconciliation, official notice and certificate formats, document retention.
Platform: branding, SSO, hosting (on-premises in Bhutan, TashiCell Gelephu preferred), email and SMS, KPIs and export formats.

## Known limits of the prototype

- Single-browser storage. There is no server, so data isn't shared between people or devices.
- Uploads over 400 KB keep their metadata only, so browser storage doesn't fill up. Seeded documents have no file content.
- "Download (PDF)" uses the browser's print dialog.
- Dev-only shortcut: `?demo-as=<userId>` signs in on the dev server (for screenshots and automated checks). It is disabled in production builds.
