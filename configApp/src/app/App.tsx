import { HashRouter, Navigate, Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { DEFAULT_PATH } from "./navigation";
import { PodPage } from "../pages/PodPage";
import { EditorPage } from "../pages/EditorPage";
import { MenuPage } from "../pages/MenuPage";
import { SimulatePage } from "../pages/SimplePages";
import { ProgramsPage } from "../pages/ProgramsPage";
import { ProgramViewPage } from "../pages/ProgramViewPage";
import { SettingsPage } from "../pages/SettingsPage";


// Hash routing: works offline, on any host path and inside the Capacitor webview.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/pod" element={<PodPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/programs/view" element={<ProgramViewPage />} />
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
