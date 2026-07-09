import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { Button } from './ui/Button.js';

export function FeedbackForm() {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/feedback', { message });
      setMessage('');
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not send feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <p className="font-medium">Feedback received</p>
        <p className="mt-1">Only the Maida team sees this — not shared with restaurants or other diners.</p>
        <button
          type="button"
          className="mt-2 text-sm font-medium text-green-900 underline"
          onClick={() => setSent(false)}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Product feedback</h3>
        <p className="mt-1 text-xs text-gray-500">
          Help us improve Maida. This is not a restaurant review — it goes to our team only.
        </p>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="What would make booking easier?"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{message.length}/2000</span>
        <Button
          type="button"
          size="sm"
          loading={submitting}
          disabled={message.trim().length < 10}
          onClick={() => void submit()}
        >
          Send feedback
        </Button>
      </div>
    </div>
  );
}
