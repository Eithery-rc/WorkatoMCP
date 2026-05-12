/**
 * Shared types for the snapshot+UID tool family.
 *
 * Tools in this folder build an accessibility-tree snapshot of a tab using
 * CDP (DOM + Accessibility domains) and tag each interactive element with a
 * stable per-snapshot UID. The model then drives the page by passing those
 * UIDs to chrome_snapshot_click / chrome_snapshot_fill / chrome_snapshot_hover.
 */

export interface UidMapEntry {
  snapshotId: string;
  uidToBackendNodeId: Map<number, number>;
  capturedAt: number;
}

export interface SnapshotResult {
  snapshotId: string;
  text: string;
  uidCount: number;
}

/**
 * Subset of the CDP Accessibility.AXNode shape we care about. The real type
 * has more fields, but we only consume role/name/childIds/backendDOMNodeId/
 * ignored/properties.
 */
export interface AXNode {
  nodeId: string;
  parentId?: string;
  backendDOMNodeId?: number;
  // CDP normally returns { value: string }, but some Chrome versions emit a flat
  // string — keep the type defensive so the formatter can normalize.
  role?: { value: string } | string;
  name?: { value: string } | string;
  childIds?: string[];
  ignored?: boolean;
  properties?: Array<{ name: string; value: { value: any } }>;
}
