/**
 * @fileoverview Shared run-enqueue service.
 *
 * Provides unified enqueue logic used by both RpcServer and TriggerManager.
 *
 * Design rationale:
 * - Extracts enqueue logic out of RpcServer into a standalone service
 * - Prevents behavioral drift between RPC and TriggerManager
 * - Centralises argument validation, RunRecord creation, queue insertion, and event publishing
 */

import type { JsonObject, UnixMillis } from '../../domain/json';
import type { FlowId, NodeId, RunId } from '../../domain/ids';
import type { TriggerFireContext } from '../../domain/triggers';
import { RUN_SCHEMA_VERSION, type RunRecordV3 } from '../../domain/events';
import type { StoragePort } from '../storage/storage-port';
import type { EventsBus } from '../transport/events-bus';
import type { RunScheduler } from './scheduler';

// ==================== Types ====================

/**
 * Dependencies for the enqueue service.
 */
export interface EnqueueRunDeps {
  /** Storage layer (only flows/runs/queue needed). */
  storage: Pick<StoragePort, 'flows' | 'runs' | 'queue'>;
  /** Events bus. */
  events: Pick<EventsBus, 'append'>;
  /** Scheduler (optional — kick is called best-effort). */
  scheduler?: Pick<RunScheduler, 'kick'>;
  /** RunId generator (injectable for tests). */
  generateRunId?: () => RunId;
  /** Time source (injectable for tests). */
  now?: () => UnixMillis;
}

/**
 * Enqueue request parameters.
 */
export interface EnqueueRunInput {
  /** Flow ID (required). */
  flowId: FlowId;
  /** Start node ID (optional; defaults to the flow's entryNodeId). */
  startNodeId?: NodeId;
  /** Priority (default 0). */
  priority?: number;
  /** Maximum attempts (default 1). */
  maxAttempts?: number;
  /** Arguments passed to the flow. */
  args?: JsonObject;
  /** Trigger context (set by TriggerManager). */
  trigger?: TriggerFireContext;
  /** Debug options. */
  debug?: {
    breakpoints?: NodeId[];
    pauseOnStart?: boolean;
  };
}

/**
 * Enqueue result.
 */
export interface EnqueueRunResult {
  /** Newly created Run ID. */
  runId: RunId;
  /** 1-based position in the queue. */
  position: number;
}

// ==================== Utilities ====================

/**
 * Default RunId generator.
 */
function defaultGenerateRunId(): RunId {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate and coerce an integer parameter.
 */
function validateInt(
  value: unknown,
  defaultValue: number,
  fieldName: string,
  opts?: { min?: number; max?: number },
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  const intValue = Math.floor(value);
  if (opts?.min !== undefined && intValue < opts.min) {
    throw new Error(`${fieldName} must be >= ${opts.min}`);
  }
  if (opts?.max !== undefined && intValue > opts.max) {
    throw new Error(`${fieldName} must be <= ${opts.max}`);
  }
  return intValue;
}

/**
 * Compute the run's 1-based position in the queue (scheduling order: priority DESC, createdAt ASC).
 * Returns -1 if the run is not found (e.g. already claimed by the scheduler).
 */
async function computeQueuePosition(
  storage: Pick<StoragePort, 'queue'>,
  runId: RunId,
): Promise<number> {
  const queueItems = await storage.queue.list('queued');
  queueItems.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.createdAt - b.createdAt;
  });
  const index = queueItems.findIndex((item) => item.id === runId);
  // Return -1 if not found (run may have been claimed already)
  return index === -1 ? -1 : index + 1;
}

// ==================== Main Function ====================

/**
 * Enqueue a run for execution.
 *
 * Steps:
 * 1. Validate arguments
 * 2. Verify flow exists
 * 3. Create RunRecordV3 (status=queued)
 * 4. Enqueue to RunQueue
 * 5. Publish run.queued event
 * 6. Trigger scheduling (best-effort)
 * 7. Compute queue position
 */
export async function enqueueRun(
  deps: EnqueueRunDeps,
  input: EnqueueRunInput,
): Promise<EnqueueRunResult> {
  const { flowId } = input;
  if (!flowId) {
    throw new Error('flowId is required');
  }

  const now = deps.now ?? (() => Date.now());
  const generateRunId = deps.generateRunId ?? defaultGenerateRunId;

  // Validate integer arguments
  const priority = validateInt(input.priority, 0, 'priority');
  const maxAttempts = validateInt(input.maxAttempts, 1, 'maxAttempts', { min: 1 });

  // Verify flow exists
  const flow = await deps.storage.flows.get(flowId);
  if (!flow) {
    throw new Error(`Flow "${flowId}" not found`);
  }

  // Verify startNodeId exists in the flow
  if (input.startNodeId) {
    const nodeExists = flow.nodes.some((n) => n.id === input.startNodeId);
    if (!nodeExists) {
      throw new Error(`startNodeId "${input.startNodeId}" not found in flow "${flowId}"`);
    }
  }

  const ts = now();
  const runId = generateRunId();

  // 1. Create RunRecordV3
  const runRecord: RunRecordV3 = {
    schemaVersion: RUN_SCHEMA_VERSION,
    id: runId,
    flowId,
    status: 'queued',
    createdAt: ts,
    updatedAt: ts,
    attempt: 0,
    maxAttempts,
    args: input.args,
    trigger: input.trigger,
    debug: input.debug,
    startNodeId: input.startNodeId,
    nextSeq: 0,
  };
  await deps.storage.runs.save(runRecord);

  // 2. Enqueue
  await deps.storage.queue.enqueue({
    id: runId,
    flowId,
    priority,
    maxAttempts,
    args: input.args,
    trigger: input.trigger,
    debug: input.debug,
  });

  // 3. Publish run.queued event
  await deps.events.append({
    runId,
    type: 'run.queued',
    flowId,
  });

  // 4. Compute queue position before kick (reduces race where position becomes -1)
  const position = await computeQueuePosition(deps.storage, runId);

  // 5. Trigger scheduling (best-effort, non-blocking)
  if (deps.scheduler) {
    void deps.scheduler.kick();
  }

  return { runId, position };
}
