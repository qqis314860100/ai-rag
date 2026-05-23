import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppShell } from "./components/shell";
import { DashboardPage, ChatPage, DocumentsPage, SopDocumentsPage, FavoritesPage, AnalyticsPage, DebuggerPage, SettingsPage } from "./pages";
import LoginPage from "./pages/LoginPage";
import { ToastContainer } from "./components/ui/Toast";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={
        <RequireAuth>
          <AppShell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/sop" element={<SopDocumentsPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/debugger" element={<DebuggerPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </AppShell>
        </RequireAuth>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
      <ToastContainer />
    </AuthProvider>
  );
}
