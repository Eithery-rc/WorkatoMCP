/**
 * Pure helpers to shape recipe and connection list items into the v1.1 slim
 * shape. No I/O, no Chrome APIs — safe to unit-test with fixtures.
 *
 * Source: /web_api/mixed_assets.json items with asset_type=recipe or
 * asset_type=connection respectively. See spec §4.1, §4.2 and
 * docs/design/specs/2026-05-12-v11-discovery-endpoints.md for the
 * full per-item shapes Workato returns.
 */

export interface RecipeListItem {
  id?: number;
  name?: string;
  folder_id?: number;
  project_id?: number;
  running?: boolean;
  state?: string;
  last_run_at?: string | null;
  job_succeeded_count?: number;
  job_failed_count?: number;
  trigger_application?: string;
  trigger_business_object?: string;
  action_applications?: string[];
  [k: string]: unknown;
}

export interface ConnectionListItem {
  id?: number;
  name?: string;
  provider?: string;
  folder_id?: number;
  project_id?: number;
  recipe_count?: number;
  authorization_status?: string;
  authorized_at?: string | null;
  connection_lost_at?: string | null;
  connection_lost_reason?: string | null;
  updated_at?: string;
  [k: string]: unknown;
}

export interface SlimRecipe {
  id: number;
  name: string;
  folder_id: number;
  project_id: number;
  running: boolean;
  state: string;
  last_run_at: string | null;
  job_succeeded_count: number;
  job_failed_count: number;
  trigger_application: string;
  trigger_business_object: string;
  action_applications: string[];
}

export interface SlimConnection {
  id: number;
  name: string;
  provider: string;
  folder_id: number;
  project_id: number;
  recipe_count: number;
  authorization_status: string;
  authorized_at: string | null;
  connection_lost_at: string | null;
  connection_lost_reason: string | null;
  updated_at: string;
}

export function buildSlimRecipe(item: RecipeListItem): SlimRecipe {
  return {
    id: Number(item.id ?? 0),
    name: String(item.name ?? ''),
    folder_id: Number(item.folder_id ?? 0),
    project_id: Number(item.project_id ?? 0),
    running: Boolean(item.running),
    state: String(item.state ?? ''),
    last_run_at: item.last_run_at ?? null,
    job_succeeded_count: Number(item.job_succeeded_count ?? 0),
    job_failed_count: Number(item.job_failed_count ?? 0),
    trigger_application: String(item.trigger_application ?? ''),
    trigger_business_object: String(item.trigger_business_object ?? ''),
    action_applications: Array.isArray(item.action_applications)
      ? item.action_applications.map(String)
      : [],
  };
}

export interface RecipeMatchHighlights {
  name?: string;
  description?: string;
  actions?: string[];
  applications?: string[];
}

/**
 * Workato marks what a full-text query matched by wrapping it in
 * `<span class="text-highlight">`. The markup is noise in a tool response; the
 * sentence around it is the answer to "why did this recipe come back".
 */
export function cleanHighlightMarkup(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The cleaned highlight blocks of one list item, or null when it has none. */
export function extractHighlights(item: RecipeListItem): RecipeMatchHighlights | null {
  const raw = item.highlights;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const out: RecipeMatchHighlights = {};
  const name = cleanHighlightMarkup(record.name);
  if (name) out.name = name;
  const description = cleanHighlightMarkup(record.description);
  if (description) out.description = description;
  for (const key of ['actions', 'applications'] as const) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    const cleaned = list.map(cleanHighlightMarkup).filter((entry) => entry !== '');
    if (cleaned.length > 0) out[key] = cleaned;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function buildSlimConnection(item: ConnectionListItem): SlimConnection {
  return {
    id: Number(item.id ?? 0),
    name: String(item.name ?? ''),
    provider: String(item.provider ?? ''),
    folder_id: Number(item.folder_id ?? 0),
    project_id: Number(item.project_id ?? 0),
    recipe_count: Number(item.recipe_count ?? 0),
    authorization_status: String(item.authorization_status ?? ''),
    authorized_at: item.authorized_at ?? null,
    connection_lost_at: item.connection_lost_at ?? null,
    connection_lost_reason: item.connection_lost_reason ?? null,
    updated_at: String(item.updated_at ?? ''),
  };
}
