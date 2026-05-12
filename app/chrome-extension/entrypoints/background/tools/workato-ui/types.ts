/**
 * Shared types for the workato_ui_* tool family — macro tools that drive
 * Workato's recipe editor through CDP. These tools sit on top of the
 * generic snapshot+UID stack but expose Workato-domain operations
 * (open recipe, enter edit mode, add step, set field, drag datapill,
 * save, exit).
 *
 * See app/chrome-extension/entrypoints/background/tools/browser/snapshot/
 * for the underlying primitives (AX tree, CDP debugger session).
 */

import type { AXNode } from '../browser/snapshot/types';

export type { AXNode };

export interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
}

export interface OpenRecipeArgs extends TabTargetArgs {
  recipe_id: number;
  mode?: 'view' | 'edit';
}

export type EnterEditModeArgs = TabTargetArgs;

export type ListStepsArgs = TabTargetArgs;

export interface FocusStepArgs extends TabTargetArgs {
  step_number: number;
}

export interface AddStepArgs extends TabTargetArgs {
  after_step: number;
  app: string;
  action: string;
  kind?: 'action' | 'if' | 'repeat' | 'stop' | 'handle_errors';
}

export interface SetFieldArgs extends TabTargetArgs {
  field: string;
  value: string;
  mode?: 'text' | 'formula';
}

export interface InsertDatapillArgs extends TabTargetArgs {
  field: string;
  source_step: number;
  path: string[];
}

export type SaveRecipeArgs = TabTargetArgs;

export interface ExitEditModeArgs extends TabTargetArgs {
  discard?: boolean;
}

export interface CreateRecipeArgs extends TabTargetArgs {
  name: string;
  folder_id?: number;
  project_name?: string;
  description?: string;
}

export interface StepInfo {
  number: number;
  label: string;
}
