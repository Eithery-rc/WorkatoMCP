/**
 * @fileoverview Plugin type definitions for Record-Replay V3 (nodes and triggers).
 */

import { z } from 'zod';

import type { JsonObject, JsonValue } from '../../domain/json';
import type { FlowId, NodeId, RunId, TriggerId } from '../../domain/ids';
import type { NodeKind } from '../../domain/flow';
import type { RRError } from '../../domain/errors';
import type { NodePolicy } from '../../domain/policy';
import type { FlowV3, NodeV3 } from '../../domain/flow';
import type { TriggerKind } from '../../domain/triggers';

/**
 * Generic Zod schema type used for config validation.
 */
export type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

/**
 * Runtime context provided to node executors.
 */
export interface NodeExecutionContext {
  /** Run ID. */
  runId: RunId;
  /** Flow snapshot. */
  flow: FlowV3;
  /** Current node ID. */
  nodeId: NodeId;

  /** Bound tab ID (exclusive per run). */
  tabId: number;
  /** Frame ID (0 = main frame). */
  frameId?: number;

  /** Current variable store. */
  vars: Record<string, JsonValue>;

  /**
   * Emit a log entry.
   */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: JsonValue) => void;

  /**
   * Choose the next edge (for conditional branch nodes).
   */
  chooseNext: (label: string) => { kind: 'edgeLabel'; label: string };

  /**
   * Artifact operations.
   */
  artifacts: {
    /** Capture a screenshot of the current page. */
    screenshot: () => Promise<{ ok: true; base64: string } | { ok: false; error: RRError }>;
  };

  /**
   * Persistent variable operations.
   */
  persistent: {
    /** Get a persistent variable. */
    get: (name: `$${string}`) => Promise<JsonValue | undefined>;
    /** Set a persistent variable. */
    set: (name: `$${string}`, value: JsonValue) => Promise<void>;
    /** Delete a persistent variable. */
    delete: (name: `$${string}`) => Promise<void>;
  };
}

/**
 * Variable patch operation.
 */
export interface VarsPatchOp {
  op: 'set' | 'delete';
  name: string;
  value?: JsonValue;
}

/**
 * Node execution result.
 */
export type NodeExecutionResult =
  | {
      status: 'succeeded';
      /** Next execution direction. */
      next?: { kind: 'edgeLabel'; label: string } | { kind: 'end' };
      /** Output results. */
      outputs?: JsonObject;
      /** Variable modifications. */
      varsPatch?: VarsPatchOp[];
    }
  | { status: 'failed'; error: RRError };

/**
 * Node definition — describes the execution logic for a node kind.
 */
export interface NodeDefinition<
  TKind extends NodeKind = NodeKind,
  TConfig extends JsonObject = JsonObject,
> {
  /** Node kind identifier. */
  kind: TKind;
  /** Config validation schema. */
  schema: Schema<TConfig>;
  /** Default policy. */
  defaultPolicy?: NodePolicy;
  /**
   * Execute the node.
   * @param ctx Execution context
   * @param node Node definition with parsed config
   */
  execute(
    ctx: NodeExecutionContext,
    node: NodeV3 & { kind: TKind; config: TConfig },
  ): Promise<NodeExecutionResult>;
}

/**
 * Trigger installation context.
 */
export interface TriggerInstallContext<
  TKind extends TriggerKind = TriggerKind,
  TConfig extends JsonObject = JsonObject,
> {
  /** Trigger ID. */
  triggerId: TriggerId;
  /** Trigger kind. */
  kind: TKind;
  /** Whether the trigger is enabled. */
  enabled: boolean;
  /** Associated Flow ID. */
  flowId: FlowId;
  /** Trigger configuration. */
  config: TConfig;
  /** Arguments passed to the flow. */
  args?: JsonObject;
}

/**
 * Trigger definition — install and uninstall logic for a trigger kind.
 */
export interface TriggerDefinition<
  TKind extends TriggerKind = TriggerKind,
  TConfig extends JsonObject = JsonObject,
> {
  /** Trigger kind identifier. */
  kind: TKind;
  /** Config validation schema. */
  schema: Schema<TConfig>;
  /** Install the trigger. */
  install(ctx: TriggerInstallContext<TKind, TConfig>): Promise<void> | void;
  /** Uninstall the trigger. */
  uninstall(ctx: TriggerInstallContext<TKind, TConfig>): Promise<void> | void;
}

/**
 * Plugin registration context.
 */
export interface PluginRegistrationContext {
  /** Register a node definition. */
  registerNode(def: NodeDefinition): void;
  /** Register a trigger definition. */
  registerTrigger(def: TriggerDefinition): void;
}

/**
 * Standard plugin interface for Record-Replay.
 */
export interface RRPlugin {
  /** Plugin name. */
  name: string;
  /** Register all plugin contents. */
  register(ctx: PluginRegistrationContext): void;
}
