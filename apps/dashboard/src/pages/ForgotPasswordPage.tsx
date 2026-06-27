import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await api.post('/auth/forgot-password', data);
    } catch {
      /* always show success — no enumeration */
    }
    setSent(true);
  });

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md text-center">
          <div className="space-y-4">
            <div className="text-5xl">✉️</div>
            <h2 className="text-2xl font-bold text-gray-900">Check your email</h2>
            <p className="text-gray-600">
              If an account exists for that email address, we&apos;ve sent a
              password reset link. The link expires in{' '}
              <strong>1 hour</strong>.
            </p>
            <Link to="/login" className="text-sm text-brand hover:underline">
              Back to login
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Forgot password?</h1>
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
          <Link to="/login" className="font-medium text-brand hover:underline">
            Back to login
          </Link>
        </p>
      </Card>
    </div>
  );
}
