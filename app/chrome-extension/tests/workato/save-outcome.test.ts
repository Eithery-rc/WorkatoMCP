import { describe, expect, it } from 'vitest';
import { summarizeSaveOutcome } from '@/entrypoints/background/tools/workato-ui/save-guards';

describe('summarizeSaveOutcome', () => {
  it('reports a clean save as persisted, valid and verified', () => {
    expect(summarizeSaveOutcome({ code_errors: [] })).toEqual({
      persisted: true,
      valid: true,
      verified: true,
    });
  });

  it('names a persisted tree that Workato rejects', () => {
    const outcome = summarizeSaveOutcome({ code_errors: [{ message: 'account_id blank' }] });
    expect(outcome).toMatchObject({
      persisted: true,
      valid: false,
      save_status: 'persisted_invalid',
    });
  });

  it('keeps an explicit save_status instead of overwriting it', () => {
    const outcome = summarizeSaveOutcome({
      code_errors: [{ message: 'bad' }],
      save_status: 'succeeded_after_timeout',
    });
    expect(outcome.save_status).toBe('succeeded_after_timeout');
    expect(outcome.valid).toBe(false);
    expect(outcome.verified).toBe(false);
  });

  it('does not claim verification the caller turned off', () => {
    expect(summarizeSaveOutcome({ code_errors: [], verify_readback: false }).verified).toBe(false);
  });

  it('does not claim verification when the readback failed or values drifted', () => {
    expect(
      summarizeSaveOutcome({ code_errors: [], verification_error: 'code readback failed' })
        .verified,
    ).toBe(false);
    expect(
      summarizeSaveOutcome({ code_errors: [], value_mismatches: [{ path: 'input.message' }] })
        .verified,
    ).toBe(false);
  });
});
