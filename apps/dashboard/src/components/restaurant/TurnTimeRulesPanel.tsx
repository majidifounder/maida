import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { TurnTimeRuleRow } from '../../types/api.js';
import { useOwnerPlan } from '../../hooks/useOwnerPlan.js';
import { Card } from '../ui/Card.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { Spinner } from '../ui/Spinner.js';
import { PlanGateNotice } from '../PlanGateNotice.js';

interface TurnTimeRulesPanelProps {
  restaurantId: string;
}

export function TurnTimeRulesPanel({ restaurantId }: TurnTimeRulesPanelProps) {
  const queryClient = useQueryClient();
  const { limits, plan } = useOwnerPlan();

  const [showAdd, setShowAdd] = useState(false);
  const [minParty, setMinParty] = useState(1);
  const [maxParty, setMaxParty] = useState(2);
  const [durationMins, setDurationMins] = useState(60);

  const rulesQuery = useQuery({
    queryKey: ['turn-time-rules', restaurantId],
    queryFn: () =>
      api
        .get<{ rules: TurnTimeRuleRow[] }>(
          `/restaurants/${restaurantId}/turn-time-rules`,
        )
        .then((r) => r.rules),
  });

  const rules = rulesQuery.data ?? [];
  const atRuleLimit =
    limits.turnTimeRulesPerRestaurant !== Infinity &&
    rules.length >= limits.turnTimeRulesPerRestaurant;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['turn-time-rules', restaurantId] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/restaurants/${restaurantId}/turn-time-rules`, {
        minPartySize: minParty,
        maxPartySize: maxParty,
        durationMins,
      }),
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      toast.success('Turn-time rule added');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add rule');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) =>
      api.delete(`/restaurants/${restaurantId}/turn-time-rules/${ruleId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Rule removed');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove rule');
    },
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Turn-time rules</h2>
          <p className="text-sm text-gray-500">
            Override default duration by party size ({plan}:{' '}
            {limits.turnTimeRulesPerRestaurant === Infinity
              ? 'unlimited'
              : `up to ${limits.turnTimeRulesPerRestaurant}`}{' '}
            rule{limits.turnTimeRulesPerRestaurant === 1 ? '' : 's'})
          </p>
        </div>
        <Button size="sm" disabled={atRuleLimit} onClick={() => setShowAdd((v) => !v)}>
          Add rule
        </Button>
      </div>

      {atRuleLimit && (
        <div className="mb-4">
          <PlanGateNotice
            message={`You've reached your plan limit of ${limits.turnTimeRulesPerRestaurant} turn-time rule(s). Upgrade on Billing to add more, or delete an existing rule.`}
          />
        </div>
      )}

      {showAdd && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-mist bg-fog p-4">
          <Input
            label="Min party"
            type="number"
            min={1}
            value={minParty}
            onChange={(e) => setMinParty(Number(e.target.value))}
          />
          <Input
            label="Max party"
            type="number"
            min={1}
            value={maxParty}
            onChange={(e) => setMaxParty(Number(e.target.value))}
          />
          <Input
            label="Duration (minutes)"
            type="number"
            min={15}
            max={720}
            value={durationMins}
            onChange={(e) => setDurationMins(Number(e.target.value))}
          />
          <Button
            size="sm"
            loading={addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            Add
          </Button>
        </div>
      )}

      {rulesQuery.isLoading && <Spinner />}
      {!rulesQuery.isLoading && rules.length === 0 && (
        <p className="text-gray-500">
          No turn-time rules — the default reservation duration from settings applies to
          all party sizes.
        </p>
      )}

      <ul className="divide-y">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex items-center justify-between py-3 text-sm"
          >
            <span>
              Party {rule.minPartySize}–{rule.maxPartySize} →{' '}
              <strong>{rule.durationMins} min</strong>
            </span>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (window.confirm('Remove this turn-time rule?')) {
                  deleteMutation.mutate(rule.id);
                }
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
