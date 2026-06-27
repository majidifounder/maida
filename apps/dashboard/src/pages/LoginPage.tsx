import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext.js';
import { ApiError } from '../lib/api.js';
import { Card } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resetSuccess = searchParams.get('reset') === 'success';
  const [apiError, setApiError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormData>();

  const onSubmit = handleSubmit(async (data) => {
    setApiError(null);
    try {
      await login(data.email, data.password);
      navigate('/restaurants');
    } catch (err) {
      setApiError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Login failed',
      );
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-6 text-2xl font-bold">Owner sign in</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {resetSuccess && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              Password updated successfully. Please log in with your new password.
            </div>
          )}
          <Input label="Email" type="email" {...register('email')} />
          <Input label="Password" type="password" {...register('password')} />
          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-brand hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          {apiError && <p className="text-sm text-red-600">{apiError}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          New owner?{' '}
          <Link to="/register" className="font-medium text-brand">
            Register
          </Link>
        </p>
      </Card>
    </div>
  );
}
