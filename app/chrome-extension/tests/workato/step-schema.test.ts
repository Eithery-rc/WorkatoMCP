/**
 * @fileoverview Tests for workato_step_schema's pure shaping: the apply_ops it
 * hands to workato_recipe_apply, the reading of Workato's in-200 errors, and
 * the schema-driver check that turns an empty result into a usable note.
 *
 * Fixtures are the live responses captured 2026-09-08 (spec:
 * docs/design/specs/2026-09-08-connector-catalogue-and-step-schema.md).
 */

import { describe, expect, it } from 'vitest';

import {
  asSchemaArray,
  buildApplyOps,
  describeWorkatoError,
  missingDrivers,
  stripHtml,
} from '@/entrypoints/background/tools/workato/step-schema';

/** /connections/workato_variable/extended_schema.json, declare_list, verbatim. */
const DECLARE_LIST_RESULT = {
  input: [
    {
      label: 'Items',
      optional: true,
      hint: 'Set the initial items in the list. Defaults to an empty list if not supplied.',
      of: 'object',
      properties: [
        { control_type: 'text', label: 'Order ID', name: 'order_id', type: 'string' },
        {
          control_type: 'number',
          label: 'Amount',
          parse_output: 'float_conversion',
          name: 'amount',
          type: 'number',
        },
      ],
      type: 'array',
      name: 'list_items',
    },
  ],
  output: [
    {
      label: 'orders',
      optional: false,
      hint: '',
      of: 'object',
      properties: [
        { control_type: 'text', label: 'Order ID', name: 'order_id', type: 'string' },
        {
          control_type: 'number',
          label: 'Amount',
          parse_output: 'float_conversion',
          name: 'amount',
          type: 'number',
        },
      ],
      type: 'array',
      name: 'list_items',
    },
  ],
  title: ' Create orders list',
  description: 'Create <span class="provider">orders</span> list',
  help: null,
};

describe('buildApplyOps', () => {
  it('emits one set_extended_schema op per non-empty array, in input then output order', () => {
    const ops = buildApplyOps('7a8394a3', DECLARE_LIST_RESULT.input, DECLARE_LIST_RESULT.output);
    expect(ops.map((o) => [o.op, o.step, o.kind])).toEqual([
      ['set_extended_schema', '7a8394a3', 'extended_input_schema'],
      ['set_extended_schema', '7a8394a3', 'extended_output_schema'],
    ]);
    // The arrays go through untouched: this is exactly what the step stores.
    expect(ops[0].schema).toBe(DECLARE_LIST_RESULT.input);
    expect(ops[1].schema[0]).toMatchObject({ name: 'list_items', label: 'orders' });
  });

  it('skips an empty array rather than writing [] over a schema the step has', () => {
    // clock scheduled_event: input fields, no output.
    const ops = buildApplyOps(1, [{ name: 'trigger_every' }], []);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('extended_input_schema');
    expect(buildApplyOps('x', [], [])).toEqual([]);
  });
});

describe('asSchemaArray', () => {
  it('accepts only arrays', () => {
    expect(asSchemaArray(DECLARE_LIST_RESULT.output)).toHaveLength(1);
    expect(asSchemaArray(null)).toEqual([]);
    expect(asSchemaArray({ name: 'x' })).toEqual([]);
    expect(asSchemaArray('[]')).toEqual([]);
  });
});

describe('stripHtml', () => {
  it('removes the provider spans Workato puts in titles and descriptions', () => {
    expect(stripHtml(DECLARE_LIST_RESULT.description)).toBe('Create orders list');
    expect(stripHtml(' Create orders list')).toBe('Create orders list');
    expect(stripHtml(null)).toBeUndefined();
    expect(stripHtml('<span></span>')).toBeUndefined();
  });
});

describe('describeWorkatoError', () => {
  it('reads "HTTP status code 420" as the connection failing, whatever its status says', () => {
    // Verbatim from both Salesforce connections on 2026-09-08, authorization_status "success".
    const text = describeWorkatoError('HTTP status code 420', 17977571, 'salesforce');
    expect(text).toContain('connection 17977571');
    expect(text).toContain('HTTP status code 420');
    expect(text).toMatch(/authorization_status can still read "success"/);
    expect(text).toMatch(/re-authorize/);
    expect(text).toMatch(/input \{\} is the cheap liveness probe/);
  });

  it('treats an OAuth error string the same way', () => {
    // json.error of the live Google Sheets response
    // {"error": "invalid_grant", "error_description": "Bad Request"}: the
    // runtime passes only the string.
    const text = describeWorkatoError('invalid_grant', 18514516, 'google_sheets');
    expect(text).toContain('connection 18514516');
    expect(text).toContain('invalid_grant');
    expect(text).toMatch(/re-authorize/);
  });

  it('points at the request itself for any other error', () => {
    const text = describeWorkatoError('operation_name is missing', null, 'workato_variable');
    expect(text).toContain('adapter "workato_variable"');
    expect(text).toMatch(/Check the operation name/);
    expect(text).not.toMatch(/re-authorize/);
  });
});

describe('missingDrivers', () => {
  it('names the schema drivers the input has not filled', () => {
    // salesforce search_sobjects derives its schema from sobject_name.
    expect(missingDrivers(['sobject_name'], {})).toEqual(['sobject_name']);
    expect(missingDrivers(['sobject_name'], { sobject_name: '' })).toEqual(['sobject_name']);
    expect(missingDrivers(['sobject_name'], { sobject_name: 'Account' })).toEqual([]);
  });

  it('is empty for an operation with no drivers', () => {
    expect(missingDrivers([], { anything: 1 })).toEqual([]);
  });
});
