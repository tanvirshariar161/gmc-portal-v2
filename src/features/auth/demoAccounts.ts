/** Demo-only role switching. Not a production capability. */
export const DEMO_ACCOUNTS = [
  { userId: "usr-karma", label: "Citizen taxpayer", story: "Files the 2026 return with income in two currencies, views 2025 history and certificates." },
  { userId: "usr-anika", label: "Foreign taxpayer", story: "Answers a GMCA information request and pays an assessed 2025 balance through DK Bank." },
  { userId: "usr-pema", label: "Employer representative", story: "Declares November payroll in several currencies, pays October, files corporate tax." },
  { userId: "usr-ugyen", label: "GMCA assessor", story: "Works the assessment queue, reviews evidence, requests information, issues notices." },
  { userId: "usr-admin", label: "GMCA administrator", story: "Manages officers, tax rules, reliefs, incentives, currencies and simulators." }
] as const;
