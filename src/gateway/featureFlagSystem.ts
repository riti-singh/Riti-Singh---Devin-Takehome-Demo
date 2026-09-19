import type { Environment } from '../domain/types.js';

export interface FeatureFlagApplyInput {
  flagKey: string;
  environment: Environment;
  enabled: boolean;
}

export interface FeatureFlagResult {
  externalRef: string;
}

export interface FeatureFlagSystem {
  applyFlag(input: FeatureFlagApplyInput): FeatureFlagResult;
}

export class FeatureFlagSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureFlagSystemError';
  }
}

/** Synthetic flag key that makes the mock feature-flag system fail deterministically. */
export const FLAG_APPLY_FAILURE_KEY = 'flag-apply-fail';

export class MockFeatureFlagSystem implements FeatureFlagSystem {
  applyFlag(input: FeatureFlagApplyInput): FeatureFlagResult {
    if (input.flagKey === FLAG_APPLY_FAILURE_KEY) {
      throw new FeatureFlagSystemError(
        `feature flag system declined ${input.flagKey} in ${input.environment}`,
      );
    }
    return { externalRef: `mock_ff_${input.flagKey}_${input.environment}` };
  }
}
