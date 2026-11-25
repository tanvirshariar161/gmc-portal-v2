/** Sample accounts listed on the sign-in page, in presentation order. They share SAMPLE_PASSWORD (services/auth). */
export const DEMO_ACCOUNTS = [
  { userId: "usr-karma", label: "Citizen taxpayer", story: "Signs in with Bhutan NDI, files the 2026 return, views 2025 history and certificates." },
  { userId: "usr-anika", label: "Foreign taxpayer", story: "Signs in with a one-time code, files the 2026 return from her employer's figures and pays through DK Bank." },
  { userId: "usr-pema", label: "Corporate Tax Payer", story: "Signs in with a one-time code, declares November payroll in several currencies, pays October, files corporate tax." },
  { userId: "usr-ugyen", label: "GMCA Tax Officer", story: "Assesses returns, reviews evidence, requests information, issues notices." },
  { userId: "usr-admin", label: "GMCA Tax Administrator", story: "Sets tax rules, reliefs, incentives and currencies, assigns officers to organizations, downloads rule impact workbooks." },
  { userId: "usr-sysadmin", label: "GMCA System Admin", story: "Creates staff accounts, changes roles and deactivates accounts." }
] as const;
