import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../lib/api.js';
import { Card } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';

const schema = z.object({
  email: z.string().email('Please enter a valid email'),
});

type FormData = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
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
        setError('email', { message: issue.message });
      });
      return;
    }

    try {
      await api.post('/auth/forgot-password', parsed.data);
    } catch {
      /* always show success — no enumeration */
    }
    setSent(true);
  });

  if (sent) {
    return (
      <div className="mx-auto max-w-md text-center">
        <Card>
          <div className="space-y-4">
            <div className="text-5xl">✉️</div>
            <h2 className="text-2xl font-bold text-gray-900">Check your email</h2>
            <p className="text-gray-600">
              If an account exists for that email address, we&apos;ve sent a
              password reset link. The link expires in{' '}
              <strong>1 hour</strong>.
            </p>
            <Link
              to="/login"
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Back to login
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">Forgot password?</h1>
        <p className="mb-6 text-sm text-gray-600">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600">
          <Link
            to="/login"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Back to login
          </Link>
        </p>
      </Card>
    </div>
  );
}
