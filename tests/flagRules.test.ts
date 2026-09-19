import { describe, expect, it } from 'vitest';
import { canChangeFlag, evaluateFlagChange } from '../src/domain/flagRules.js';
import type { Environment, Role } from '../src/domain/types.js';

const ROLES: Role[] = ['reviewer', 'viewer', 'developer', 'admin'];

describe('flag authorization matrix', () => {
  it('lets developers change only development and admins change both environments', () => {
    const allowed: Record<Role, Environment[]> = {
      reviewer: [],
      viewer: [],
      developer: ['development'],
      admin: ['development', 'production'],
    };

    for (const role of ROLES) {
      for (const environment of ['development', 'production'] as const) {
        expect(canChangeFlag(role, environment)).toBe(allowed[role].includes(environment));
      }
    }
  });

  it('rejects roles that may not change the target environment', () => {
    expect(
      evaluateFlagChange({ role: 'developer', environment: 'production', reasonNote: 'ship it' }),
    ).toEqual({ ok: false, failure: 'FORBIDDEN_ROLE' });
    expect(
      evaluateFlagChange({ role: 'viewer', environment: 'development', reasonNote: 'ship it' }),
    ).toEqual({ ok: false, failure: 'FORBIDDEN_ROLE' });
    expect(
      evaluateFlagChange({ role: 'reviewer', environment: 'development', reasonNote: 'ship it' }),
    ).toEqual({ ok: false, failure: 'FORBIDDEN_ROLE' });
  });
});

describe('flag reason validation', () => {
  it('requires a non-empty reason once the role is permitted', () => {
    for (const reasonNote of ['', '   ', undefined]) {
      expect(
        evaluateFlagChange({ role: 'admin', environment: 'production', reasonNote }),
      ).toEqual({ ok: false, failure: 'REASON_REQUIRED' });
    }
  });

  it('accepts a permitted role with a reason', () => {
    expect(
      evaluateFlagChange({ role: 'developer', environment: 'development', reasonNote: 'testing' }),
    ).toEqual({ ok: true });
    expect(
      evaluateFlagChange({ role: 'admin', environment: 'production', reasonNote: 'rollout' }),
    ).toEqual({ ok: true });
  });

  it('checks the role before the reason', () => {
    expect(
      evaluateFlagChange({ role: 'viewer', environment: 'development', reasonNote: '' }),
    ).toEqual({ ok: false, failure: 'FORBIDDEN_ROLE' });
  });
});
