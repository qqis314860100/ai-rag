import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppShell } from "./components/shell";
import ChatPage from "./features/chat/ChatPage";
import LoginPage from "./pages/LoginPage";
import { ToastContainer } from "./components/ui/Toast";

const DocumentsPage = lazy(() => import("./pages/DocumentsPage"));
const KnowledgeAssetsPage = lazy(() => import("./pages/KnowledgeAssetsPage"));
const KnowledgeGapsPage = lazy(() => import("./pages/KnowledgeGapsPage"));
const SopDocumentsPage = lazy(() => import("./pages/SopDocumentsPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const DebuggerPage = lazy(() => import("./pages/DebuggerPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-page text-sm text-text-muted">
      页面加载中...
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/chat" replace /> : <LoginPage />} />
      <Route path="/*" element={
        <RequireAuth>
          <AppShell>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to="/chat" replace />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/documents" element={<DocumentsPage />} />
                <Route path="/knowledge-assets" element={<KnowledgeAssetsPage />} />
                <Route path="/knowledge-gaps" element={<KnowledgeGapsPage />} />
                <Route path="/sop" element={<SopDocumentsPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/debugger" element={<DebuggerPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </Suspense>
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
