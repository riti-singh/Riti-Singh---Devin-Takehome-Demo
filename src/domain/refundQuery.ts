import type { RefundRequest, RefundStatus } from './types.js';

export const REFUND_STATUSES: readonly RefundStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export type RefundSort = 'created' | 'amount' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface RefundQuery {
  q?: string;
  status?: RefundStatus | 'all';
  sort?: RefundSort;
  dir?: SortDirection;
}

/** Direction used when a sort is selected without an explicit direction. */
export const DEFAULT_SORT_DIRECTION: SortDirection = 'desc';

/** The direction `filterAndSortRefunds` will actually apply for a query. */
export function effectiveSortDirection(query: RefundQuery): SortDirection {
  return query.dir ?? DEFAULT_SORT_DIRECTION;
}

export interface StatusCounts {
  all: number;
  PENDING: number;
  APPROVED: number;
  REJECTED: number;
}

/** Status order used when sorting by status; mirrors the queue's priority. */
const STATUS_RANK: Record<RefundStatus, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 };

export function parseRefundSort(value: unknown): RefundSort | undefined {
  return value === 'created' || value === 'amount' || value === 'status' ? value : undefined;
}

export function parseSortDirection(value: unknown): SortDirection | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

export function parseRefundStatus(value: unknown): RefundStatus | 'all' | undefined {
  if (value === 'all') return 'all';
  return REFUND_STATUSES.find((s) => s === value);
}

export function countRefundStatuses(requests: RefundRequest[]): StatusCounts {
  return {
    all: requests.length,
    PENDING: requests.filter((r) => r.status === 'PENDING').length,
    APPROVED: requests.filter((r) => r.status === 'APPROVED').length,
    REJECTED: requests.filter((r) => r.status === 'REJECTED').length,
  };
}

function matchesText(request: RefundRequest, needle: string): boolean {
  return [request.id, request.customerRef, request.reason].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/**
 * Filters and sorts the queue in memory. With no `sort` the caller's order is
 * preserved untouched, so the repository's default ordering (PENDING first,
 * then created_at DESC) still decides the queue.
 */
export function filterAndSortRefunds(
  requests: RefundRequest[],
  { q, status, sort, dir = DEFAULT_SORT_DIRECTION }: RefundQuery = {},
): RefundRequest[] {
  const needle = q?.trim().toLowerCase();
  let result = requests;
  if (needle) result = result.filter((r) => matchesText(r, needle));
  if (status && status !== 'all') result = result.filter((r) => r.status === status);
  if (!sort) return result === requests ? [...requests] : result;

  const sign = dir === 'asc' ? 1 : -1;
  const compare = (a: RefundRequest, b: RefundRequest): number => {
    if (sort === 'amount') return (a.amountCents - b.amountCents) * sign;
    if (sort === 'status') return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * sign;
    return a.createdAt.localeCompare(b.createdAt) * sign;
  };
  return [...result].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}
