/**
 * Shared types for the snapshot+UID tool family.
 *
 * Tools in this folder build an accessibility-tree snapshot of a tab using
 * CDP (DOM + Accessibility domains) and tag each element worth acting on with
 * a uid. A uid names one DOM node for as long as that node exists: a later
 * snapshot gives the same node the same uid, and a uid is never reused for
 * another node. The model drives the page by passing uids to
 * chrome_snapshot_click / _fill / _hover / _fill_form, chrome_act and
 * chrome_javascript(uids).
 */

/** Where a uid points: one DOM node of one document of one frame. */
export interface UidNodeRef {
  backendNodeId: number;
  frameId: string;
  /** The frame's document identity when the uid was issued; a navigation changes it. */
  loaderId: string;
  /** Snapshot sequence number the node was last seen in. */
  seen: number;
  /**
   * What the node was when last rendered with this uid: its AX role and name,
   * and the name of its nearest row-like ancestor. A recycled node (a keyed
   * list that re-renders another record into the same DOM node) keeps its
   * backendNodeId, so these are what tell "same element" from "same node".
   */
  role?: string;
  name?: string;
  row?: string;
}

/** Identity facts recorded with a uid at snapshot time. */
export interface UidIdentity {
  role: string;
  name: string;
  row?: string;
}

/**
 * Subset of the CDP Accessibility.AXNode shape we care about. The real type
 * has more fields, but we only consume role/name/value/childIds/
 * backendDOMNodeId/ignored/properties.
 */
export interface AXNode {
  nodeId: string;
  parentId?: string;
  backendDOMNodeId?: number;
  // CDP normally returns { value: string }, but some Chrome versions emit a flat
  // string; keep the type defensive so the formatter can normalize.
  role?: { value: string } | string;
  name?: { value: string } | string;
  value?: { value?: unknown } | string;
  childIds?: string[];
  ignored?: boolean;
  properties?: Array<{ name: string; value: { value: any } }>;
}

/** Layout facts from DOMSnapshot.captureSnapshot, keyed by backendNodeId. */
export interface DomInfo {
  /** Elements with cursor:pointer whose nearest laid-out parent element has another cursor. */
  pointerRoots: Set<number>;
  /** Text nodes whose parent element has cursor:pointer. */
  pointerText: Set<number>;
  /** input[type=password] nodes: their value is never shown. */
  passwordInputs: Set<number>;
}
