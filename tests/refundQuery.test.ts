import { describe, expect, it } from 'vitest';
import {
  countRefundStatuses,
  filterAndSortRefunds,
  parseRefundSort,
  parseRefundStatus,
  parseSortDirection,
} from '../src/domain/refundQuery.js';
import { listRefundRequests } from '../src/repo/refunds.js';
import type { RefundRequest } from '../src/domain/types.js';
import { freshDb } from './helpers.js';

const requests: RefundRequest[] = [
  {
    id: 'rr-1',
    customerRef: 'CUST-0001',
    amountCents: 500,
    reason: 'Item arrived damaged',
    status: 'PENDING',
    createdAt: '2026-01-03T10:00:00.000Z',
  },
  {
    id: 'rr-2',
    customerRef: 'CUST-0002',
    amountCents: 9000,
    reason: 'Duplicate charge',
    status: 'APPROVED',
    createdAt: '2026-01-01T10:00:00.000Z',
  },
  {
    id: 'rr-3',
    customerRef: 'CUST-0003',
    amountCents: 2500,
    reason: 'Never received order',
    status: 'REJECTED',
    createdAt: '2026-01-02T10:00:00.000Z',
  },
];

const ids = (list: RefundRequest[]): string[] => list.map((r) => r.id);

describe('filterAndSortRefunds', () => {
  it('preserves the caller ordering when no sort is selected', () => {
    const db = freshDb();
    const fromRepo = listRefundRequests(db);
    db.close();

    expect(ids(filterAndSortRefunds(fromRepo))).toEqual(ids(fromRepo));
    expect(ids(filterAndSortRefunds(fromRepo, { q: '', status: 'all' }))).toEqual(ids(fromRepo));
    expect(ids(filterAndSortRefunds(requests, { dir: 'asc' }))).toEqual(['rr-1', 'rr-2', 'rr-3']);
  });

  it('searches id, customer reference and reason case-insensitively', () => {
    expect(ids(filterAndSortRefunds(requests, { q: 'rr-2' }))).toEqual(['rr-2']);
    expect(ids(filterAndSortRefunds(requests, { q: 'cust-0003' }))).toEqual(['rr-3']);
    expect(ids(filterAndSortRefunds(requests, { q: 'duplicate' }))).toEqual(['rr-2']);
    expect(ids(filterAndSortRefunds(requests, { q: '  damaged  ' }))).toEqual(['rr-1']);
    expect(filterAndSortRefunds(requests, { q: 'nothing matches' })).toHaveLength(0);
  });

  it('filters by each status and by all', () => {
    expect(ids(filterAndSortRefunds(requests, { status: 'PENDING' }))).toEqual(['rr-1']);
    expect(ids(filterAndSortRefunds(requests, { status: 'APPROVED' }))).toEqual(['rr-2']);
    expect(ids(filterAndSortRefunds(requests, { status: 'REJECTED' }))).toEqual(['rr-3']);
    expect(ids(filterAndSortRefunds(requests, { status: 'all' }))).toEqual(ids(requests));
  });

  it('combines search and status filtering', () => {
    expect(ids(filterAndSortRefunds(requests, { q: 'CUST', status: 'APPROVED' }))).toEqual(['rr-2']);
  });

  it('sorts by created date, amount and status in both directions', () => {
    expect(ids(filterAndSortRefunds(requests, { sort: 'created', dir: 'asc' }))).toEqual([
      'rr-2',
      'rr-3',
      'rr-1',
    ]);
    expect(ids(filterAndSortRefunds(requests, { sort: 'created', dir: 'desc' }))).toEqual([
      'rr-1',
      'rr-3',
      'rr-2',
    ]);
    expect(ids(filterAndSortRefunds(requests, { sort: 'amount', dir: 'asc' }))).toEqual([
      'rr-1',
      'rr-3',
      'rr-2',
    ]);
    expect(ids(filterAndSortRefunds(requests, { sort: 'amount', dir: 'desc' }))).toEqual([
      'rr-2',
      'rr-3',
      'rr-1',
    ]);
    expect(ids(filterAndSortRefunds(requests, { sort: 'status', dir: 'asc' }))).toEqual([
      'rr-1',
      'rr-2',
      'rr-3',
    ]);
    expect(ids(filterAndSortRefunds(requests, { sort: 'status', dir: 'desc' }))).toEqual([
      'rr-3',
      'rr-2',
      'rr-1',
    ]);
  });

  it('does not mutate the input list', () => {
    const input = [...requests];
    filterAndSortRefunds(input, { sort: 'amount', dir: 'asc' });
    expect(ids(input)).toEqual(ids(requests));
  });
});

describe('countRefundStatuses', () => {
  it('counts every status from the full list', () => {
    expect(countRefundStatuses(requests)).toEqual({
      all: 3,
      PENDING: 1,
      APPROVED: 1,
      REJECTED: 1,
    });
  });

  it('is unaffected by filtering, so counts stay stable', () => {
    const filtered = filterAndSortRefunds(requests, { status: 'PENDING' });
    expect(countRefundStatuses(requests).all).toBe(3);
    expect(filtered).toHaveLength(1);
  });
});

describe('query parsing', () => {
  it('accepts known values and rejects everything else', () => {
    expect(parseRefundStatus('PENDING')).toBe('PENDING');
    expect(parseRefundStatus('all')).toBe('all');
    expect(parseRefundStatus('bogus')).toBeUndefined();
    expect(parseRefundSort('amount')).toBe('amount');
    expect(parseRefundSort('bogus')).toBeUndefined();
    expect(parseSortDirection('asc')).toBe('asc');
    expect(parseSortDirection(['desc'])).toBeUndefined();
  });
});
