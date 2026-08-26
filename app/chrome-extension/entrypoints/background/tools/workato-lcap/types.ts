/**
 * Shared types for the workato_lcap_* tool family — Workato Workflow App
 * (LCAP) page reads and writes.
 *
 * All HTTP traffic is page-side (fetch from the logged-in tab origin) using
 * the cookie + XSRF-TOKEN-V2 CSRF pattern the rest of the Workato tools use.
 * Workato resolves the workspace and environment from the tab's own session,
 * so every call takes a tab target and a 404 never proves the page is gone.
 *
 * Format reference: skills/workato-recipes/workflow-apps.md.
 */

export interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
  /** In-page fetch timeout. Default 30000, clamped 10000-110000. */
  timeout_ms?: number;
}

export type LcapAppsListArgs = TabTargetArgs;

export interface LcapPageGetArgs extends TabTargetArgs {
  page_id: number;
  /**
   * 'index' (default) returns page metadata plus a widget index.
   * 'full' returns the raw `content` tree.
   */
  view?: 'index' | 'full';
  /**
   * Resolved in the native-server: writes {page_id, updated_at, content} to
   * disk and returns only the index, so the tree never enters the context.
   */
  out_file?: string;
}

export interface LcapPageSaveArgs extends TabTargetArgs {
  page_id: number;
  /** The full replacement `content` tree. Mutually exclusive with content_path. */
  content?: unknown;
  /** Path to a JSON file holding the tree (or a {content:...} envelope). */
  content_path?: string;
  /** Optimistic lock: refuse when the stored page has a different updated_at. */
  expected_updated_at?: string;
  /** Permit widgets present in the stored page to disappear. */
  allow_widget_removal?: boolean;
  /** Permit a layout's row extent to shrink after a removal. */
  allow_row_collapse?: boolean;
  /** Save even though the page builder is open on this page. */
  force?: boolean;
  /** Skip the post-save render probe. */
  skip_render_check?: boolean;
}

export interface LcapPageValidateArgs extends TabTargetArgs {
  /** Validate the stored page (static checks plus a render probe). */
  page_id?: number;
  /** Validate a tree in hand (static checks only). */
  content?: unknown;
  content_path?: string;
}

export interface LcapWidgetPatchArgs extends TabTargetArgs {
  page_id: number;
  widget_id: string;
  /** Presentational properties to overwrite. See ALLOWED_WIDGET_PROPS. */
  props: Record<string, unknown>;
  expected_updated_at?: string;
  force?: boolean;
  skip_render_check?: boolean;
}

export interface LcapPageCreateArgs extends TabTargetArgs {
  folder_id: number;
  name: string;
  /** Advisory only: Workato regenerates the path from the name. */
  path?: string;
  content?: unknown;
  content_path?: string;
}

export interface LcapPageDeleteArgs extends TabTargetArgs {
  page_id: number;
  /** Must be exactly true. There is no undo. */
  confirm?: boolean;
}

export interface WorkatoApiRequestArgs extends TabTargetArgs {
  method?: string;
  /** Path on the Workato app host, e.g. /web_api/lcap/pages/61604.json. */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Required for anything other than GET/HEAD. */
  allow_writes?: boolean;
  /** Resolved in the native-server: write the response body to this path. */
  out_file?: string;
  /** Response body cap before truncation. Default 20000. */
  max_bytes?: number;
}
