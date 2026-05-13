/**
 * workato_whoami — surfaces the active Workato tab's authenticated session
 * context so an agent can answer "where am I connected, as whom, in which
 * workspace, with which roles and environments available?"
 *
 * Reads /web_api/auth_user.json and returns a slim, agent-friendly shape.
 */

import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { ensureAttached } from '../browser/snapshot/debugger-session';
import { evaluateInPage, getTabUrl, resolveTabId } from '../workato-ui/dom-helpers';
import type { WhoamiArgs } from './types';

const WHOAMI_PAGE_FN = `
(async () => {
  try {
    const res = await fetch('/web_api/auth_user.json', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'accept': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, stage: 'http', error: 'GET /web_api/auth_user.json failed: HTTP ' + res.status + ' ' + t.slice(0, 400) };
    }
    const json = await res.json().catch(() => null);
    const r = json && json.result;
    if (!r || r.authenticated === false) {
      return { ok: false, stage: 'auth', error: 'not authenticated to Workato in this tab' };
    }
    const slim = {
      user: {
        name: r.logged_name,
        email: r.logged_email,
        id: r.logged_user_id,
      },
      current_workspace: {
        id: r.current_team && r.current_team.id,
        name: r.current_team && r.current_team.name,
        role: r.current_team && r.current_team.group_name,
        roles: Array.isArray(r.roles) ? r.roles : [],
      },
      logged_workspace: r.logged_workspace_name,
      environment: {
        current: r.current_environment,
        available: Array.isArray(r.available_environments) ? r.available_environments.map(e => ({ id: e.id, name: e.name, type: e.type })) : [],
        all: Array.isArray(r.all_environments) ? r.all_environments.map(e => ({ id: e.id, name: e.name, type: e.type })) : [],
      },
      teams: Array.isArray(r.teams) ? r.teams.map(t => ({ id: t.id, name: t.name, role: t.group_name })) : [],
      project_count: r.count_of_projects,
      timezone: r.timezone,
      account_timezone: r.account_timezone,
      membership: r.membership && { name: r.membership.name, type: r.membership.type, period: r.membership.period },
      pricing_type: r.pricing_type,
      two_fa_enabled: r.twoFaEnabled,
      federation: r.federation,
      workspace_account_mode: r.workspace_account_mode,
      airo_enabled: r.airo_enabled,
      data_pills_version: r.data_pills_version,
      account_name: r.name,
      account_email: r.email,
      url: location.origin,
    };
    return { ok: true, info: slim };
  } catch (e) {
    return { ok: false, stage: 'exception', error: String(e && e.message || e) };
  }
})
`;

class WorkatoWhoamiImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO_SESSION.WHOAMI;

  async execute(args: WhoamiArgs): Promise<ToolResult> {
    console.log('[workato-session] whoami requested:', args);
    try {
      const tabId = await resolveTabId(args ?? {});
      await ensureAttached(tabId);

      const url = await getTabUrl(tabId);
      if (!/workato\.(com|is)/.test(url)) {
        return createErrorResponse(
          `workato_whoami: active tab is not a Workato page (url=${url}). ` +
            `Open a Workato tab and sign in first.`,
        );
      }

      const result = await evaluateInPage<{
        ok: boolean;
        stage?: string;
        error?: string;
        info?: unknown;
      }>(tabId, `(${WHOAMI_PAGE_FN})()`, { awaitPromise: true });

      if (!result?.ok) {
        return createErrorResponse(
          `workato_whoami: ${result?.error ?? 'unknown error'}` +
            (result?.stage ? ` (stage=${result.stage})` : ''),
        );
      }

      const info = result.info as Record<string, unknown>;
      const summary =
        `connected as ${(info.user as { name?: string })?.name ?? '?'} ` +
        `(${(info.user as { email?: string })?.email ?? '?'}) ` +
        `to workspace "${(info.current_workspace as { name?: string })?.name ?? '?'}" ` +
        `as ${(info.current_workspace as { role?: string })?.role ?? '?'}`;

      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n${JSON.stringify(info)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('[workato-session] whoami failed:', error);
      return createErrorResponse(
        `workato_whoami failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const WorkatoWhoamiTool = new WorkatoWhoamiImpl();
