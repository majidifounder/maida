import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError } from '../lib/api.js';
import { CUISINE_TYPES } from '../types/api.js';
import { Card } from '../components/ui/Card.js';
import { Input, Select, TextArea } from '../components/ui/Input.js';
import { Button } from '../components/ui/Button.js';

const schema = z.object({
  name: z.string().min(2),
  description: z.string().min(10),
  cuisine: z.enum(CUISINE_TYPES),
  address: z.string().min(5),
  city: z.string().min(2),
});

type FormData = z.infer<typeof schema>;

export function CreateRestaurantPage() {
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { cuisine: 'ITALIAN' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setApiError(null);
    try {
      const res = await api.post<{ restaurant: { id: string } }>(
        '/restaurants',
        data,
      );
      navigate(`/restaurants/${res.restaurant.id}`);
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Failed to create');
    }
  });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-3xl font-bold">New restaurant</h1>
      <Card>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Input label="Name" error={errors.name?.message} {...register('name')} />
          <TextArea
            label="Description"
            error={errors.description?.message}
            {...register('description')}
          />
          <Select label="Cuisine" error={errors.cuisine?.message} {...register('cuisine')}>
            {CUISINE_TYPES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
          <Input label="Address" error={errors.address?.message} {...register('address')} />
          <Input label="City" error={errors.city?.message} {...register('city')} />
          {apiError && <p className="text-sm text-red-600">{apiError}</p>}
          <Button type="submit" loading={isSubmitting}>
            Create restaurant
          </Button>
        </form>
      </Card>
    </div>
  );
}
