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

Data lives in this browser's `localStorage` (`gmca-v2:db`). To return to the seeded state, sign in as the administrator and use **Reset data** under *Integration settings*.

## Deploy (SELISE Blocks)

Blocks Release builds and hosts this app from the repository `tanvirshariar161/gmc-portal-v2`, branch `dev`, which holds only this folder. `Dockerfile` runs the tests, builds the app and serves `dist` with nginx on port 8080 (`nginx.conf` sends every route to `index.html`). Version 1 is a separate Blocks deployment.

To publish changes from this monorepo, commit them here, push the folder, then deploy:

```bash
git subtree push --prefix apps/portal-v2 v2-pages dev
blocks release deploy --repo tanvirshariar161/gmc-portal-v2 --dry-run --json
blocks release deploy --repo tanvirshariar161/gmc-portal-v2 --yes --wait --json
```

## Sample accounts

Sign in with email and password. Every seeded account uses the password `Gmca@2026`; the sign-in page lists the accounts under *Sample accounts* and fills them in for you. Individual taxpayers then approve the sign-in in the Bhutan NDI app: the page shows a QR code, the simulated wallet scans it within a second and approves about a second later. A password alone never opens a taxpayer's records. Setting the NDI integration to *no match* or *unavailable* shows the declined and unavailable states. To change account, sign out.

| Account | Person | What to show |
|---|---|---|
| Citizen taxpayer | Karma Dorji | Continue the 2026 return: employer income (US$5,000 a month: Nu 5,000,000 for the year, TDS Nu 250,000, net Nu 4,700,000) and a US$10,000 freelance source (Nu 1,000,000) are filled in, leaving Nu 60,000 to pay. **Pay my tax** opens the simulated DK Bank page (connecting, approve, confirming) and the return is submitted once the bank confirms. Add income with **Sync statement from DK Bank** (simulated: rent and interest, statement attached) or **Bank statement upload**, claim a relief, declare assets, investments (a document per row) and liabilities, review the calculation, submit, open the Acknowledgement Certificate. In Tax history, open the 2025 return read-only with its certificate, Notice of Assessment and payment receipt. |
| Foreign taxpayer | Anika Rao | Happy path: nothing filed yet. Start the 2026 return: employer pay (₹1,000,000 a month: Nu 10,000,000 for the year, TDS Nu 500,000, net Nu 9,400,000) and TDS are filled in, with no additional income or assets step for foreign nationals. Review, then **Pay my tax** (Nu 170,000) through DK Bank and the return is submitted. |
| Representatives | Pema Wangchuk | Start the November 2026 declaration, change an employee's pay currency or import pay from a CSV saved in Excel (download the template, edit, upload, review, apply). See the total split by pay currency, then either submit and pay through DK Bank, or say you've already paid in DK Bank and upload the receipt. Pay October (still outstanding). Add a foreign employee (verified by the simulated Immigration System). File the 2026 corporate return and see the recorded 5% incentive applied. |
| GMCA Tax Officer | Ugyen Tshering | *Assessment of returns* has three tabs: Individual, Corporate and Information Requests. Pick up an unassigned return, review the evidence, verify the calculation, record an adjustment or request information, then complete the assessment and issue the Notice of Assessment. A case assigned to Kinley Wangmo is read-only for Ugyen. In *Payments & liabilities*, open any row to see the liability, every payment attempt and its reconciliation. *Taxpayers & companies* opens each record, where the officer records tax residency. |
| GMCA Administrator | Deki Pelden | Create an officer, change roles, set tax rules for any financial year (type a year such as 2028, edit, publish), edit reliefs, record or revoke an incentive, add an exchange rate, switch integrations to *no match / unavailable / always fail*, read the audit log. |

Seeded records for registration: citizen CID `10000000004` with date of birth 18 Jun 1996; work permit `WP-DEMO-2026-0003` or passport `DEMO-TH-5521`; company `GMC-UEN-2026-0003`; sole proprietorship `GMC-SP-2026-0004`.

## Architecture

```
src/
  domain/        types (shared model), store (versioned localStorage DB + audit/notify),
                 permissions (role + record-level checks), seed (built by running the real services)
  services/      calc (tax engine), currency, integrations (adapter interfaces + seeded providers),
                 individual, employer (directory, monthly TDS, corporate), assessment, payments,
                 documents, registration, admin
  features/      auth, individual, employer, gmca (tax officer), admin, shared (payments, documents,
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

- **Individual bands** follow the GMC Income Tax Act 2025 (US$ 10,000 / 30,000 / 60,000 / 100,000 / 200,000 / 500,000 at 0% to 15%), entered in Nu as below. These are the values version 1 recorded from the Act; verify them against the Act text.
- **Monthly TDS** follows GMCA's TDS note. The rate applies to the whole month's pay, and each bracket includes its upper limit (US$ 1,000 / 3,000 / 25,000, entered in Nu as below).
- **Amounts in ngultrum.** The reporting currency is BTN, shown as "Nu". The Act bands and the TDS table are entered in Nu at a round US$1 = Nu 100: individual bands 0% to Nu 1,000,000, 5% to 3,000,000, 7% to 6,000,000, 9% to 10,000,000, 11% to 20,000,000, 13% to 50,000,000, then 15%; monthly TDS 0% up to Nu 100,000, 2% up to 300,000, 5% up to 2,500,000, then 10%. GMCA's TDS note converts at US$1 = Nu 96.35; add that rate under Currencies to use it.
- **Filing deadline.** YA returns (income year + 1) are due 30 April. The date is configurable under Tax configuration and shown as "days left" on the taxpayer overview.
- **Rules per financial year.** Each rule set has the year it applies from; it applies until a later year has its own. Publishing for a year with no rules of its own creates that year's first version (for example `FY2028.1`).

## Demo assumptions (not GMCA rules)

All of these are configurable by an administrator.

- **Easy numbers.** Rates are round Nu per unit: US$1 = Nu 100, ₹1 = Nu 1, S$1 = Nu 75, ฿1 = Nu 3, €1 = Nu 120, A$1 = Nu 60. Salaries are round too (US$5,000, Nu 500,000, ₹1,000,000) and sit in the 5% TDS band, so TDS, the 1% health contribution, net pay, monthly totals and the tax due all come out round. Whole amounts show without decimals.
- **Assets and liabilities.** Citizens and companies list what they owned and owed on 31 December, using the asset and liability types in the tax item catalogue. Investments are asset types marked as investments. The figures are declared for information and don't change the tax.
- **Payment evidence.** A declaration paid in DK Bank before submitting counts as paid at once; GMCA verifies the uploaded receipt later.

- Reporting currency BTN, shown as "Nu"; USD shows a $ sign and other currencies their ISO code. Illustrative exchange rates for USD, INR, SGD, THB, EUR and AUD. GBP has no rate, to show the *conversion pending* state. Conversion uses the rate in force at the end of the income or payroll period. Rounding is half-up to the cent.
- Health contribution is 1% for all employees. No social security (clean wage policy).
- Rates come from **taxpayer classes** (Admin → Tax classification). Individuals match on citizenship and GMCA-recorded residency; businesses on entity type. The first enabled match applies, and every taxpayer must resolve before a rule set can be published. Seeded: non-resident 0% flat, resident and not-determined on the Act bands, company and sole proprietorship 15% flat. A "non-citizen 0% to 2030" class (from secondary sources) is seeded switched off. Nationality alone never changes the treatment unless GMCA turns that class on.
- The approved incentive for Gelephu Green Energy is 5%; incentives override the class rate.
- The **tax item catalogue** classifies income (taxable, exempt, final withholding; GMC or foreign source), expenses (deductible, partly, not, capitalised), assets (capital allowance with rate and method, full write-off, none) and liabilities (deductible when paid, interest deductible with optional EBITDA limit, no effect). Individual income items are the categories on the return. Expense, asset and liability items are configuration only until the corporate return gets schedules.
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
- Sign-in is local to this browser: one sample password for every account and a simulated NDI wallet. A real deployment uses the GMC identity service and a live NDI verifier.
- Dev-only shortcut: `?demo-as=<userId>` signs in on the dev server (for screenshots and automated checks). It skips the NDI step and is disabled in production builds.
