import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Layout, { RequireAuth } from './components/layout/Layout.jsx';
import { Loading } from './components/ui/index.jsx';
import HomePage from './features/home/HomePage.jsx';
import { LoginPage, ProfilePage, RegisterPage } from './features/auth/AuthPages.jsx';

const RequestWizard = lazy(() => import('./features/requests/RequestWizard.jsx'));
const RequestDetailPage = lazy(() => import('./features/requests/RequestDetailPage.jsx'));
const FindHelpPage = lazy(() => import('./features/resources/FindHelpPage.jsx'));
const DisasterUpdatesPage = lazy(() => import('./features/disaster/DisasterUpdatesPage.jsx'));
const TrackPage = lazy(() => import('./features/tracking/TrackPages.jsx').then((m) => ({ default: m.TrackPage })));
const PublicTrackingPage = lazy(() => import('./features/tracking/TrackPages.jsx').then((m) => ({ default: m.PublicTrackingPage })));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage.jsx'));
const OpsLayout = lazy(() => import('./features/ops/OpsLayout.jsx'));
const OpsIndex = lazy(() => import('./features/ops/OpsLayout.jsx').then((m) => ({ default: m.OpsIndex })));
const OverviewPage = lazy(() => import('./features/ops/OverviewPage.jsx'));
const RequestsQueuePage = lazy(() => import('./features/ops/RequestsQueuePage.jsx'));
const AlertsPage = lazy(() => import('./features/ops/AlertsPage.jsx'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage.jsx'));
const DispatchPage = lazy(() => import('./features/dispatch/DispatchPage.jsx'));
const AdminPage = lazy(() => import('./features/admin/AdminPage.jsx'));

const STAFF = ['CAMP_MANAGER', 'RELIEF_COORDINATOR', 'INVENTORY_MANAGER', 'RESPONSE_TEAM', 'ADMIN'];

function NotFound() {
  return (
    <div className="container section">
      <h1>Page not found</h1>
      <p className="lead">The page you were looking for does not exist.</p>
      <Link to="/" className="btn btn-primary">
        Go home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="help" element={<FindHelpPage />} />
          <Route path="updates" element={<DisasterUpdatesPage />} />
          <Route path="track" element={<TrackPage />} />
          <Route path="track/:token" element={<PublicTrackingPage />} />
          <Route
            path="request"
            element={
              <RequireAuth roles={['CITIZEN', 'CAMP_MANAGER', 'RELIEF_COORDINATOR', 'ADMIN']}>
                <RequestWizard />
              </RequireAuth>
            }
          />
          <Route
            path="requests/:requestId"
            element={
              <RequireAuth>
                <RequestDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="notifications"
            element={
              <RequireAuth>
                <NotificationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="ops"
            element={
              <RequireAuth roles={STAFF}>
                <OpsLayout />
              </RequireAuth>
            }
          >
            <Route index element={<OpsIndex />} />
            <Route path="overview" element={<RequireAuth roles={['RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER']}><OverviewPage /></RequireAuth>} />
            <Route path="requests" element={<RequestsQueuePage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="inventory" element={<RequireAuth roles={['INVENTORY_MANAGER', 'RELIEF_COORDINATOR', 'ADMIN']}><InventoryPage /></RequireAuth>} />
            <Route path="dispatch" element={<RequireAuth roles={['RESPONSE_TEAM', 'RELIEF_COORDINATOR', 'ADMIN']}><DispatchPage /></RequireAuth>} />
            <Route path="admin" element={<RequireAuth roles={['ADMIN']}><AdminPage /></RequireAuth>} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
