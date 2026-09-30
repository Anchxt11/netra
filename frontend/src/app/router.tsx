import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { LiveDashboard } from "../pages/LiveDashboard";
import { EnginesLayout } from "../pages/EnginesLayout";
import { DetectionEngine } from "../pages/DetectionEngine";
import { RemediationEngine } from "../pages/RemediationEngine";

// The landing page carries the globe libraries, so the dashboard never downloads it.
const Landing = lazy(() => import("../pages/Landing"));

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        path: "/",
        element: (
          <Suspense fallback={null}>
            <Landing />
          </Suspense>
        ),
      },
      { path: "/live", element: <LiveDashboard /> },
      {
        path: "/engines",
        element: <EnginesLayout />,
        children: [
          { index: true, element: <Navigate to="detection" replace /> },
          { path: "detection", element: <DetectionEngine /> },
          { path: "remediation", element: <RemediationEngine /> },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
