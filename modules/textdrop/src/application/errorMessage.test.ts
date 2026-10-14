import { describe, expect, it } from 'vitest';
import { errorMessage } from './errorMessage';

describe('error messages', () => {
  it('uses the message of an error and the fallback for anything else', () => {
    expect(errorMessage(new Error('Storage is full'), 'Try again')).toBe('Storage is full');
    expect(errorMessage(new TypeError('Failed to fetch'), 'Try again')).toBe('Failed to fetch');
    for (const thrown of ['text', 42, null, undefined, { message: 'not an Error' }]) {
      expect(errorMessage(thrown, 'Try again')).toBe('Try again');
    }
  });
});
