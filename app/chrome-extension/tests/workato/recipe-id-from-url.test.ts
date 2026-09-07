/**
 * @fileoverview `workato_ui_save_recipe` drives the editor's Save button and
 * takes no recipe_id, so the only way it can invalidate the recipe's cached
 * snapshot is to read the id off the tab it just saved in.
 */

import { describe, expect, it } from 'vitest';

import { recipeIdFromUrl } from '@/entrypoints/background/tools/workato-ui/dom-helpers';

describe('recipeIdFromUrl', () => {
  it('reads the id from the shapes Workato actually serves', () => {
    expect(recipeIdFromUrl('https://app.workato.com/recipes/72988590')).toBe(72988590);
    expect(recipeIdFromUrl('https://app.workato.com/recipes/72988590/edit')).toBe(72988590);
    expect(recipeIdFromUrl('https://app.workato.com/recipes/72988590-order-sync/edit')).toBe(
      72988590,
    );
    expect(recipeIdFromUrl('https://app.workato.com/recipes/72988590/jobs?page=2')).toBe(72988590);
    expect(recipeIdFromUrl('https://app.eu.workato.com/recipes/1')).toBe(1);
  });

  it('returns null rather than a guess when the URL names no recipe', () => {
    expect(recipeIdFromUrl('https://app.workato.com/recipes')).toBeNull();
    expect(recipeIdFromUrl('https://app.workato.com/jobs')).toBeNull();
    expect(recipeIdFromUrl('https://app.workato.com/recipes/new')).toBeNull();
    expect(recipeIdFromUrl('')).toBeNull();
    expect(recipeIdFromUrl(undefined as unknown as string)).toBeNull();
  });
});
