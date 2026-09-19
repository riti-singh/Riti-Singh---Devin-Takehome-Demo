import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db/index.js';
import { countRefundStatuses } from '../src/domain/refundQuery.js';
import { listAuditEvents, getRefundRequest, listRefundRequests } from '../src/repo/refunds.js';
import { freshDb } from './helpers.js';

let db: Db;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  db = freshDb();
  server = createApp({ db }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

async function login(userId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ userId }),
    redirect: 'manual',
  });
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0];
}

function decide(cookie: string, id: string, action: string, reasonNote: string): Promise<Response> {
  return fetch(`${baseUrl}/refunds/${id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ action, reasonNote }),
    redirect: 'manual',
  });
}

describe('server-side authorization', () => {
  it('returns 403 for a viewer with no state change and no audit write', async () => {
    const cookie = await login('user-viewer');
    const res = await decide(cookie, 'rr-1003', 'APPROVE', 'let me through');

    expect(res.status).toBe(403);
    expect(getRefundRequest(db, 'rr-1003')!.status).toBe('PENDING');
    expect(listAuditEvents(db, 'rr-1003')).toHaveLength(0);
  });

  it('rejects a missing reason with 400 before any mutation', async () => {
    const cookie = await login('user-reviewer');
    const res = await decide(cookie, 'rr-1003', 'APPROVE', '');

    expect(res.status).toBe(400);
    expect(getRefundRequest(db, 'rr-1003')!.status).toBe('PENDING');
    expect(listAuditEvents(db, 'rr-1003')).toHaveLength(0);
  });

  it('lets a reviewer approve', async () => {
    const cookie = await login('user-reviewer');
    const res = await decide(cookie, 'rr-1003', 'APPROVE', 'confirmed with carrier');

    expect(res.status).toBe(302);
    expect(getRefundRequest(db, 'rr-1003')!.status).toBe('APPROVED');
    expect(listAuditEvents(db, 'rr-1003')).toHaveLength(1);
  });

  it('sets a hardened session cookie', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ userId: 'user-reviewer' }),
      redirect: 'manual',
    });
    const cookie = res.headers.get('set-cookie')!;

    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('redirects anonymous users to login', async () => {
    const res = await fetch(`${baseUrl}/refunds`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('sends a successful login to the internal-tools home page', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ userId: 'user-viewer' }),
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });
});

describe('home page', () => {
  it('redirects anonymous users to login', async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('lists both tools and the cross-tool access panel', async () => {
    const cookie = await login('user-developer');
    const html = await (await fetch(`${baseUrl}/`, { headers: { cookie } })).text();

    expect(html).toContain('data-testid="home-tools"');
    expect(html).toContain('href="/refunds"');
    expect(html).toContain('href="/flags"');
    expect(html).toContain('data-testid="nav"');
    expect(html).toContain('data-testid="access-panel"');
    expect(html).toContain('read-only for refunds; change flags in development');
  });
});

describe('refund queue filtering and sorting', () => {
  const rowIds = (html: string): string[] =>
    [...html.matchAll(/data-testid="row-(rr-\d+)"/g)].map((m) => m[1]);

  async function queue(cookie: string, query = ''): Promise<string> {
    const res = await fetch(`${baseUrl}/refunds${query}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return res.text();
  }

  it('preserves the default ordering when no query params are given', async () => {
    const cookie = await login('user-viewer');
    const html = await queue(cookie);

    const ids = rowIds(html);
    const statuses = ids.map((id) => getRefundRequest(db, id)!.status);
    const pendingCount = statuses.filter((s) => s === 'PENDING').length;
    expect(statuses.slice(0, pendingCount).every((s) => s === 'PENDING')).toBe(true);
    expect(ids).toEqual(listRefundRequests(db).map((r) => r.id));
  });

  it('filters by status while keeping counts derived from the full list', async () => {
    const cookie = await login('user-viewer');
    const html = await queue(cookie, '?status=REJECTED');

    expect(rowIds(html)).toEqual(['rr-1007']);
    const counts = countRefundStatuses(listRefundRequests(db));
    expect(html).toContain(
      `All ${counts.all} \u00b7 PENDING ${counts.PENDING} \u00b7 APPROVED ${counts.APPROVED} \u00b7 REJECTED ${counts.REJECTED}`,
    );
    expect(html).toContain('data-testid="status-counts"');
  });

  it('searches across id, customer reference and reason', async () => {
    const cookie = await login('user-viewer');

    expect(rowIds(await queue(cookie, '?q=CUST-0002'))).toEqual(['rr-1002']);
    expect(rowIds(await queue(cookie, '?q=duplicate'))).toEqual(['rr-1002']);
    expect(rowIds(await queue(cookie, '?q=rr-1004'))).toEqual(['rr-1004']);
  });

  it('sorts by amount and by created date in the requested direction', async () => {
    const cookie = await login('user-viewer');

    const byAmount = rowIds(await queue(cookie, '?sort=amount&dir=asc'));
    const amounts = byAmount.map((id) => getRefundRequest(db, id)!.amountCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));

    const byCreated = rowIds(await queue(cookie, '?sort=created&dir=desc'));
    const created = byCreated.map((id) => getRefundRequest(db, id)!.createdAt);
    expect(created).toEqual([...created].sort().reverse());
  });

  it('combines search, status filter and sorting', async () => {
    const cookie = await login('user-viewer');
    const html = await queue(cookie, '?q=CUST&status=PENDING&sort=amount&dir=desc');

    const ids = rowIds(html);
    expect(ids.every((id) => getRefundRequest(db, id)!.status === 'PENDING')).toBe(true);
    const amounts = ids.map((id) => getRefundRequest(db, id)!.amountCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  it('ignores unknown query values instead of failing', async () => {
    const cookie = await login('user-viewer');
    const html = await queue(cookie, '?status=BOGUS&sort=bogus&dir=sideways');

    expect(rowIds(html)).toEqual(listRefundRequests(db).map((r) => r.id));
  });
});
