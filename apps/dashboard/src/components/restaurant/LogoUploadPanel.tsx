import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import { Button } from '../ui/Button.js';

interface LogoUploadPanelProps {
  restaurantId: string;
  imageUrl: string | null;
  restaurantName: string;
}

export function LogoUploadPanel({
  restaurantId,
  imageUrl,
  restaurantName,
}: LogoUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      const res = await api.post<{ imageUrl: string }>(
        `/restaurants/${restaurantId}/logo`,
        form,
      );
      return res.imageUrl;
    },
    onSuccess: () => {
      toast.success('Logo updated');
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['restaurant-config', restaurantId] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not upload logo');
    },
  });

  const displayUrl = preview ?? imageUrl;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={`${restaurantName} logo`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-3xl text-gray-400">🍽</span>
        )}
      </div>
      <div className="flex-1 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Restaurant logo</h3>
        <p className="text-sm text-gray-600">
          Shown on your dashboard and the public restaurant page. JPEG, PNG, or WebP only
          — max 2 MB. SVG is not accepted.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              toast.error('Logo must be 2 MB or smaller.');
              return;
            }
            setPreview(URL.createObjectURL(file));
            uploadMutation.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploadMutation.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {imageUrl ? 'Replace logo' : 'Upload logo'}
        </Button>
      </div>
    </div>
  );
}
