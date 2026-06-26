import { forwardRef, type AnimationEvent, type ChangeEvent, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
}

function syncAutofillValue(
  target: HTMLInputElement,
  onChange: InputHTMLAttributes<HTMLInputElement>['onChange'],
) {
  if (!onChange || !target.value) return;
  onChange({
    target,
    currentTarget: target,
    type: 'change',
  } as ChangeEvent<HTMLInputElement>);
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = '', onAnimationStart, onChange, ...props },
  ref,
) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');

  const handleAnimationStart = (event: AnimationEvent<HTMLInputElement>) => {
    if (event.animationName === 'onAutoFillStart') {
      syncAutofillValue(event.currentTarget, onChange);
    }
    onAnimationStart?.(event);
  };

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={inputId}
        ref={ref}
        onChange={onChange}
        onAnimationStart={handleAnimationStart}
        className={`w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
});
