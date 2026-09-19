import { describe, expect, it } from 'vitest';
import { describeAccess } from '../src/domain/access.js';
import { canChangeFlag, ENVIRONMENTS } from '../src/domain/flagRules.js';
import { canDecide } from '../src/domain/rules.js';
import type { Role } from '../src/domain/types.js';

const ROLES: Role[] = ['reviewer', 'viewer', 'developer', 'admin'];

describe('describeAccess', () => {
  it('summarises both tools for every role', () => {
    expect(describeAccess('reviewer').summary).toBe('approve/reject refunds; read-only for flags');
    expect(describeAccess('viewer').summary).toBe('read-only across both tools');
    expect(describeAccess('developer').summary).toBe(
      'read-only for refunds; change flags in development',
    );
    expect(describeAccess('admin').summary).toBe(
      'read-only for refunds; change flags in any environment',
    );
  });

  it('never contradicts canDecide or canChangeFlag', () => {
    for (const role of ROLES) {
      const access = describeAccess(role);
      expect(access.refunds === 'approve/reject refunds').toBe(canDecide(role));
      expect(access.flagEnvironments).toEqual(
        ENVIRONMENTS.filter((env) => canChangeFlag(role, env)),
      );
      expect(access.flags === 'read-only for flags').toBe(
        ENVIRONMENTS.every((env) => !canChangeFlag(role, env)),
      );
    }
  });
});
