/**
 * @fileoverview RunQueue interface — manages the run queue and scheduling.
 */

import type { JsonObject, UnixMillis } from '../../domain/json';
import type { FlowId, NodeId, RunId } from '../../domain/ids';
import type { TriggerFireContext } from '../../domain/triggers';

/**
 * RunQueue configuration.
 */
export interface RunQueueConfig {
  /** Maximum number of parallel runs. */
  maxParallelRuns: number;
  /** Lease TTL in milliseconds. */
  leaseTtlMs: number;
  /** Heartbeat interval in milliseconds. */
  heartbeatIntervalMs: number;
}

/**
 * Default queue configuration.
 */
export const DEFAULT_QUEUE_CONFIG: RunQueueConfig = {
  maxParallelRuns: 3,
  leaseTtlMs: 15_000,
  heartbeatIntervalMs: 5_000,
};

/**
 * Queue item status.
 */
export type QueueItemStatus = 'queued' | 'running' | 'paused';

/**
 * Lease information.
 */
export interface Lease {
  /** Owner ID. */
  ownerId: string;
  /** Expiry time. */
  expiresAt: UnixMillis;
}

/**
 * RunQueue queue item.
 */
export interface RunQueueItem {
  /** Run ID. */
  id: RunId;
  /** Flow ID. */
  flowId: FlowId;
  /** Status. */
  status: QueueItemStatus;
  /** Creation time. */
  createdAt: UnixMillis;
  /** Last updated time. */
  updatedAt: UnixMillis;
  /** Priority (higher = more important). */
  priority: number;
  /** Current attempt number. */
  attempt: number;
  /** Maximum number of attempts. */
  maxAttempts: number;
  /** Tab ID. */
  tabId?: number;
  /** Run arguments. */
  args?: JsonObject;
  /** Trigger context. */
  trigger?: TriggerFireContext;
  /** Lease information. */
  lease?: Lease;
  /** Debug configuration. */
  debug?: { breakpoints?: NodeId[]; pauseOnStart?: boolean };
}

/**
 * Enqueue input (excludes auto-generated fields).
 * priority defaults to 0, maxAttempts defaults to 1.
 */
export type EnqueueInput = Omit<
  RunQueueItem,
  'status' | 'createdAt' | 'updatedAt' | 'attempt' | 'lease' | 'priority' | 'maxAttempts'
> & {
  id: RunId;
  /** Priority (higher = more important, default 0). */
  priority?: number;
  /** Maximum attempts (default 1). */
  maxAttempts?: number;
};

/**
 * RunQueue interface — manages run queue items and scheduling.
 */
export interface RunQueue {
  /**
   * Enqueue a run.
   * @param input Enqueue request
   * @returns Queue item
   */
  enqueue(input: EnqueueInput): Promise<RunQueueItem>;

  /**
   * Claim the next available run.
   * @param ownerId Claimer ID
   * @param now Current time
   * @returns Queue item or null
   */
  claimNext(ownerId: string, now: UnixMillis): Promise<RunQueueItem | null>;

  /**
   * Renew the lease heartbeat.
   * @param ownerId Claimer ID
   * @param now Current time
   */
  heartbeat(ownerId: string, now: UnixMillis): Promise<void>;

  /**
   * Reclaim expired leases (items where lease.expiresAt < now) back to queued status.
   * @param now Current time
   * @returns List of reclaimed run IDs
   */
  reclaimExpiredLeases(now: UnixMillis): Promise<RunId[]>;

  /**
   * Recover orphan leases after a Service Worker restart.
   * - Orphan running items are re-queued (status -> queued, lease cleared)
   * - Orphan paused items are adopted (status stays paused, lease.ownerId updated)
   * @param ownerId New ownerId for this Service Worker instance
   * @param now Current time
   * @returns Affected run IDs with their previous ownerId (for audit)
   */
  recoverOrphanLeases(
    ownerId: string,
    now: UnixMillis,
  ): Promise<{
    requeuedRunning: Array<{ runId: RunId; prevOwnerId?: string }>;
    adoptedPaused: Array<{ runId: RunId; prevOwnerId?: string }>;
  }>;

  /**
   * Mark a run as running.
   */
  markRunning(runId: RunId, ownerId: string, now: UnixMillis): Promise<void>;

  /**
   * Mark a run as paused.
   */
  markPaused(runId: RunId, ownerId: string, now: UnixMillis): Promise<void>;

  /**
   * Mark a run as done (remove from queue).
   */
  markDone(runId: RunId, now: UnixMillis): Promise<void>;

  /**
   * Cancel a run.
   */
  cancel(runId: RunId, now: UnixMillis, reason?: string): Promise<void>;

  /**
   * Get a queue item.
   */
  get(runId: RunId): Promise<RunQueueItem | null>;

  /**
   * List queue items.
   */
  list(status?: QueueItemStatus): Promise<RunQueueItem[]>;
}

/**
 * Create a stub RunQueue that throws on every call.
 * Placeholder for Phase 0.
 */
export function createNotImplementedQueue(): RunQueue {
  const notImplemented = () => {
    throw new Error('RunQueue not implemented');
  };

  return {
    enqueue: async () => notImplemented(),
    claimNext: async () => notImplemented(),
    heartbeat: async () => notImplemented(),
    reclaimExpiredLeases: async () => notImplemented(),
    recoverOrphanLeases: async () => notImplemented(),
    markRunning: async () => notImplemented(),
    markPaused: async () => notImplemented(),
    markDone: async () => notImplemented(),
    cancel: async () => notImplemented(),
    get: async () => notImplemented(),
    list: async () => notImplemented(),
  };
}
