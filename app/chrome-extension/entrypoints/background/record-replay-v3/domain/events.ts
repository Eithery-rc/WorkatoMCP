/**
 * @fileoverview Run event types and state definitions for Record-Replay V3.
 */

import type { JsonObject, JsonValue, UnixMillis } from './json';
import type { EdgeLabel, FlowId, NodeId, RunId } from './ids';
import type { RRError } from './errors';
import type { TriggerFireContext } from './triggers';

/** Unsubscribe function type. */
export type Unsubscribe = () => void;

/** Run status. */
export type RunStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled';

/**
 * Base fields shared by all events.
 */
export interface EventBase {
  /** Owning Run ID. */
  runId: RunId;
  /** Event timestamp. */
  ts: UnixMillis;
  /** Monotonically increasing sequence number. */
  seq: number;
}

/**
 * Reason a run was paused.
 */
export type PauseReason =
  | { kind: 'breakpoint'; nodeId: NodeId }
  | { kind: 'step'; nodeId: NodeId }
  | { kind: 'command' }
  | { kind: 'policy'; nodeId: NodeId; reason: string };

/** Recovery reason. */
export type RecoveryReason = 'sw_restart' | 'lease_expired';

/**
 * Union of all run-time events.
 */
export type RunEvent =
  // ===== Run lifecycle events =====
  | (EventBase & { type: 'run.queued'; flowId: FlowId })
  | (EventBase & { type: 'run.started'; flowId: FlowId; tabId: number })
  | (EventBase & { type: 'run.paused'; reason: PauseReason; nodeId?: NodeId })
  | (EventBase & { type: 'run.resumed' })
  | (EventBase & {
      type: 'run.recovered';
      /** Recovery reason. */
      reason: RecoveryReason;
      /** Status before recovery. */
      fromStatus: 'running' | 'paused';
      /** Status after recovery. */
      toStatus: 'queued';
      /** Previous ownerId (for audit). */
      prevOwnerId?: string;
    })
  | (EventBase & { type: 'run.canceled'; reason?: string })
  | (EventBase & { type: 'run.succeeded'; tookMs: number; outputs?: JsonObject })
  | (EventBase & { type: 'run.failed'; error: RRError; nodeId?: NodeId })

  // ===== Node execution events =====
  | (EventBase & { type: 'node.queued'; nodeId: NodeId })
  | (EventBase & { type: 'node.started'; nodeId: NodeId; attempt: number })
  | (EventBase & {
      type: 'node.succeeded';
      nodeId: NodeId;
      tookMs: number;
      next?: { kind: 'edgeLabel'; label: EdgeLabel } | { kind: 'end' };
    })
  | (EventBase & {
      type: 'node.failed';
      nodeId: NodeId;
      attempt: number;
      error: RRError;
      decision: 'retry' | 'continue' | 'stop' | 'goto';
    })
  | (EventBase & { type: 'node.skipped'; nodeId: NodeId; reason: 'disabled' | 'unreachable' })

  // ===== Variable and log events =====
  | (EventBase & {
      type: 'vars.patch';
      patch: Array<{ op: 'set' | 'delete'; name: string; value?: JsonValue }>;
    })
  | (EventBase & { type: 'artifact.screenshot'; nodeId: NodeId; data: string; savedAs?: string })
  | (EventBase & {
      type: 'log';
      level: 'debug' | 'info' | 'warn' | 'error';
      message: string;
      data?: JsonValue;
    });

/** Run event type (extracted from the union). */
export type RunEventType = RunEvent['type'];

/**
 * Distributive Omit (preserves union members).
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Run event input type.
 * seq must be assigned atomically by the storage layer (via RunRecordV3.nextSeq).
 * ts is optional and defaults to Date.now().
 */
export type RunEventInput = DistributiveOmit<RunEvent, 'seq' | 'ts'> & {
  ts?: UnixMillis;
};

/** Run schema version. */
export const RUN_SCHEMA_VERSION = 3 as const;

/**
 * Run record V3 — the summary stored in IndexedDB.
 */
export interface RunRecordV3 {
  /** Schema version. */
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  /** Run unique identifier. */
  id: RunId;
  /** Associated Flow ID. */
  flowId: FlowId;

  /** Current status. */
  status: RunStatus;
  /** Creation time. */
  createdAt: UnixMillis;
  /** Last updated time. */
  updatedAt: UnixMillis;

  /** Execution start time. */
  startedAt?: UnixMillis;
  /** Finish time. */
  finishedAt?: UnixMillis;
  /** Total elapsed time (ms). */
  tookMs?: number;

  /** Bound tab ID (one tab per run). */
  tabId?: number;
  /** Start node ID (if not the default entry). */
  startNodeId?: NodeId;
  /** Currently executing node ID. */
  currentNodeId?: NodeId;

  /** Current attempt number. */
  attempt: number;
  /** Maximum number of attempts. */
  maxAttempts: number;

  /** Run arguments. */
  args?: JsonObject;
  /** Trigger context. */
  trigger?: TriggerFireContext;
  /** Debug configuration. */
  debug?: { breakpoints?: NodeId[]; pauseOnStart?: boolean };

  /** Error (if failed). */
  error?: RRError;
  /** Output results. */
  outputs?: JsonObject;

  /** Next event sequence number (cached field). */
  nextSeq: number;
}

/**
 * Whether a run status is terminal.
 */
export function isTerminalStatus(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

/**
 * Whether a run status is active (running or paused).
 */
export function isActiveStatus(status: RunStatus): boolean {
  return status === 'running' || status === 'paused';
}
