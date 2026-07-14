/**
 * Shared types for the workato_recipe_* tool family — high-level mutators
 * that pull a recipe's code tree, modify it client-side, and PUT it back
 * in a single round-trip. Each tool is one logical change.
 *
 * These tools sit on top of the same page-side `fetch` pattern used by
 * workato_ui_create_recipe / workato_ui_save_recipe_code (cookie session +
 * CSRF from the XSRF-TOKEN-V2 cookie). They do NOT drive the editor UI.
 */

export interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
}

export type RecipeStepKeyword = 'action' | 'if' | 'repeat_each' | 'stop' | 'return_result';

export interface RecipeAddStepArgs extends TabTargetArgs {
  recipe_id: number;
  after_step: number;
  provider: string;
  action_name: string;
  input?: Record<string, unknown>;
  keyword?: RecipeStepKeyword;
}

export interface RecipeSetStepInputArgs extends TabTargetArgs {
  recipe_id: number;
  /** Step number (0 = trigger) or `as` anchor string. Nested blocks are searched. */
  step_number: number | string;
  /** Field name or nested dotted path, e.g. "parameters.sysid_param.asset_id" or "filters[0].value". */
  field: string;
  value: unknown;
}

/** A datapill path element: plain name, "name[]" (expands to name + current_item), or a raw path object. */
export type DatapillPathElement = string | Record<string, unknown>;

export interface RecipeMapDatapillArgs extends TabTargetArgs {
  recipe_id: number;
  /** Step number (0 = trigger) or `as` anchor string. Nested blocks are searched. */
  target_step: number | string;
  /** Field name or nested dotted path on the target step. */
  target_field: string;
  /** Step number (0 = trigger) or `as` anchor string. */
  source_step: number | string;
  path: DatapillPathElement[];
}
