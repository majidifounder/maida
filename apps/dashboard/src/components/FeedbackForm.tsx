import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api.js';
import { Button } from './ui/Button.js';

interface FeedbackFormProps {
  className?: string;
}

export function FeedbackForm({ className = '' }: FeedbackFormProps) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post('/feedback', { message });
      setMessage('');
      setSent(true);
      toast.success('Thanks — your feedback was sent to the Maida team.');
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className={`rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 ${className}`}>
        <p className="font-medium">Feedback received</p>
        <p className="mt-1">Only the Maida team sees this — it is not shared with other users.</p>
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
    <div className={`space-y-3 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Product feedback</h3>
        <p className="mt-1 text-xs text-gray-500">
          Tell us how Maida could work better for you. Internal only — not a restaurant
          review and never shown to other diners or owners.
        </p>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="What would make Maida more useful for you?"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
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
