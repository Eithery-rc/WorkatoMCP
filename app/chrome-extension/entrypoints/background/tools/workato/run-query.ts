import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

type QueryType = 'soql' | 'suiteql' | 'sql';

interface RunQueryArgs {
  connection_id: number;
  query: string;
  type: QueryType;
  schema_only?: boolean;
  full?: boolean;
}

interface SchemaField {
  name?: string;
  label?: string;
  type?: string;
  control_type?: string;
  [k: string]: unknown;
}

interface RawSchemaResponse {
  result?: {
    schema?: SchemaField[];
    sample?: Array<Record<string, unknown>>;
  };
  error?: string;
}

interface InPageResult {
  ok: boolean;
  raw?: RawSchemaResponse;
  failure?: {
    stage: 'http' | 'connector' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Plain function returning a Promise
 * chain — DO NOT add async/await (see v1 pitfalls reference). All constants
 * the function references must be inside its body to survive Function.prototype
 * .toString() serialisation.
 */
function runQueryInPage(query: string, type: string, connectionId: number): Promise<InPageResult> {
  // Strip trailing LIMIT clause from SOQL only. Workato auto-appends LIMIT 100;
  // a user-supplied LIMIT would collide → "LIMIT N LIMIT 100" → Salesforce 422.
  let finalQuery = query;
  if (type === 'soql') {
    finalQuery = query.replace(/\s+LIMIT\s+\d+\s*$/i, '');
  }

  // CSRF: decode XSRF-TOKEN-V2 cookie value into the x-csrf-token header value.
  const rawCookie =
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('XSRF-TOKEN-V2='))
      ?.split('=')
      .slice(1)
      .join('=') ?? '';
  const csrf = decodeURIComponent(rawCookie);

  const url = '/utils/sample_to_schema.json';
  const fetchOpts: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sample: finalQuery,
      type,
      shared_account_id: connectionId,
    }),
  };

  return fetch(url, fetchOpts).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'http' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `POST ${url} returned HTTP ${r.status}`,
          },
        };
      }
      let json: RawSchemaResponse = {};
      try {
        json = JSON.parse(bodyText) as RawSchemaResponse;
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      if (json.error) {
        return {
          ok: false,
          failure: {
            stage: 'connector' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: String(json.error),
          },
        };
      }
      if (
        !json.result ||
        !Array.isArray(json.result.schema) ||
        !Array.isArray(json.result.sample)
      ) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: 'Unexpected response shape — missing result.schema or result.sample.',
          },
        };
      }
      return { ok: true, raw: json };
    }),
  );
}

class WorkatoRunQueryTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.RUN_QUERY;

  async execute(args: RunQueryArgs): Promise<ToolResult> {
    try {
      if (typeof args?.connection_id !== 'number' || !Number.isFinite(args.connection_id)) {
        return createErrorResponse('Param [connection_id] must be a finite number');
      }
      if (typeof args?.query !== 'string' || args.query.trim() === '') {
        return createErrorResponse('Param [query] must be a non-empty string');
      }
      if (args?.type !== 'soql' && args?.type !== 'suiteql' && args?.type !== 'sql') {
        return createErrorResponse("Param [type] must be one of 'soql', 'suiteql', 'sql'");
      }
      const schemaOnly = args?.schema_only === true;
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, runQueryInPage, [
        args.query,
        args.type,
        args.connection_id,
      ]);

      if (!result.ok) {
        const f = result.failure!;
        let prefix: string;
        if (f.stage === 'http') prefix = 'WorkatoApiError (http)';
        else if (f.stage === 'connector') prefix = 'WorkatoConnectorError';
        else prefix = 'WorkatoApiError (shape)';
        return createErrorResponse(
          `${prefix}: ${f.message}` +
            (f.body_excerpt && f.stage !== 'connector'
              ? `\n--- body excerpt ---\n${f.body_excerpt}`
              : ''),
        );
      }

      const raw = result.raw!.result!;
      const schema = (raw.schema ?? []).map((f) => ({
        name: String(f.name ?? ''),
        label: String(f.label ?? ''),
        type: String(f.type ?? ''),
        control_type: String(f.control_type ?? ''),
      }));
      const rows = raw.sample ?? [];

      const payload = full
        ? raw
        : {
            type: args.type,
            count: rows.length,
            truncated_to_100: rows.length >= 100,
            schema,
            ...(schemaOnly ? {} : { rows }),
          };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_run_query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoRunQueryTool = new WorkatoRunQueryTool();
