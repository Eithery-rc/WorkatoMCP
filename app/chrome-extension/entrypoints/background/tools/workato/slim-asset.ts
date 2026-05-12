/**
 * Pure helpers to shape recipe and connection list items into the v1.1 slim
 * shape. No I/O, no Chrome APIs — safe to unit-test with fixtures.
 *
 * Source: /web_api/mixed_assets.json items with asset_type=recipe or
 * asset_type=connection respectively. See spec §4.1, §4.2 and
 * docs/superpowers/specs/2026-05-12-v11-discovery-endpoints.md for the
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
