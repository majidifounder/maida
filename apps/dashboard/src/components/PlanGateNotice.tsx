import { Link } from 'react-router-dom';

interface PlanGateNoticeProps {
  message: string;
  upgradePlan?: string;
}

export function PlanGateNotice({ message, upgradePlan = 'Pro' }: PlanGateNoticeProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{message}</p>
      <Link
        to="/billing"
        className="mt-1 inline-block font-medium text-amber-800 underline hover:no-underline"
      >
        Upgrade to {upgradePlan} on Billing →
      </Link>
    </div>
  );
}
