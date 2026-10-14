import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { version } from '../package.json';

describe('app version', () => {
  it('is the same in package.json and the lockfile root entries', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
  });
});
