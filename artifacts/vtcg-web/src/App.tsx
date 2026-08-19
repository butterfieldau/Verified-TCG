import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AdminLayout } from '@/layouts/admin-layout';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { LoginScreen } from '@/pages/login';

// Pages
import OverviewPage from '@/pages/overview';
import UsersPage from '@/pages/users';
import ScansPage from '@/pages/scans';
import ReportsPage from '@/pages/reports';
import ContactPage from '@/pages/contact';
import TeamPage from '@/pages/team';
import SessionsPage from '@/pages/sessions';
import ActivatePage from '@/pages/activate';
import NotificationsPage from '@/pages/notifications';
import RequestsPage from '@/pages/requests';
import AnnouncementsPage from '@/pages/announcements';

import {
  Route,
  Switch,
  useLocation,
  Redirect,
  Router as WouterRouter,
} from 'wouter';
import { ShieldX } from 'lucide-react';

const queryClient = new QueryClient();

function ProtectedRoute({
  component: Component,
  permission,
  requireOwner = false,
}: {
  component: React.ComponentType;
  permission: string;
  requireOwner?: boolean;
}) {
  const { auth, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-background" aria-label="Checking session" />;
  }
  if (!auth) return <Redirect to="/login" />;
  const denied =
    (requireOwner && auth.admin.role !== 'owner') ||
    !auth.permissions.includes(permission);
  if (denied) {
    return (
      <AdminLayout>
        <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center p-6 text-center">
          <div>
            <ShieldX className="mx-auto mb-4 text-muted-foreground" size={36} />
            <h1 className="font-display text-2xl font-bold">Access unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your administrator permission set does not include this section.
            </p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <Component />
    </AdminLayout>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={LoginScreen} />
        <Route path="/activate" component={ActivatePage} />

        <Route path="/">
          <Redirect to="/overview" />
        </Route>
        <Route path="/overview">
          {() => <ProtectedRoute component={OverviewPage} permission="dashboard:read" />}
        </Route>
        <Route path="/users">
          {() => <ProtectedRoute component={UsersPage} permission="users:read" />}
        </Route>
        <Route path="/scans">
          {() => <ProtectedRoute component={ScansPage} permission="analytics:read" />}
        </Route>
        <Route path="/reports">
          {() => <ProtectedRoute component={ReportsPage} permission="reports:read" />}
        </Route>
        <Route path="/contact">
          {() => <ProtectedRoute component={ContactPage} permission="support:read" />}
        </Route>
        <Route path="/notifications">
          {() => <ProtectedRoute component={NotificationsPage} permission="notifications:read" />}
        </Route>
        <Route path="/requests">
          {() => <ProtectedRoute component={RequestsPage} permission="privacy:read" />}
        </Route>
        <Route path="/announcements">
          {() => <ProtectedRoute component={AnnouncementsPage} permission="announcements:read" />}
        </Route>
        <Route path="/team">
          {() => <ProtectedRoute component={TeamPage} permission="team:read" requireOwner />}
        </Route>
        <Route path="/sessions">
          {() => <ProtectedRoute component={SessionsPage} permission="sessions:read" requireOwner />}
        </Route>

        <Route path="/admin">
          <Redirect to="/overview" />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
