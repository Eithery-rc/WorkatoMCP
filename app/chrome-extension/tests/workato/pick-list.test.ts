/**
 * @fileoverview Tests for workato_pick_list's response shaping.
 *
 * The one thing that matters here is which half of Workato's pair is the
 * value. It stores `[label, value]`, label first, so reading it the natural
 * way round writes the display text where the id belongs — and Workato
 * accepts that without complaint.
 */

import { describe, expect, it } from 'vitest';

import {
  filterPickOptions,
  normalisePickListParams,
  normalisePickOptions,
} from '@/entrypoints/background/tools/workato/pick-list';

/** Verbatim from POST /connections/19092754/pick_list.json, 2026-08-26. */
const SALESFORCE_SOBJECTS = [
  ['AB-ABStatusToAllowG1Refresh', 'AB_ABStatusToAllowG1Refresh__mdt'],
  ['AB Required Fields Value Mapping', 'AB_Required_Fields_Value_Mapping__mdt'],
  ['Composer Host Override', 'APXTConga4__Composer_Host_Override__c'],
  ['Conga Query', 'APXTConga4__Conga_Merge_Query__c'],
];

describe('normalisePickOptions', () => {
  it('takes the value from the second slot, not the first', () => {
    expect(normalisePickOptions(SALESFORCE_SOBJECTS)[0]).toEqual({
      value: 'AB_ABStatusToAllowG1Refresh__mdt',
      label: 'AB-ABStatusToAllowG1Refresh',
    });
  });

  it('accepts a bare scalar entry as its own value', () => {
    expect(normalisePickOptions(['a', 'b'])).toEqual([{ value: 'a' }, { value: 'b' }]);
  });

  it('keeps a non-string value as it is', () => {
    expect(normalisePickOptions([['One', 1]])).toEqual([{ value: 1, label: 'One' }]);
  });

  it('returns nothing for a shape it does not recognise', () => {
    expect(normalisePickOptions(null)).toEqual([]);
    expect(normalisePickOptions('nope')).toEqual([]);
    expect(normalisePickOptions([{ not: 'a pair' }])).toEqual([]);
  });
});

describe('filterPickOptions', () => {
  const options = normalisePickOptions(SALESFORCE_SOBJECTS);

  it('matches the value, which is what a caller usually half-remembers', () => {
    expect(filterPickOptions(options, 'conga_merge').map((o) => o.value)).toEqual([
      'APXTConga4__Conga_Merge_Query__c',
    ]);
  });

  it('matches the label too, case-insensitively', () => {
    expect(filterPickOptions(options, 'composer host').map((o) => o.label)).toEqual([
      'Composer Host Override',
    ]);
  });

  it('passes everything through for an empty query', () => {
    expect(filterPickOptions(options, '   ')).toHaveLength(4);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterPickOptions(options, 'zzz')).toEqual([]);
  });
});

describe('normalisePickListParams', () => {
  it('unwraps a value copied verbatim from the schema, and says which', () => {
    // The schema shows pick_list_params as FORMULAS, so sobject_name reads as
    // a quoted string. Sent through as-is Salesforce answers
    // `bad URI (is not URI?): "sobjects/\"Account\"/describe"` — verified live.
    const out = normalisePickListParams({ sobject_name: '"Account"', field_name: '"Rating"' });
    expect(out.params).toEqual({ sobject_name: 'Account', field_name: 'Rating' });
    expect(out.unwrapped.sort()).toEqual(['field_name', 'sobject_name']);
  });

  it('leaves an already-evaluated value alone', () => {
    const out = normalisePickListParams({ sobject_name: 'Account', limit: 10 });
    expect(out.params).toEqual({ sobject_name: 'Account', limit: 10 });
    expect(out.unwrapped).toEqual([]);
  });

  it('does not touch a value that merely contains quotes', () => {
    const out = normalisePickListParams({ q: 'say "hi" now', empty: '""' });
    expect(out.params.q).toBe('say "hi" now');
    // `""` unwraps to the empty string, which is what it means.
    expect(out.params.empty).toBe('');
  });
});
