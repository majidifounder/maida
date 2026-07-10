import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Button } from '../components/ui/Button.js';
import { FeedbackForm } from '../components/FeedbackForm.js';
import { VerifyEmailBanner } from '../components/VerifyEmailBanner.js';

export function RootLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/restaurants" className="text-xl font-bold text-brand-700">
            Maida
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/restaurants"
              className="text-sm font-medium text-gray-600 hover:text-brand-600"
            >
              Restaurants
            </Link>
            {!loading && user && (
              <Link
                to="/reservations"
                className="text-sm font-medium text-gray-600 hover:text-brand-600"
              >
                My reservations
              </Link>
            )}
            {!loading && user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{user.email}</span>
                <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
                  Logout
                </Button>
              </div>
            ) : (
              !loading && (
                <Link to="/login">
                  <Button size="sm">Login</Button>
                </Link>
              )
            )}
          </nav>
        </div>
      </header>
      <VerifyEmailBanner />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      {!loading && user && (
        <footer className="border-t border-gray-200 bg-gray-50">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <FeedbackForm />
          </div>
        </footer>
      )}
    </div>
  );
}
