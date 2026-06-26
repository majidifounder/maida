import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext.js';
import { Card } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';

const schema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const { register: registerOwner } = useAuth();
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>();

  const onSubmit = handleSubmit(async (data) => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return;
    setApiError(null);
    try {
      await registerOwner(parsed.data.email, parsed.data.password);
      navigate('/restaurants');
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Registration failed');
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-6 text-2xl font-bold">Register as owner</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Input label="Email" type="email" {...register('email')} />
          <Input label="Password" type="password" {...register('password')} />
          <Input
            label="Confirm password"
            type="password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          {apiError && <p className="text-sm text-red-600">{apiError}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          <Link to="/login" className="font-medium text-brand">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
