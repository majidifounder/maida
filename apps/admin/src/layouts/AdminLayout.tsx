import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Button } from '../components/ui/Button.js';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/users', label: 'Users', icon: '👥' },
  { to: '/restaurants', label: 'Restaurants', icon: '🍽️' },
  { to: '/bookings', label: 'Bookings', icon: '📅' },
  { to: '/subscriptions', label: 'Subscriptions', icon: '💳' },
  { to: '/audit-logs', label: 'Audit Logs', icon: '📋' },
];

export function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 flex-shrink-0 flex-col bg-sidebar">
        <div className="border-b border-sidebar-border px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Admin Panel
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            Restaurant Platform
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-400 hover:bg-sidebar-hover hover:text-white'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <p className="truncate text-xs text-slate-400">{user?.email}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-slate-400 hover:text-white"
            onClick={() => void logout()}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
