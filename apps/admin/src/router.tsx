import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AdminLayout } from './layouts/AdminLayout.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { UserDetailPage } from './pages/UserDetailPage.js';
import { RestaurantsPage } from './pages/RestaurantsPage.js';
import { BookingsPage } from './pages/BookingsPage.js';
import { SubscriptionsPage } from './pages/SubscriptionsPage.js';
import { AuditLogsPage } from './pages/AuditLogsPage.js';

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'users/:id', element: <UserDetailPage /> },
      { path: 'restaurants', element: <RestaurantsPage /> },
      { path: 'bookings', element: <BookingsPage /> },
      { path: 'subscriptions', element: <SubscriptionsPage /> },
      { path: 'audit-logs', element: <AuditLogsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
