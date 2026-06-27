import { createBrowserRouter, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import { RestaurantListPage } from './pages/RestaurantListPage.js';
import { CreateRestaurantPage } from './pages/CreateRestaurantPage.js';
import { RestaurantDetailPage } from './pages/RestaurantDetailPage.js';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="/restaurants" replace /> },
          { path: 'restaurants', element: <RestaurantListPage /> },
          { path: 'restaurants/new', element: <CreateRestaurantPage /> },
          { path: 'restaurants/:id', element: <RestaurantDetailPage /> },
        ],
      },
    ],
  },
]);
