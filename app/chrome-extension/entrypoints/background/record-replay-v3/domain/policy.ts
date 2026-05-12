/**
 * @fileoverview Policy type definitions for Record-Replay V3 (timeout, retry, error handling, artifacts).
 */

import type { EdgeLabel, NodeId } from './ids';
import type { RRErrorCode } from './errors';
import type { UnixMillis } from './json';

/**
 * Timeout policy — defines the timeout duration and scope for an operation.
 */
export interface TimeoutPolicy {
  /** Timeout in milliseconds. */
  ms: UnixMillis;
  /** Timeout scope: attempt=per attempt, node=entire node execution. */
  scope?: 'attempt' | 'node';
}

/**
 * Retry policy — defines retry behavior after a failure.
 */
export interface RetryPolicy {
  /** Maximum number of retries. */
  retries: number;
  /** Retry interval in milliseconds. */
  intervalMs: UnixMillis;
  /** Backoff strategy: none=fixed, exp=exponential, linear=linear growth. */
  backoff?: 'none' | 'exp' | 'linear';
  /** Maximum retry interval in milliseconds. */
  maxIntervalMs?: UnixMillis;
  /** Jitter strategy: none=no jitter, full=full random. */
  jitter?: 'none' | 'full';
  /** Retry only on these error codes. */
  retryOn?: ReadonlyArray<RRErrorCode>;
}

/**
 * On-error policy — defines what to do when a node execution fails.
 */
export type OnErrorPolicy =
  | { kind: 'stop' }
  | { kind: 'continue'; as?: 'warning' | 'error' }
  | {
      kind: 'goto';
      target: { kind: 'edgeLabel'; label: EdgeLabel } | { kind: 'node'; nodeId: NodeId };
    }
  | { kind: 'retry'; override?: Partial<RetryPolicy> };

/**
 * Artifact policy — controls screenshot and console log collection.
 */
export interface ArtifactPolicy {
  /** Screenshot capture mode: never, onFailure, or always. */
  screenshot?: 'never' | 'onFailure' | 'always';
  /** Template path to save the screenshot. */
  saveScreenshotAs?: string;
  /** Whether to include console logs. */
  includeConsole?: boolean;
  /** Whether to include network requests. */
  includeNetwork?: boolean;
}

/**
 * Node-level execution policy.
 */
export interface NodePolicy {
  /** Timeout policy. */
  timeout?: TimeoutPolicy;
  /** Retry policy. */
  retry?: RetryPolicy;
  /** On-error policy. */
  onError?: OnErrorPolicy;
  /** Artifact policy. */
  artifacts?: ArtifactPolicy;
}

/**
 * Flow-level execution policy.
 */
export interface FlowPolicy {
  /** Default policy applied to all nodes. */
  defaultNodePolicy?: NodePolicy;
  /** Policy for unsupported node kinds. */
  unsupportedNodePolicy?: OnErrorPolicy;
  /** Total run timeout in milliseconds. */
  runTimeoutMs?: UnixMillis;
}

/**
 * Merge the flow-level default policy with a node-level policy override.
 */
export function mergeNodePolicy(
  flowDefault: NodePolicy | undefined,
  nodePolicy: NodePolicy | undefined,
): NodePolicy {
  if (!flowDefault) return nodePolicy ?? {};
  if (!nodePolicy) return flowDefault;

  return {
    timeout: nodePolicy.timeout ?? flowDefault.timeout,
    retry: nodePolicy.retry ?? flowDefault.retry,
    onError: nodePolicy.onError ?? flowDefault.onError,
    artifacts: nodePolicy.artifacts
      ? { ...flowDefault.artifacts, ...nodePolicy.artifacts }
      : flowDefault.artifacts,
  };
}
