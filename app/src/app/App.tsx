import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Layout } from "./Layout";
import { DEFAULT_PATH, REDIRECTS } from "./navigation";
import { PodPage } from "../pages/PodPage";
import { EditorPage } from "../pages/EditorPage";
import { MenuPage } from "../pages/MenuPage";
import { SimulatePage } from "../pages/SimulatePage";
import { ProgramsPage } from "../pages/ProgramsPage";
import { ProgramViewPage } from "../pages/ProgramViewPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ResultsPage } from "../pages/ResultsPage";
import { AthletePage } from "../pages/AthletePage";
import { SessionPage } from "../pages/SessionPage";
import { LoginPage } from "../pages/LoginPage";
import { WizardPage } from "../wizard/WizardPage";
import { TrainingPage } from "../pages/TrainingPage";


function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
}

// Hash routing: works offline, on any host path and inside the Capacitor webview.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/train" element={<TrainingPage />} />
          <Route path="/set" element={<PodPage />} />
          <Route path="/set/menu" element={<MenuPage />} />
          <Route path="/games" element={<ProgramsPage />} />
          <Route path="/games/view" element={<ProgramViewPage />} />
          <Route path="/games/new" element={<WizardPage />} />
          <Route path="/games/edit" element={<EditorPage />} />
          <Route path="/games/try" element={<SimulatePage />} />
          {Object.entries(REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Redirect to={to} />} />
          ))}
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/results/athlete" element={<AthletePage />} />
          <Route path="/results/session" element={<SessionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
