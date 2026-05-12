// step-types.ts — re-export shared constants to keep single source of truth
export { STEP_TYPES } from 'workatomcp-shared';
export type StepTypeConst =
  (typeof import('workatomcp-shared'))['STEP_TYPES'][keyof (typeof import('workatomcp-shared'))['STEP_TYPES']];
