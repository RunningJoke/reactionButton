import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { DEFAULT_PATH } from "./navigation";
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


// Hash routing: works offline, on any host path and inside the Capacitor webview.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/pod" element={<PodPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/programs/view" element={<ProgramViewPage />} />
          <Route path="/programs/new" element={<WizardPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/simulate" element={<SimulatePage />} />
          <Route path="/menu" element={<MenuPage />} />
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
