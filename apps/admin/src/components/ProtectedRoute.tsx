import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Spinner } from './ui/Spinner.js';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}
