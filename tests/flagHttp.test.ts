import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db/index.js';
import { getFlagState, listFlagAuditEvents } from '../src/repo/flags.js';
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

function change(
  cookie: string,
  flagId: string,
  environment: string,
  enabled: string,
  reasonNote: string,
): Promise<Response> {
  return fetch(`${baseUrl}/flags/${flagId}/change`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ environment, enabled, reasonNote }),
    redirect: 'manual',
  });
}

describe('server-side flag authorization', () => {
  it('returns 403 for a developer posting to production, with no state change and no audit write', async () => {
    const cookie = await login('user-developer');
    const res = await change(cookie, 'ff-checkout-v2', 'production', 'true', 'bypassing the UI');

    expect(res.status).toBe(403);
    expect(getFlagState(db, 'ff-checkout-v2', 'production')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(0);
  });

  it('returns 403 for a reviewer, whose role belongs to the other tool', async () => {
    const cookie = await login('user-reviewer');
    const res = await change(cookie, 'ff-bulk-refunds', 'development', 'true', 'not my tool');

    expect(res.status).toBe(403);
    expect(getFlagState(db, 'ff-bulk-refunds', 'development')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-bulk-refunds')).toHaveLength(0);
  });

  it('rejects a missing reason with 400 before any mutation', async () => {
    const cookie = await login('user-admin');
    const res = await change(cookie, 'ff-checkout-v2', 'production', 'true', '');

    expect(res.status).toBe(400);
    expect(getFlagState(db, 'ff-checkout-v2', 'production')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(0);
  });

  it('lets an admin change production and a developer change development', async () => {
    const adminCookie = await login('user-admin');
    const adminRes = await change(
      adminCookie,
      'ff-checkout-v2',
      'production',
      'true',
      'rollout approved',
    );

    expect(adminRes.status).toBe(302);
    expect(getFlagState(db, 'ff-checkout-v2', 'production')!.enabled).toBe(true);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(1);

    const devCookie = await login('user-developer');
    const devRes = await change(
      devCookie,
      'ff-bulk-refunds',
      'development',
      'true',
      'testing the bulk path',
    );

    expect(devRes.status).toBe(302);
    expect(getFlagState(db, 'ff-bulk-refunds', 'development')!.enabled).toBe(true);
    expect(listFlagAuditEvents(db, 'ff-bulk-refunds')).toHaveLength(1);
  });

  it('redirects a no-op toggle without writing an audit event', async () => {
    const cookie = await login('user-admin');
    const res = await change(cookie, 'ff-dark-mode', 'production', 'true', 'already enabled');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/flags/ff-dark-mode');
    expect(getFlagState(db, 'ff-dark-mode', 'production')!.enabled).toBe(true);
    expect(listFlagAuditEvents(db, 'ff-dark-mode')).toHaveLength(0);
  });

  it('returns 502 and changes nothing when the external system declines', async () => {
    const cookie = await login('user-admin');
    const res = await change(
      cookie,
      'ff-apply-fail',
      'production',
      'true',
      'rehearsing the failure path',
    );

    expect(res.status).toBe(502);
    expect(getFlagState(db, 'ff-apply-fail', 'production')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-apply-fail')).toHaveLength(0);
  });

  it('redirects anonymous users to login', async () => {
    const res = await fetch(`${baseUrl}/flags`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});

describe('flag list filtering', () => {
  const rowIds = (html: string): string[] =>
    [...html.matchAll(/data-testid="row-(ff-[a-z0-9-]+)"/g)].map((m) => m[1]);

  async function flagsList(cookie: string, query = ''): Promise<string> {
    const res = await fetch(`${baseUrl}/flags${query}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return res.text();
  }

  it('renders the filter controls and every flag by default', async () => {
    const cookie = await login('user-viewer');
    const html = await flagsList(cookie);

    expect(html).toContain('data-testid="flag-search"');
    expect(html).toContain('data-testid="flag-env-filter"');
    expect(html).toContain('data-testid="flag-state-filter"');
    expect(rowIds(html)).toContain('ff-checkout-v2');
    expect(rowIds(html)).toContain('ff-dark-mode');
  });

  it('searches key and description', async () => {
    const cookie = await login('user-viewer');

    expect(rowIds(await flagsList(cookie, '?q=checkout'))).toEqual(['ff-checkout-v2']);
    expect(rowIds(await flagsList(cookie, '?q=Dark%20colour'))).toEqual(['ff-dark-mode']);
    expect(rowIds(await flagsList(cookie, '?q=nope'))).toEqual([]);
  });

  it('filters by environment and state', async () => {
    const cookie = await login('user-viewer');

    const enabledInProduction = rowIds(
      await flagsList(cookie, '?environment=production&state=enabled'),
    );
    for (const id of enabledInProduction) {
      expect(getFlagState(db, id, 'production')!.enabled).toBe(true);
    }
    expect(enabledInProduction).toContain('ff-dark-mode');

    const disabledInDevelopment = rowIds(
      await flagsList(cookie, '?environment=development&state=disabled'),
    );
    for (const id of disabledInDevelopment) {
      expect(getFlagState(db, id, 'development')!.enabled).toBe(false);
    }
    expect(disabledInDevelopment).not.toContain('ff-dark-mode');
  });

  it('ignores unknown filter values', async () => {
    const cookie = await login('user-viewer');
    const html = await flagsList(cookie, '?environment=staging&state=maybe');

    expect(rowIds(html)).toHaveLength(4);
  });
});
