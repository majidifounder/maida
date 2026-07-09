import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './layouts/RootLayout.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import { RestaurantListPage } from './pages/RestaurantListPage.js';
import { RestaurantDetailPage } from './pages/RestaurantDetailPage.js';
import { MyBookingsPage } from './pages/MyBookingsPage.js';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/restaurants" replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'restaurants', element: <RestaurantListPage /> },
      { path: 'restaurants/:id', element: <RestaurantDetailPage /> },
      { path: 'bookings', element: <Navigate to="/reservations" replace /> },
      {
        element: <ProtectedRoute />,
        children: [{ path: 'reservations', element: <MyBookingsPage /> }],
      },
    ],
  },
]);
