import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../../lib/api.js';
import type { DiningTableRow } from '../../types/api.js';
import { useOwnerPlan } from '../../hooks/useOwnerPlan.js';
import { Card } from '../ui/Card.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { Spinner } from '../ui/Spinner.js';
import { PlanGateNotice } from '../PlanGateNotice.js';

interface TablesPanelProps {
  restaurantId: string;
}

export function TablesPanel({ restaurantId }: TablesPanelProps) {
  const queryClient = useQueryClient();
  const { limits, plan } = useOwnerPlan();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMin, setNewMin] = useState(1);
  const [newMax, setNewMax] = useState(4);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMin, setEditMin] = useState(1);
  const [editMax, setEditMax] = useState(4);
  const [editActive, setEditActive] = useState(true);

  const tablesQuery = useQuery({
    queryKey: ['tables', restaurantId],
    queryFn: () =>
      api
        .get<{ tables: DiningTableRow[] }>(`/restaurants/${restaurantId}/tables`)
        .then((r) => r.tables),
  });

  const tables = tablesQuery.data ?? [];
  const activeCount = tables.filter((t) => t.isActive).length;
  const atTableLimit =
    limits.tablesPerRestaurant !== Infinity &&
    activeCount >= limits.tablesPerRestaurant;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tables', restaurantId] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/restaurants/${restaurantId}/tables`, {
        name: newName,
        minPartySize: newMin,
        maxPartySize: newMax,
      }),
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      setNewName('');
      setNewMin(1);
      setNewMax(4);
      toast.success('Table added');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add table');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (tableId: string) =>
      api.patch(`/restaurants/${restaurantId}/tables/${tableId}`, {
        name: editName,
        minPartySize: editMin,
        maxPartySize: editMax,
        isActive: editActive,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast.success('Table updated');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update table');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (tableId: string) =>
      api.delete(`/restaurants/${restaurantId}/tables/${tableId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Table deactivated');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove table');
    },
  });

  const startEdit = (table: DiningTableRow) => {
    setEditingId(table.id);
    setEditName(table.name);
    setEditMin(table.minPartySize);
    setEditMax(table.maxPartySize);
    setEditActive(table.isActive);
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Tables</h2>
          <p className="text-sm text-gray-500">
            {activeCount} active
            {limits.tablesPerRestaurant !== Infinity &&
              ` · ${plan} plan allows up to ${limits.tablesPerRestaurant}`}
          </p>
        </div>
        <Button
          size="sm"
          disabled={atTableLimit}
          onClick={() => setShowAdd((v) => !v)}
        >
          Add table
        </Button>
      </div>

      {atTableLimit && (
        <div className="mb-4">
          <PlanGateNotice
            message={`You've reached the ${limits.tablesPerRestaurant}-table limit on your ${plan} plan.`}
          />
        </div>
      )}

      {showAdd && (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              label="Min party"
              type="number"
              min={1}
              value={newMin}
              onChange={(e) => setNewMin(Number(e.target.value))}
            />
            <Input
              label="Max party"
              type="number"
              min={1}
              value={newMax}
              onChange={(e) => setNewMax(Number(e.target.value))}
            />
            <Button
              size="sm"
              loading={addMutation.isPending}
              disabled={!newName.trim()}
              onClick={() => addMutation.mutate()}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      {tablesQuery.isLoading && <Spinner />}
      {!tablesQuery.isLoading && tables.length === 0 && (
        <p className="text-gray-500">No tables yet. Add tables to accept reservations.</p>
      )}

      <ul className="divide-y">
        {tables.map((table) => (
          <li key={table.id} className="py-4">
            {editingId === table.id ? (
              <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap gap-3">
                  <Input
                    label="Name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <Input
                    label="Min party"
                    type="number"
                    min={1}
                    value={editMin}
                    onChange={(e) => setEditMin(Number(e.target.value))}
                  />
                  <Input
                    label="Max party"
                    type="number"
                    min={1}
                    value={editMax}
                    onChange={(e) => setEditMax(Number(e.target.value))}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                  />
                  Active (accepts new reservations)
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={updateMutation.isPending}
                    onClick={() => updateMutation.mutate(table.id)}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className={table.isActive ? '' : 'opacity-50'}>
                  <p className="font-medium">
                    {table.name}
                    {!table.isActive && (
                      <span className="ml-2 text-xs text-gray-500">(inactive)</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    Party size {table.minPartySize}–{table.maxPartySize}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(table)}>
                    Edit
                  </Button>
                  {table.isActive && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (window.confirm('Deactivate this table?')) {
                          deleteMutation.mutate(table.id);
                        }
                      }}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
