/**
 * Tab leases: one tab per agent when several agents share an MCP session.
 *
 * Subagents of one client session reuse the same MCP session, so the session
 * pin (profile + tab) is shared by all of them and cannot tell them apart. The
 * only per-caller identity that survives is what the caller passes, so an agent
 * leases a tab (chrome_lease_tab), gets a token back and passes it on every
 * call. The bridge turns the token into the profile and tabId, and while any
 * lease is held it refuses tab-targeting calls that name no tab at all: under
 * parallel agents "the active tab" is always somebody else's.
 */

import { randomBytes } from 'crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

export const LEASE_TAB_TOOL = TOOL_NAMES.BROWSER.LEASE_TAB;
export const RELEASE_TAB_TOOL = TOOL_NAMES.BROWSER.RELEASE_TAB;
export const LEASE_ARG = 'lease';
/** A lease nobody used for this long is released and its tab closed. */
export const LEASE_IDLE_MS = 30 * 60 * 1000;
export const STRICT_TABS_ENV = 'WORKATOMCP_STRICT_TABS';

const LEASE_PROPERTY = {
  type: 'string',
  description:
    'Lease from chrome_lease_tab: routes this call to the leased tab (and its profile) without activating it. Use it instead of tabId when agents work in parallel.',
};

/** Tools that never target a tab, or that manage targeting themselves. */
const STRICT_EXEMPT = new Set<string>([
  TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
  LEASE_TAB_TOOL,
  RELEASE_TAB_TOOL,
  TOOL_NAMES.WORKATO.LIST_PROFILES,
  TOOL_NAMES.WORKATO.SWITCH_PROFILE,
  TOOL_NAMES.WORKATO.BRIDGE_INFO,
  TOOL_NAMES.WORKATO.RELOAD_EXTENSION,
]);

export interface TabLease {
  lease: string;
  profile: string;
  tabId: number;
  windowId: number | null;
  created_at: number;
  last_used: number;
  /**
   * Leased from an existing tab (adopt_tab_id) rather than opened by the
   * lease: it may be a tab the user works in, so the bridge never closes it
   * on expiry and release keeps it unless keep_tab:false is explicit.
   */
  adopted?: boolean;
}

const schemaProperties = new Map<string, Record<string, unknown>>();
for (const tool of TOOL_SCHEMAS) {
  const props = ((tool.inputSchema as any)?.properties ?? {}) as Record<string, unknown>;
  schemaProperties.set(tool.name, props);
}

/** The tool's schema has a tabId, so it targets a tab. */
export function toolTargetsTab(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(schemaProperties.get(name) ?? {}, 'tabId');
}

function toolHasBackground(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(schemaProperties.get(name) ?? {}, 'background');
}

/** Add an optional `lease` to every tool that takes a tabId. */
export function withLeaseToolSchemas(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    if (tool.name === LEASE_TAB_TOOL || tool.name === RELEASE_TAB_TOOL) return tool;
    const inputSchema = (tool.inputSchema || {}) as Record<string, any>;
    const properties = inputSchema.properties || {};
    if (!properties.tabId || properties[LEASE_ARG]) return tool;
    return {
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
        type: 'object' as const,
        properties: { ...properties, [LEASE_ARG]: LEASE_PROPERTY },
      },
    };
  });
}

export function newLeaseId(): string {
  return `L${randomBytes(4).toString('hex')}`;
}

/** Per-MCP-session lease table. */
export class LeaseTable {
  private leases = new Map<string, TabLease>();

  add(lease: TabLease): void {
    this.leases.set(lease.lease, lease);
  }

  get(id: string): TabLease | undefined {
    return this.leases.get(id);
  }

  /** The lease of this session that already holds `tabId` in `profile`, if any. */
  findByTab(profile: string, tabId: number): TabLease | undefined {
    for (const lease of this.leases.values()) {
      if (lease.profile === profile && lease.tabId === tabId) return lease;
    }
    return undefined;
  }

  delete(id: string): boolean {
    return this.leases.delete(id);
  }

  get size(): number {
    return this.leases.size;
  }

  /** Remove and return every lease idle for LEASE_IDLE_MS or longer. */
  takeExpired(now: number): TabLease[] {
    const expired: TabLease[] = [];
    for (const lease of this.leases.values()) {
      if (now - lease.last_used >= LEASE_IDLE_MS) expired.push(lease);
    }
    for (const lease of expired) this.leases.delete(lease.lease);
    return expired;
  }

  summary(now: number) {
    return [...this.leases.values()].map((l) => ({
      lease: l.lease,
      profile: l.profile,
      tabId: l.tabId,
      windowId: l.windowId,
      idle_ms: now - l.last_used,
      ...(l.adopted ? { adopted: true } : {}),
    }));
  }

  /** Every leased tab of this session in `profile`. */
  tabIdsIn(profile: string): Set<number> {
    const ids = new Set<number>();
    for (const lease of this.leases.values()) if (lease.profile === profile) ids.add(lease.tabId);
    return ids;
  }

  ids(): string[] {
    return [...this.leases.keys()];
  }
}

export type LeaseApplication =
  | { ok: true; args: Record<string, any>; lease: TabLease }
  | { ok: false; error: string };

/**
 * Turn `lease` in a call's args into its tabId (and background:true where the
 * tool has that switch). The profile check is the caller's: it knows the
 * explicit routing argument.
 */
export function applyLease(
  name: string,
  args: Record<string, any>,
  table: LeaseTable,
  now: number,
): LeaseApplication {
  const id = args[LEASE_ARG];
  if (typeof id !== 'string' || id.trim() === '') {
    return { ok: false, error: 'lease must be the string returned by chrome_lease_tab.' };
  }
  const lease = table.get(id.trim());
  if (!lease) {
    return {
      ok: false,
      error:
        `Unknown or expired lease "${id}". Leases of this session: ${JSON.stringify(table.ids())}. ` +
        'Take a new one with chrome_lease_tab.',
    };
  }
  if (typeof args.tabId === 'number' && args.tabId !== lease.tabId) {
    return {
      ok: false,
      error: `lease ${lease.lease} is tab ${lease.tabId}, but the call also passed tabId ${args.tabId}. Pass one of them.`,
    };
  }
  const { [LEASE_ARG]: _lease, ...rest } = args;
  const next: Record<string, any> = { ...rest, tabId: lease.tabId };
  if (toolHasBackground(name) && next.background === undefined) next.background = true;
  lease.last_used = now;
  return { ok: true, args: next, lease };
}

export function strictTabsFromEnv(): boolean {
  return process.env[STRICT_TABS_ENV] === '1';
}

/**
 * Refusal text when strict targeting applies and the call names no tab, else
 * null. `args` must be the caller's own arguments after the lease is applied
 * but BEFORE the session pin is injected: a pinned tab is shared by every
 * agent of the session, so it cannot satisfy strict mode.
 */
export function strictTabsViolation(
  name: string,
  args: Record<string, any>,
  strict: boolean,
): string | null {
  if (!strict || STRICT_EXEMPT.has(name) || !toolTargetsTab(name)) return null;
  if (typeof args.tabId === 'number') return null;
  return (
    'StrictTabs: pass lease (from chrome_lease_tab) or tabId; parallel agents must not act on ' +
    'the active tab. Nothing was sent.'
  );
}

export function leaseResult(body: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError };
}
