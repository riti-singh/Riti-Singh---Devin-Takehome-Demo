import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db/index.js';
import { listAuditEvents, getRefundRequest } from '../src/repo/refunds.js';
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

  it('redirects anonymous users to login', async () => {
    const res = await fetch(`${baseUrl}/refunds`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});
