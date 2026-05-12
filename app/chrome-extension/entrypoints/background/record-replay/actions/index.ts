/**
 * Action System — export barrel
 */

// Type exports
export * from './types';

// Registry exports
export {
  ActionRegistry,
  createActionRegistry,
  ok,
  invalid,
  failed,
  tryResolveString,
  tryResolveNumber,
  tryResolveJson,
  tryResolveValue,
  type BeforeExecuteArgs,
  type BeforeExecuteHook,
  type AfterExecuteArgs,
  type AfterExecuteHook,
  type ActionRegistryHooks,
} from './registry';

// Adapter exports
export {
  execCtxToActionCtx,
  stepToAction,
  actionResultToExecResult,
  createStepExecutor,
  isActionSupported,
  getActionType,
  type StepExecutionAttempt,
} from './adapter';

// Handler factory exports
export {
  createReplayActionRegistry,
  registerReplayHandlers,
  getSupportedActionTypes,
  isActionTypeSupported,
} from './handlers';
