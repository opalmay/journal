import { Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactElement } from "react";
import { Layout } from "./components/Layout.js";
import { Spinner } from "./components/ui.js";
import { useMe } from "./lib/queries.js";
import { LoginPage } from "./pages/Login.js";
import { TimelinePage } from "./pages/Timeline.js";
import { DayPage } from "./pages/Day.js";
import { SearchPage } from "./pages/Search.js";
import { CalendarPage } from "./pages/Calendar.js";
import { SettingsPage } from "./pages/Settings.js";

function RequireAuth({ children }: { children: ReactElement }) {
  const { data, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <Spinner label="Checking session" />;
  if (!data?.authenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<TimelinePage />} />
        <Route path="day/:date" element={<DayPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
