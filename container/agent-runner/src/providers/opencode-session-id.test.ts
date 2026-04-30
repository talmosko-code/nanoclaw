import { describe, expect, it } from 'bun:test';

import { isLegacyUuidOpenCodeSessionId } from './opencode.js';

describe('isLegacyUuidOpenCodeSessionId', () => {
  it('detects bare UUID continuations that OpenCode now rejects', () => {
    expect(isLegacyUuidOpenCodeSessionId('d2d18db1-8f25-45bc-a9f3-b7a775b01248')).toBe(true);
  });

  it('does not flag ses-prefixed ids', () => {
    expect(isLegacyUuidOpenCodeSessionId('ses_d2d18db1-8f25-45bc-a9f3-b7a775b01248')).toBe(false);
  });
});
