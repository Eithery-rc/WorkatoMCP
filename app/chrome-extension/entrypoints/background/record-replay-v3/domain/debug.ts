/**
 * @fileoverview Debugger type definitions for Record-Replay V3.
 */

import type { JsonValue } from './json';
import type { NodeId, RunId } from './ids';
import type { PauseReason } from './events';

/**
 * A breakpoint on a specific node.
 */
export interface Breakpoint {
  /** Node ID where the breakpoint is set. */
  nodeId: NodeId;
  /** Whether the breakpoint is currently active. */
  enabled: boolean;
}

/**
 * Current state of the debugger attached to a run.
 */
export interface DebuggerState {
  /** The associated Run ID. */
  runId: RunId;
  /** Debugger connection status. */
  status: 'attached' | 'detached';
  /** Execution status. */
  execution: 'running' | 'paused';
  /** Pause reason (only set when execution='paused'). */
  pauseReason?: PauseReason;
  /** Current node ID. */
  currentNodeId?: NodeId;
  /** List of breakpoints. */
  breakpoints: Breakpoint[];
  /** Step mode. */
  stepMode?: 'none' | 'stepOver';
}

/**
 * Commands sent from the client to the debugger.
 */
export type DebuggerCommand =
  // ===== Connection control =====
  | { type: 'debug.attach'; runId: RunId }
  | { type: 'debug.detach'; runId: RunId }

  // ===== Execution control =====
  | { type: 'debug.pause'; runId: RunId }
  | { type: 'debug.resume'; runId: RunId }
  | { type: 'debug.stepOver'; runId: RunId }

  // ===== Breakpoint management =====
  | { type: 'debug.setBreakpoints'; runId: RunId; nodeIds: NodeId[] }
  | { type: 'debug.addBreakpoint'; runId: RunId; nodeId: NodeId }
  | { type: 'debug.removeBreakpoint'; runId: RunId; nodeId: NodeId }

  // ===== State queries =====
  | { type: 'debug.getState'; runId: RunId }

  // ===== Variable operations =====
  | { type: 'debug.getVar'; runId: RunId; name: string }
  | { type: 'debug.setVar'; runId: RunId; name: string; value: JsonValue };

/** Debugger command type (extracted from the union). */
export type DebuggerCommandType = DebuggerCommand['type'];

/**
 * Response to a debugger command.
 */
export type DebuggerResponse =
  | { ok: true; state?: DebuggerState; value?: JsonValue }
  | { ok: false; error: string };

/**
 * Create the initial (detached) debugger state for a run.
 */
export function createInitialDebuggerState(runId: RunId): DebuggerState {
  return {
    runId,
    status: 'detached',
    execution: 'running',
    breakpoints: [],
    stepMode: 'none',
  };
}
