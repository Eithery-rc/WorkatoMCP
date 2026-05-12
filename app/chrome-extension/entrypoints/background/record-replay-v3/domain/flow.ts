/**
 * @fileoverview Flow IR (intermediate representation) types for Record-Replay V3.
 */

import type { ISODateTimeString, JsonObject } from './json';
import type { EdgeId, EdgeLabel, FlowId, NodeId } from './ids';
import type { FlowPolicy, NodePolicy } from './policy';
import type { VariableDefinition } from './variables';

/** Flow schema version. */
export const FLOW_SCHEMA_VERSION = 3 as const;

/**
 * Edge V3 — a directed connection between two DAG nodes.
 */
export interface EdgeV3 {
  /** Edge unique identifier. */
  id: EdgeId;
  /** Source node ID. */
  from: NodeId;
  /** Target node ID. */
  to: NodeId;
  /** Edge label (for conditional branches and error handling). */
  label?: EdgeLabel;
}

/** Node kind (extensible string). */
export type NodeKind = string;

/**
 * Node V3 — a single executable operation in the DAG.
 */
export interface NodeV3 {
  /** Node unique identifier. */
  id: NodeId;
  /** Node kind. */
  kind: NodeKind;
  /** Display name. */
  name?: string;
  /** Whether the node is disabled. */
  disabled?: boolean;
  /** Node-level policy. */
  policy?: NodePolicy;
  /** Node configuration (structure depends on kind). */
  config: JsonObject;
  /** UI layout hint. */
  ui?: { x: number; y: number };
}

/**
 * Flow binding — associates a flow with a specific domain, path, or URL.
 */
export interface FlowBinding {
  kind: 'domain' | 'path' | 'url';
  value: string;
}

/**
 * Flow V3 — the complete flow definition with nodes, edges, and configuration.
 */
export interface FlowV3 {
  /** Schema version. */
  schemaVersion: typeof FLOW_SCHEMA_VERSION;
  /** Flow unique identifier. */
  id: FlowId;
  /** Flow name. */
  name: string;
  /** Flow description. */
  description?: string;
  /** Creation time. */
  createdAt: ISODateTimeString;
  /** Last updated time. */
  updatedAt: ISODateTimeString;

  /** Entry node ID (explicit — not inferred from in-degree). */
  entryNodeId: NodeId;
  /** Node list. */
  nodes: NodeV3[];
  /** Edge list. */
  edges: EdgeV3[];

  /** Variable definitions. */
  variables?: VariableDefinition[];
  /** Flow-level policy. */
  policy?: FlowPolicy;
  /** Metadata. */
  meta?: {
    /** Tags. */
    tags?: string[];
    /** Binding rules. */
    bindings?: FlowBinding[];
  };
}

/**
 * Find a node by ID.
 */
export function findNodeById(flow: FlowV3, nodeId: NodeId): NodeV3 | undefined {
  return flow.nodes.find((n) => n.id === nodeId);
}

/**
 * Find all edges originating from a node.
 */
export function findEdgesFrom(flow: FlowV3, nodeId: NodeId): EdgeV3[] {
  return flow.edges.filter((e) => e.from === nodeId);
}

/**
 * Find all edges pointing to a node.
 */
export function findEdgesTo(flow: FlowV3, nodeId: NodeId): EdgeV3[] {
  return flow.edges.filter((e) => e.to === nodeId);
}
