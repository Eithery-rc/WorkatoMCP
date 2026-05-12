/**
 * @fileoverview ID type definitions for Record-Replay V3.
 */

/** Flow unique identifier. */
export type FlowId = string;

/** Node unique identifier. */
export type NodeId = string;

/** Edge unique identifier. */
export type EdgeId = string;

/** Run unique identifier. */
export type RunId = string;

/** Trigger unique identifier. */
export type TriggerId = string;

/** Edge label type. */
export type EdgeLabel = string;

/** Predefined edge label constants. */
export const EDGE_LABELS = {
  /** Default edge. */
  DEFAULT: 'default',
  /** Error-handling edge. */
  ON_ERROR: 'onError',
  /** Edge taken when condition is true. */
  TRUE: 'true',
  /** Edge taken when condition is false. */
  FALSE: 'false',
} as const;

/** Edge label value type (derived from constants). */
export type EdgeLabelValue = (typeof EDGE_LABELS)[keyof typeof EDGE_LABELS];
