/**
 * @fileoverview Lease manager — handles run lease heartbeats and expired lease reclamation.
 */

import type { UnixMillis } from '../../domain/json';
import type { RunId } from '../../domain/ids';
import type { RunQueue, RunQueueConfig, Lease } from './queue';

/**
 * Manages lease heartbeats and expiry detection.
 */
export interface LeaseManager {
  /**
   * Start a heartbeat for the given owner.
   * @param ownerId Owner ID
   */
  startHeartbeat(ownerId: string): void;

  /**
   * Stop the heartbeat for the given owner.
   * @param ownerId Owner ID
   */
  stopHeartbeat(ownerId: string): void;

  /**
   * Reclaim all expired leases and return their run IDs.
   * @param now Current time
   */
  reclaimExpiredLeases(now: UnixMillis): Promise<RunId[]>;

  /**
   * Whether a lease has expired.
   */
  isLeaseExpired(lease: Lease, now: UnixMillis): boolean;

  /**
   * Create a new lease for the given owner.
   */
  createLease(ownerId: string, now: UnixMillis): Lease;

  /**
   * Stop all active heartbeats and release resources.
   */
  dispose(): void;
}

/**
 * Create a LeaseManager backed by the given RunQueue.
 */
export function createLeaseManager(queue: RunQueue, config: RunQueueConfig): LeaseManager {
  const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

  return {
    startHeartbeat(ownerId: string): void {
      // Stop any existing timer first
      this.stopHeartbeat(ownerId);

      // Create a new heartbeat timer
      const timer = setInterval(async () => {
        try {
          await queue.heartbeat(ownerId, Date.now());
        } catch (error) {
          console.error(`[LeaseManager] Heartbeat failed for ${ownerId}:`, error);
        }
      }, config.heartbeatIntervalMs);

      heartbeatTimers.set(ownerId, timer);
    },

    stopHeartbeat(ownerId: string): void {
      const timer = heartbeatTimers.get(ownerId);
      if (timer) {
        clearInterval(timer);
        heartbeatTimers.delete(ownerId);
      }
    },

    async reclaimExpiredLeases(now: UnixMillis): Promise<RunId[]> {
      // Delegate to the queue implementation which uses the lease_expiresAt index
      // for efficient scanning and updates storage atomically.
      return queue.reclaimExpiredLeases(now);
    },

    isLeaseExpired(lease: Lease, now: UnixMillis): boolean {
      return lease.expiresAt < now;
    },

    createLease(ownerId: string, now: UnixMillis): Lease {
      return {
        ownerId,
        expiresAt: now + config.leaseTtlMs,
      };
    },

    dispose(): void {
      for (const timer of heartbeatTimers.values()) {
        clearInterval(timer);
      }
      heartbeatTimers.clear();
    },
  };
}

/**
 * Generate a unique owner ID to identify the current Service Worker instance.
 */
export function generateOwnerId(): string {
  return `sw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
