import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Turnstile } from '@marsidev/react-turnstile';
import { useAuth } from '../context/AuthContext.js';
import { ApiError } from '../lib/api.js';
import { Card } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';

const turnstileSiteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

const schema = z
  .object({
    email: z.string().email('Enter a valid email'),
    // Mirror the API's RegisterSchema so invalid passwords fail inline instead
    // of round-tripping to a 422 (apps/api/src/modules/auth/auth.schema.ts).
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormData>();

  const onSubmit = handleSubmit(async (data) => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof FormData;
        setError(field, { message: issue.message });
      });
      return;
    }

    setApiError(null);
    try {
      await registerUser(
        parsed.data.email,
        parsed.data.password,
        'diner',
        turnstileToken ?? undefined,
      );
      navigate('/restaurants');
    } catch (err) {
      setApiError(
        err instanceof ApiError
          ? err.message
          : 'Registration failed. Please try again.',
      );
    }
  });

  const submitDisabled =
    isSubmitting || (Boolean(turnstileSiteKey) && !turnstileToken);

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Create account</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Password"
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
          {turnstileSiteKey && (
            <Turnstile
              siteKey={turnstileSiteKey}
              onSuccess={(token) => setTurnstileToken(token)}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
            />
          )}
          {apiError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {apiError}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            loading={isSubmitting}
            disabled={submitDisabled}
          >
            Register as diner
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
