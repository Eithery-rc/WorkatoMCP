/**
 * `watch-wait`: block until chrome_watch_* events arrive, print them, exit.
 *
 * Meant to run as a background process of an agent: its exit is what wakes
 * the agent, so nothing is spent while the watched pages stay quiet. Survives
 * a bridge restart (an extension reload) by retrying the connection.
 */
import { NATIVE_SERVER_PORT } from '../constant';

// Under undici's 300 s headers timeout, which a held poll would otherwise hit.
const POLL_CHUNK_MS = 4 * 60 * 1000;
const RETRY_DELAY_MS = 3000;
const MAX_DOWN_MS = 3 * 60 * 1000;
const DEFAULT_TIMEOUT_SEC = 7000;

export interface WatchWaitOptions {
  ids: string[];
  cursor?: number;
  timeoutSec?: number;
  port?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rearmCommand(ids: string[], cursor: number, port: number): string {
  const cli = (process.argv[1] || 'cli.js').replace(/\\/g, '/');
  const idArg = ids.length > 0 ? ` --id ${ids.join(',')}` : '';
  const portArg = port === NATIVE_SERVER_PORT ? '' : ` --port ${port}`;
  return `node "${cli}" watch-wait${idArg} --cursor ${cursor}${portArg}`;
}

/** One line per event, without the fields every line would repeat. */
function formatEvent(event: Record<string, any>): string {
  const { seq: _seq, at, watch_id, name, profile, kind, ...rest } = event;
  const label = name ? `${watch_id} ${name}` : watch_id;
  const time = typeof at === 'string' ? new Date(at).toLocaleTimeString('en-GB') : '';
  return `[${time}] ${label} (${profile}) ${kind}: ${JSON.stringify(rest)}`;
}

export async function runWatchWait(options: WatchWaitOptions): Promise<number> {
  const port = options.port ?? NATIVE_SERVER_PORT;
  const ids = options.ids;
  let cursor = options.cursor;
  const deadline = Date.now() + (options.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  let downSince: number | null = null;

  while (Date.now() < deadline) {
    const chunk = Math.min(POLL_CHUNK_MS, deadline - Date.now());
    const query = new URLSearchParams({ timeoutMs: String(chunk) });
    if (ids.length > 0) query.set('ids', ids.join(','));
    if (cursor !== undefined) query.set('cursor', String(cursor));
    let body: any;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/watch/wait?${query}`, {
        signal: AbortSignal.timeout(chunk + 30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.json();
      downSince = null;
    } catch (err: any) {
      // The bridge restarts when the extension that owns it reloads: wait for it.
      downSince = downSince ?? Date.now();
      if (Date.now() - downSince > MAX_DOWN_MS) {
        console.log(
          `The bridge on port ${port} has not answered for ${Math.round(MAX_DOWN_MS / 60000)} ` +
            `minutes (${err?.message || String(err)}). Is Chrome open?`,
        );
        if (cursor !== undefined) console.log(`Re-arm: ${rearmCommand(ids, cursor, port)}`);
        return 3;
      }
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    const events: Record<string, any>[] = Array.isArray(body?.events) ? body.events : [];
    if (typeof body?.cursor === 'number') cursor = body.cursor;
    if (events.length > 0) {
      console.log(`${events.length} watch event(s), cursor ${cursor}:`);
      for (const event of events) console.log(formatEvent(event));
      const ended = events.some((e) => e.kind === 'ended');
      const stillWatching =
        ids.length === 0 ||
        ids.some((id) => !events.some((e) => e.watch_id === id && e.kind === 'ended'));
      if (!ended || stillWatching) console.log(`Re-arm: ${rearmCommand(ids, cursor!, port)}`);
      return 0;
    }
    if (body?.note) {
      console.log(`Nothing to wait for: ${body.note}.`);
      return 2;
    }
  }
  console.log(`No watch events in ${options.timeoutSec ?? DEFAULT_TIMEOUT_SEC} s.`);
  if (cursor !== undefined) console.log(`Re-arm: ${rearmCommand(ids, cursor, port)}`);
  return 0;
}
