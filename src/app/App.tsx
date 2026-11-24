import { useEffect } from "react";
import type { ReactNode } from "react";
import type { Role } from "../domain/types";
import { AdminOverview, AdminTaxpayerDetail, AuditPage, CurrencyPage, IncentivesPage, IntegrationsPage, MonitoringPage, ReliefConfigPage, TaxConfigPage, UsersPage } from "../features/admin/AdminPages";
import { LoginPage, NotFound, RegisterChooser, RegisterCitizen, RegisterCompany, RegisterForeign } from "../features/auth/AuthPages";
import { CorporateListPage, CorporateReturnPage, CorporateWizardEntry, EmployerHistory } from "../features/employer/CorporatePages";
import { CompanyProfile, DeclarationPage, EmployeeEditor, EmployeesPage, EmployerOverview, PayrollPage } from "../features/employer/EmployerPages";
import { CasePage, GmcaDocumentsPage, GmcaOverview, GmcaPaymentsPage, GmcaRequestsPage, QueuePage, ReportsPage, TaxpayerDetail, TaxpayersPage } from "../features/gmca/GmcaPages";
import { IncomePage, IndividualHistory, IndividualOverview, ProfilePage, ReturnDetail, ReturnsPage } from "../features/individual/IndividualPages";
import { ReturnWizardEntry } from "../features/individual/ReturnWizard";
import { BankPage, DocumentViewer, DocumentsPage, MessagesPage, PayPage, PaymentsPage, ReceiptPage, RequestPage } from "../features/shared/TaxpayerShared";
import { HOME, matchPath, navigate, SessionProvider, ToastProvider, useLocation, useSession } from "./core";
import { Shell } from "./Shell";

type Route = { path: string; roles: Role[]; render: (p: Record<string, string>, q: URLSearchParams) => ReactNode };

const TAXPAYER: Role[] = ["INDIVIDUAL", "EMPLOYER"];
const STAFF: Role[] = ["ASSESSOR", "ADMIN"];
const ALL: Role[] = ["INDIVIDUAL", "EMPLOYER", "ASSESSOR", "ADMIN"];

/** Role is checked here and again inside every service call. */
const ROUTES: Route[] = [
  // Individual taxpayer
  { path: "/", roles: ["INDIVIDUAL"], render: () => <IndividualOverview /> },
  { path: "/profile", roles: ["INDIVIDUAL"], render: () => <ProfilePage /> },
  { path: "/income", roles: ["INDIVIDUAL"], render: () => <IncomePage /> },
  { path: "/returns", roles: ["INDIVIDUAL"], render: () => <ReturnsPage /> },
  { path: "/returns/file/:year", roles: ["INDIVIDUAL"], render: (p) => <ReturnWizardEntry year={Number(p.year)} /> },
  { path: "/returns/file/:year/:step", roles: ["INDIVIDUAL"], render: (p) => <ReturnWizardEntry year={Number(p.year)} step={p.step} /> },
  { path: "/returns/:id", roles: ["INDIVIDUAL"], render: (p, q) => <ReturnDetail id={p.id!} justSubmitted={q.get("submitted") === "1"} /> },

  // Employer
  { path: "/company", roles: ["EMPLOYER"], render: () => <EmployerOverview /> },
  { path: "/company/profile", roles: ["EMPLOYER"], render: () => <CompanyProfile /> },
  { path: "/company/employees", roles: ["EMPLOYER"], render: () => <EmployeesPage /> },
  { path: "/company/employees/new", roles: ["EMPLOYER"], render: () => <EmployeeEditor /> },
  { path: "/company/employees/:id", roles: ["EMPLOYER"], render: (p) => <EmployeeEditor key={p.id} id={p.id} /> },
  { path: "/company/payroll", roles: ["EMPLOYER"], render: () => <PayrollPage /> },
  { path: "/company/payroll/:period", roles: ["EMPLOYER"], render: (p) => <DeclarationPage key={p.period} period={p.period!} /> },
  { path: "/company/corporate", roles: ["EMPLOYER"], render: () => <CorporateListPage /> },
  { path: "/company/corporate/file/:year", roles: ["EMPLOYER"], render: (p) => <CorporateWizardEntry key={p.year} year={Number(p.year)} /> },
  { path: "/company/corporate/return/:id", roles: ["EMPLOYER"], render: (p, q) => <CorporateReturnPage id={p.id!} justSubmitted={q.get("submitted") === "1"} /> },

  // Shared taxpayer (individual and employer)
  { path: "/payments", roles: TAXPAYER, render: () => <PaymentsPage /> },
  { path: "/payments/:id/pay", roles: TAXPAYER, render: (p) => <PayPage liabilityId={p.id!} /> },
  { path: "/payments/receipt/:id", roles: TAXPAYER, render: (p) => <ReceiptPage paymentId={p.id!} /> },
  { path: "/bank/:id", roles: TAXPAYER, render: (p) => <BankPage paymentId={p.id!} /> },
  { path: "/documents", roles: TAXPAYER, render: () => <DocumentsPage /> },
  { path: "/history", roles: TAXPAYER, render: () => <HistoryRouter /> },
  { path: "/messages", roles: TAXPAYER, render: () => <MessagesPage /> },
  { path: "/requests/:id", roles: TAXPAYER, render: (p) => <RequestPage id={p.id!} /> },
  { path: "/documents/:id", roles: ALL, render: (p) => <DocumentViewer key={p.id} id={p.id!} /> },

  // GMCA assessor
  { path: "/gmca", roles: ["ASSESSOR"], render: () => <GmcaOverview /> },
  { path: "/gmca/queue", roles: ["ASSESSOR"], render: (_p, q) => <QueuePage query={q} /> },
  { path: "/gmca/returns/individual", roles: ["ASSESSOR"], render: (_p, q) => <QueuePage key="ind" query={q} fixedKind="INDIVIDUAL" /> },
  { path: "/gmca/returns/corporate", roles: ["ASSESSOR"], render: (_p, q) => <QueuePage key="cor" query={q} fixedKind="CORPORATE" /> },
  { path: "/gmca/cases/:id", roles: ["ASSESSOR"], render: (p) => <CasePage key={p.id} id={p.id!} /> },
  { path: "/gmca/requests", roles: ["ASSESSOR"], render: () => <GmcaRequestsPage /> },
  { path: "/gmca/taxpayers", roles: ["ASSESSOR"], render: () => <TaxpayersPage /> },
  { path: "/gmca/taxpayers/:kind/:id", roles: ["ASSESSOR"], render: (p) => <TaxpayerDetail kind={p.kind!} id={p.id!} /> },
  { path: "/gmca/payments", roles: ["ASSESSOR"], render: () => <GmcaPaymentsPage /> },
  { path: "/gmca/documents", roles: ["ASSESSOR"], render: () => <GmcaDocumentsPage /> },
  { path: "/gmca/reports", roles: STAFF, render: () => <ReportsPage /> },
  { path: "/gmca/notifications", roles: ["ASSESSOR"], render: () => <MessagesPage /> },

  // GMCA administrator
  { path: "/admin", roles: ["ADMIN"], render: () => <AdminOverview /> },
  { path: "/admin/users", roles: ["ADMIN"], render: () => <UsersPage /> },
  { path: "/admin/taxpayers", roles: ["ADMIN"], render: () => <TaxpayersPage admin /> },
  { path: "/admin/taxpayers/:kind/:id", roles: ["ADMIN"], render: (p) => <AdminTaxpayerDetail key={p.id} kind={p.kind!} id={p.id!} /> },
  { path: "/admin/tax", roles: ["ADMIN"], render: () => <TaxConfigPage /> },
  { path: "/admin/reliefs", roles: ["ADMIN"], render: () => <ReliefConfigPage /> },
  { path: "/admin/incentives", roles: ["ADMIN"], render: () => <IncentivesPage /> },
  { path: "/admin/currency", roles: ["ADMIN"], render: () => <CurrencyPage /> },
  { path: "/admin/integrations", roles: ["ADMIN"], render: () => <IntegrationsPage /> },
  { path: "/admin/audit", roles: ["ADMIN"], render: () => <AuditPage /> },
  { path: "/admin/monitoring", roles: ["ADMIN"], render: () => <MonitoringPage /> },
  { path: "/admin/notifications", roles: ["ADMIN"], render: () => <MessagesPage /> }
];

const PUBLIC: Record<string, () => ReactNode> = {
  "/login": () => <LoginPage />,
  "/register": () => <RegisterChooser />,
  "/register/citizen": () => <RegisterCitizen />,
  "/register/foreign": () => <RegisterForeign />,
  "/register/company": () => <RegisterCompany />
};

function HistoryRouter() {
  const { user } = useSession();
  return user?.role === "EMPLOYER" ? <EmployerHistory /> : <IndividualHistory />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Router() {
  const { path, query } = useLocation();
  const { user } = useSession();
  const pub = PUBLIC[path];
  if (pub) return user && path === "/login" ? <Redirect to={HOME[user.role]} /> : <>{pub()}</>;
  if (!user) return <Redirect to="/login" />;
  for (const r of ROUTES) {
    const params = matchPath(r.path, path);
    if (!params) continue;
    if (!r.roles.includes(user.role)) {
      // "/" is the individual home; other roles go to theirs.
      if (path === "/") return <Redirect to={HOME[user.role]} />;
      continue;
    }
    return <Shell>{r.render(params, query)}</Shell>;
  }
  return (
    <Shell>
      <NotFound signedIn />
    </Shell>
  );
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Router />
      </SessionProvider>
    </ToastProvider>
  );
}
