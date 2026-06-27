import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError } from '../lib/api.js';
import { Card } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'One uppercase letter')
      .regex(/[0-9]/, 'One number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);
  const token = searchParams.get('token') ?? '';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md text-center">
          <p className="font-medium text-red-600">
            Invalid or missing reset token.
          </p>
          <Link
            to="/forgot-password"
            className="mt-3 inline-block text-sm text-brand hover:underline"
          >
            Request a new link
          </Link>
        </Card>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (data) => {
    setApiError(null);
    try {
      await api.post('/auth/reset-password', {
        token,
        password: data.password,
      });
      navigate('/login?reset=success');
    } catch (err) {
      setApiError(
        err instanceof ApiError
          ? err.message
          : 'This link is invalid or has expired.',
      );
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Set new password</h1>
        <p className="mb-6 text-sm text-gray-600">
          Choose a strong password for your account.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <Input
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          {apiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{apiError}</p>
              <Link
                to="/forgot-password"
                className="mt-1 block text-sm text-red-600 hover:underline"
              >
                Request a new link →
              </Link>
            </div>
          )}

          <Button type="submit" className="w-full" loading={isSubmitting}>
            Set new password
          </Button>
        </form>
      </Card>
    </div>
  );
}
