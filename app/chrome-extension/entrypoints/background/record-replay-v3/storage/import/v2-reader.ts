/**
 * @fileoverview V2 data reader — reads V2-format data (placeholder implementation).
 */

/**
 * V2 data reader interface.
 * Full implementation is planned for Phase 5+.
 */
export interface V2Reader {
  /** Read V2 Flows */
  readFlows(): Promise<unknown[]>;
  /** Read V2 Runs */
  readRuns(): Promise<unknown[]>;
  /** Read V2 Triggers */
  readTriggers(): Promise<unknown[]>;
  /** Read V2 Schedules */
  readSchedules(): Promise<unknown[]>;
}

/**
 * Create a not-implemented V2Reader (placeholder).
 */
export function createNotImplementedV2Reader(): V2Reader {
  const notImplemented = async () => {
    throw new Error('V2Reader not implemented');
  };

  return {
    readFlows: notImplemented,
    readRuns: notImplemented,
    readTriggers: notImplemented,
    readSchedules: notImplemented,
  };
}
