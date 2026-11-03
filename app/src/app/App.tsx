import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Layout } from "./Layout";
import { DEFAULT_PATH, GAME_MODE_REDIRECTS, REDIRECTS } from "./navigation";
import { PodPage } from "../pages/PodPage";
import { MenuPage } from "../pages/MenuPage";
import { ProgramsPage } from "../pages/ProgramsPage";
import { GamePage } from "../pages/GamePage";
import { SettingsPage } from "../pages/SettingsPage";
import { ResultsPage } from "../pages/ResultsPage";
import { AthletePage } from "../pages/AthletePage";
import { SessionPage } from "../pages/SessionPage";
import { LoginPage } from "../pages/LoginPage";
import { WizardPage } from "../wizard/WizardPage";
import { TrainingPage } from "../pages/TrainingPage";


/** Keeps the query; `mode` sets the game page mode. */
export function Redirect({ to, mode }: { to: string; mode?: string }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (mode) params.set("mode", mode);
  const query = params.toString();
  return <Navigate to={to + (query ? `?${query}` : "")} replace />;
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
          <Route path="/games/game" element={<GamePage />} />
          <Route path="/games/new" element={<WizardPage />} />
          {Object.entries(GAME_MODE_REDIRECTS).map(([from, mode]) => (
            <Route key={from} path={from} element={<Redirect to="/games/game" mode={mode} />} />
          ))}
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
