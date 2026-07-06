import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { DiningTableRow, TableCombinationRow } from '../../types/api.js';
import { useOwnerPlan } from '../../hooks/useOwnerPlan.js';
import { Card } from '../ui/Card.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { Spinner } from '../ui/Spinner.js';
import { PlanGateNotice } from '../PlanGateNotice.js';

interface CombinationsPanelProps {
  restaurantId: string;
  seatingMode: string;
}

export function CombinationsPanel({
  restaurantId,
  seatingMode,
}: CombinationsPanelProps) {
  const queryClient = useQueryClient();
  const { limits, plan } = useOwnerPlan();

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [minParty, setMinParty] = useState(5);
  const [maxParty, setMaxParty] = useState(8);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);

  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () =>
      api
        .get<{ tables: DiningTableRow[] }>(`/restaurants/${restaurantId}/tables`)
        .then((r) => r.tables),
  });

  const combosQuery = useQuery({
    queryKey: ['combinations', restaurantId],
    queryFn: () =>
      api
        .get<{ combinations: TableCombinationRow[] }>(
          `/restaurants/${restaurantId}/combinations`,
        )
        .then((r) => r.combinations),
    enabled: seatingMode === 'FLEXIBLE',
  });

  if (seatingMode !== 'FLEXIBLE') {
    return (
      <Card>
        <h2 className="text-xl font-semibold">Table combinations</h2>
        <p className="mt-2 text-sm text-gray-600">
          Combine tables for larger parties when using flexible seating. Switch to
          flexible seating in reservation settings to define combinations.
        </p>
      </Card>
    );
  }

  const activeTables = (tablesQuery.data ?? []).filter((t) => t.isActive);
  const combinations = combosQuery.data ?? [];
  const atComboLimit =
    limits.combinationsPerRestaurant !== Infinity &&
    combinations.filter((c) => c.isActive).length >= limits.combinationsPerRestaurant;

  const tableName = (id: string) =>
    activeTables.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['combinations', restaurantId] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/restaurants/${restaurantId}/combinations`, {
        name,
        minPartySize: minParty,
        maxPartySize: maxParty,
        tableIds: selectedTableIds,
      }),
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      setName('');
      setSelectedTableIds([]);
      toast.success('Combination created');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create combination');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (combinationId: string) =>
      api.delete(`/restaurants/${restaurantId}/combinations/${combinationId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Combination removed');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove combination');
    },
  });

  const toggleTable = (tableId: string) => {
    setSelectedTableIds((prev) =>
      prev.includes(tableId)
        ? prev.filter((id) => id !== tableId)
        : [...prev, tableId],
    );
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Table combinations</h2>
          <p className="text-sm text-gray-500">
            Merge fixed tables for larger parties ({plan} plan:{' '}
            {limits.combinationsPerRestaurant === Infinity
              ? 'unlimited'
              : `up to ${limits.combinationsPerRestaurant}`}
            )
          </p>
        </div>
        <Button
          size="sm"
          disabled={atComboLimit || activeTables.length < 2}
          onClick={() => setShowAdd((v) => !v)}
        >
          Add combination
        </Button>
      </div>

      {limits.combinationsPerRestaurant === 0 && (
        <PlanGateNotice message="Table combinations require a Pro or Premium plan." />
      )}

      {atComboLimit && limits.combinationsPerRestaurant > 0 && (
        <div className="mb-4">
          <PlanGateNotice
            message={`You've reached the ${limits.combinationsPerRestaurant}-combination limit on ${plan}.`}
          />
        </div>
      )}

      {showAdd && (
        <div className="mb-4 space-y-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <div className="flex flex-wrap gap-3">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
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
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              Select tables to merge (minimum 2)
            </p>
            <div className="flex flex-wrap gap-2">
              {activeTables.map((table) => (
                <label
                  key={table.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedTableIds.includes(table.id)}
                    onChange={() => toggleTable(table.id)}
                  />
                  {table.name} ({table.maxPartySize} seats)
                </label>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            loading={addMutation.isPending}
            disabled={!name.trim() || selectedTableIds.length < 2}
            onClick={() => addMutation.mutate()}
          >
            Create combination
          </Button>
        </div>
      )}

      {combosQuery.isLoading && <Spinner />}
      {!combosQuery.isLoading && combinations.length === 0 && (
        <p className="text-gray-500">
          No combinations defined. Create one to seat parties larger than a single table
          allows.
        </p>
      )}

      <ul className="divide-y">
        {combinations.map((combo) => (
          <li
            key={combo.id}
            className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium">{combo.name}</p>
              <p className="text-sm text-gray-500">
                Party {combo.minPartySize}–{combo.maxPartySize} · tables:{' '}
                {combo.tableIds.map(tableName).join(', ')}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (window.confirm('Remove this combination?')) {
                  deleteMutation.mutate(combo.id);
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
