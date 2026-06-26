import type { ReactNode } from 'react';
import { Spinner } from './ui/Spinner.js';
import { Button } from './ui/Button.js';

export interface Column<T> {
  header: string;
  accessor?: keyof T;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading: boolean;
  emptyText?: string;
  total?: number | undefined;
  page?: number;
  limit?: number;
  onPageChange?: ((p: number) => void) | undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  emptyText = 'No results.',
  total,
  page = 1,
  limit = 20,
  onPageChange,
}: Props<T>) {
  const totalPages =
    total !== undefined ? Math.ceil(total / limit) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.header}
                  className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${col.className ?? ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="py-16 text-center">
                  <div className="flex justify-center">
                    <Spinner size="lg" />
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-16 text-center text-slate-400"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="transition-colors hover:bg-slate-50"
                >
                  {columns.map((col) => (
                    <td
                      key={col.header}
                      className={`px-4 py-3 ${col.className ?? ''}`}
                    >
                      {col.render
                        ? col.render(row)
                        : col.accessor
                          ? String(row[col.accessor] ?? '—')
                          : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages !== undefined && totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total!)} of{' '}
            {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              ← Prev
            </Button>
            <span className="flex items-center px-2 font-medium">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
