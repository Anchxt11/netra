import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./AppShell";
import { RequireSession } from "./RequireSession";

// Every page loads on demand, so each route downloads only what it needs: the landing page's
// globe libraries never reach the dashboard, and the dashboard's graph and charts never reach the landing.
const Landing = lazy(() => import("../pages/Landing"));
const LiveDashboard = lazy(() => import("../pages/LiveDashboard").then((m) => ({ default: m.LiveDashboard })));
const EnginesLayout = lazy(() => import("../pages/EnginesLayout").then((m) => ({ default: m.EnginesLayout })));
const DetectionEngine = lazy(() => import("../pages/DetectionEngine").then((m) => ({ default: m.DetectionEngine })));
const RemediationEngine = lazy(() => import("../pages/RemediationEngine").then((m) => ({ default: m.RemediationEngine })));
const Login = lazy(() => import("../pages/Login"));
const page = (element: ReactNode) => <Suspense fallback={null}>{element}</Suspense>;

// The design review page (/kit): only while developing. The demo build leaves it out entirely.
const Kit = import.meta.env.DEV ? lazy(() => import("../pages/Kit")) : null;
const devOnly: RouteObject[] = Kit ? [{ path: "/kit", element: page(<Kit />) }] : [];

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/login", element: page(<Login />) },
      {
        // On the real backend every page needs a signed-in analyst; on the simulated feed this does nothing.
        element: <RequireSession />,
        children: [
          { path: "/", element: page(<Landing />) },
          { path: "/live", element: page(<LiveDashboard />) },
          {
            path: "/engines",
            element: page(<EnginesLayout />),
            children: [
              { index: true, element: <Navigate to="detection" replace /> },
              { path: "detection", element: page(<DetectionEngine />) },
              { path: "remediation", element: page(<RemediationEngine />) },
            ],
          },
          ...devOnly,
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
