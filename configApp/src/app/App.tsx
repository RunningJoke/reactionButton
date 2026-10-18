import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { DEFAULT_PATH } from "./navigation";
import { PodPage } from "../pages/PodPage";
import { EditorPage, MenuPage, SimulatePage } from "../pages/SimplePages";
import { ProgramsPage } from "../pages/ProgramsPage";
import { SettingsPage } from "../pages/SettingsPage";

// the graph view pulls in React Flow and dagre; load it when first opened
const ProgramViewPage = lazy(() => import("../pages/ProgramViewPage").then((m) => ({ default: m.ProgramViewPage })));

// Hash routing: works offline, on any host path and inside the Capacitor webview.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/pod" element={<PodPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route
            path="/programs/view"
            element={
              <Suspense fallback={null}>
                <ProgramViewPage />
              </Suspense>
            }
          />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/simulate" element={<SimulatePage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
