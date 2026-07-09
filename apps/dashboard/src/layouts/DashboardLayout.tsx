import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { useOwnerPlan } from '../hooks/useOwnerPlan.js';
import { billingTierLabel } from '../lib/plan-limits.js';
import { TrialBanner } from '../components/TrialBanner.js';
import { FeedbackForm } from '../components/FeedbackForm.js';
import { Button } from '../components/ui/Button.js';

function BillingIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  );
}

function RestaurantsIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-brand text-white'
      : 'text-gray-700 hover:bg-gray-100'
  }`;

export function DashboardLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const { billingTier, isTrialActive, trialDaysRemaining } = useOwnerPlan();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-5">
          <Link to="/restaurants" className="text-lg font-bold text-brand">
            Owner Dashboard
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          <NavLink to="/restaurants" className={navLinkClass}>
            <RestaurantsIcon />
            Restaurants
          </NavLink>
          <NavLink to="/billing" className={navLinkClass}>
            <BillingIcon />
            Billing
          </NavLink>

          {!loading && user && (
            <div className="mt-auto px-3 py-2">
              <span className="text-xs text-gray-400">Plan</span>
              <p className="text-sm font-semibold text-gray-700">
                {billingTierLabel(billingTier)}
              </p>
              {isTrialActive && trialDaysRemaining != null && (
                <p className="text-xs text-blue-700">
                  {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} left
                </p>
              )}
            </div>
          )}
        </nav>

        {!loading && user && (
          <div className="border-t border-gray-200 p-4">
            <FeedbackForm />
          </div>
        )}

        {!loading && user && (
          <div className="border-t border-gray-200 p-4">
            <p className="truncate text-xs text-gray-500">{user.email}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              onClick={() => void handleLogout()}
            >
              Logout
            </Button>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col">
        {!loading && user && <TrialBanner />}
        <main className="flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
