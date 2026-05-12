/**
 * @fileoverview Breakpoint manager for Record-Replay V3 debugging.
 */

import type { NodeId, RunId } from '../../domain/ids';
import type { Breakpoint, DebuggerState } from '../../domain/debug';

/**
 * Manages breakpoints for a single run.
 */
export class BreakpointManager {
  private breakpoints = new Map<NodeId, Breakpoint>();
  private stepMode: 'none' | 'stepOver' = 'none';

  constructor(initialBreakpoints?: NodeId[]) {
    if (initialBreakpoints) {
      for (const nodeId of initialBreakpoints) {
        this.add(nodeId);
      }
    }
  }

  /**
   * Add a breakpoint.
   */
  add(nodeId: NodeId): void {
    this.breakpoints.set(nodeId, { nodeId, enabled: true });
  }

  /**
   * Remove a breakpoint.
   */
  remove(nodeId: NodeId): void {
    this.breakpoints.delete(nodeId);
  }

  /**
   * Replace all breakpoints with the given list.
   */
  setAll(nodeIds: NodeId[]): void {
    this.breakpoints.clear();
    for (const nodeId of nodeIds) {
      this.add(nodeId);
    }
  }

  /**
   * Enable a breakpoint.
   */
  enable(nodeId: NodeId): void {
    const bp = this.breakpoints.get(nodeId);
    if (bp) {
      bp.enabled = true;
    }
  }

  /**
   * Disable a breakpoint.
   */
  disable(nodeId: NodeId): void {
    const bp = this.breakpoints.get(nodeId);
    if (bp) {
      bp.enabled = false;
    }
  }

  /**
   * Whether the node has an enabled breakpoint.
   */
  hasBreakpoint(nodeId: NodeId): boolean {
    const bp = this.breakpoints.get(nodeId);
    return bp?.enabled ?? false;
  }

  /**
   * Whether execution should pause at the given node (considering both breakpoints and step mode).
   */
  shouldPauseAt(nodeId: NodeId): boolean {
    // In step mode, always pause
    if (this.stepMode === 'stepOver') {
      return true;
    }
    // Otherwise check breakpoints
    return this.hasBreakpoint(nodeId);
  }

  /**
   * Return all breakpoints.
   */
  getAll(): Breakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  /**
   * Return only enabled breakpoints.
   */
  getEnabled(): Breakpoint[] {
    return this.getAll().filter((bp) => bp.enabled);
  }

  /**
   * Set the step mode.
   */
  setStepMode(mode: 'none' | 'stepOver'): void {
    this.stepMode = mode;
  }

  /**
   * Get the current step mode.
   */
  getStepMode(): 'none' | 'stepOver' {
    return this.stepMode;
  }

  /**
   * Clear all breakpoints and reset step mode.
   */
  clear(): void {
    this.breakpoints.clear();
    this.stepMode = 'none';
  }
}

/**
 * Registry that manages BreakpointManagers for multiple runs.
 */
export class BreakpointRegistry {
  private managers = new Map<RunId, BreakpointManager>();

  /**
   * Get or create a BreakpointManager for the given run.
   */
  getOrCreate(runId: RunId, initialBreakpoints?: NodeId[]): BreakpointManager {
    let manager = this.managers.get(runId);
    if (!manager) {
      manager = new BreakpointManager(initialBreakpoints);
      this.managers.set(runId, manager);
    }
    return manager;
  }

  /**
   * Get the BreakpointManager for a run (or undefined).
   */
  get(runId: RunId): BreakpointManager | undefined {
    return this.managers.get(runId);
  }

  /**
   * Remove the BreakpointManager for a run.
   */
  remove(runId: RunId): void {
    this.managers.delete(runId);
  }

  /**
   * Remove all managers.
   */
  clear(): void {
    this.managers.clear();
  }
}

/** Module-level singleton breakpoint registry. */
let globalBreakpointRegistry: BreakpointRegistry | null = null;

/**
 * Get the global BreakpointRegistry (creating it on first access).
 */
export function getBreakpointRegistry(): BreakpointRegistry {
  if (!globalBreakpointRegistry) {
    globalBreakpointRegistry = new BreakpointRegistry();
  }
  return globalBreakpointRegistry;
}

/**
 * Reset the global BreakpointRegistry.
 * Primarily used in tests.
 */
export function resetBreakpointRegistry(): void {
  globalBreakpointRegistry = null;
}
