/**
 * Browser functions: the run log.
 *
 * One JSON line per run phase (preview, pause, commit, full run) in
 * `<state dir>/fn-runs/YYYY-MM.jsonl`, outside the registry's git: runs are
 * noise for a diff, and the params of a send are the email itself. A line
 * records who ran what and how it ended, never the param values: they are
 * reduced to a hash. A small state file keeps the last success per function,
 * which is what decides whether a function is still a draft.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHmac, randomBytes } from 'crypto';
import { updateStateDir } from '../update-checker';
import { readEnv } from '../env';

export const FN_STATE_DIR_ENV = 'MOKUTAB_FN_STATE_DIR';
const STATE_FILE = 'fn-state.json';
const KEY_FILE = 'fn-hash.key';

export function defaultRunsDir(): string {
  const override = readEnv(FN_STATE_DIR_ENV);
  return override ? path.resolve(override.trim()) : path.join(updateStateDir(), 'fn-runs');
}

/**
 * commit_start is written right before a commit step runs and superseded by
 * the phase's final line; on its own it means the bridge stopped mid-commit.
 */
export type FnRunPhase = 'preview' | 'paused' | 'commit' | 'full' | 'commit_start';
export type FnRunStatus = 'ok' | 'preview' | 'paused' | 'failed' | 'unknown';

export interface FnRunRecord {
  ts: string;
  run_id: string;
  fn: string;
  version: number;
  kind: string;
  phase: FnRunPhase;
  status: FnRunStatus;
  /** Whether a commit step ran in this phase. */
  committed: boolean;
  caller?: string;
  profile?: string;
  params_hash: string;
  dedupe?: string;
  failed_step?: string;
  /** The function's own check stopped it before any commit (bad input caught, not a fault). */
  refused?: boolean;
  /** Vault item ids the run read; ids, never values. */
  vault_items?: string[];
  ms: number;
}

export interface FnState {
  last_run_at?: string;
  last_status?: FnRunStatus;
  /** Last run that finished ok, any phase (a preview counts). */
  last_ok_at?: string;
  last_ok_version?: number;
  /** Last run that committed and finished ok: the write itself is proven. */
  last_commit_ok_at?: string;
  last_commit_ok_version?: number;
  runs: number;
  failures: number;
}

function monthFile(dir: string, date: Date): string {
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(dir, `${month}.jsonl`);
}

export class FnRunsLog {
  private key: Buffer | null = null;

  constructor(readonly dir: string = defaultRunsDir()) {}

  /**
   * A keyed hash of the params: the same params give the same hash on this
   * machine, but a short value (a case id) cannot be recovered from it.
   */
  hashParams(text: string): string {
    if (!this.key) {
      const file = path.join(this.dir, KEY_FILE);
      try {
        this.key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
      } catch {
        fs.mkdirSync(this.dir, { recursive: true });
        const fresh = randomBytes(32);
        try {
          fs.writeFileSync(file, fresh.toString('hex'), { flag: 'wx' });
          this.key = fresh;
        } catch {
          // Another process wrote it first.
          this.key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
        }
      }
    }
    return createHmac('sha256', this.key).update(text).digest('hex').slice(0, 16);
  }

  /**
   * Append a line, then update the state file. A failed state update (a
   * Windows rename racing a reader) is reported, not thrown: the line that
   * dedupe reads is already on disk.
   */
  append(record: FnRunRecord): string | null {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(monthFile(this.dir, new Date(record.ts)), `${JSON.stringify(record)}\n`);
    if (record.phase === 'commit_start') return null;
    try {
      this.updateState(record);
      return null;
    } catch (err: any) {
      return `the run state file was not updated: ${err?.message || String(err)}`;
    }
  }

  /** Records of this month and the previous one, newest first. */
  recent(filter: { fn?: string; limit?: number; since?: number } = {}): FnRunRecord[] {
    const now = new Date();
    const files = [
      monthFile(this.dir, now),
      monthFile(this.dir, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
    ];
    const out: FnRunRecord[] = [];
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as FnRunRecord;
          if (filter.fn && record.fn !== filter.fn) continue;
          if (filter.since !== undefined && Date.parse(record.ts) < filter.since) continue;
          out.push(record);
        } catch {
          // A torn line from a crash: skip it.
        }
      }
    }
    out.sort((a, b) => b.ts.localeCompare(a.ts));
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  /**
   * A commit of the same function with the same dedupe key that succeeded, or
   * whose outcome is unknown, since `since`: sending again could duplicate it.
   */
  findDuplicate(fn: string, dedupe: string, since: number): FnRunRecord | null {
    // A commit_start line (status unknown) counts on its own: once a commit
    // has started, every final outcome (ok or unknown) blocks a repeat anyway,
    // and without a final line the bridge died mid-commit.
    return (
      this.recent({ fn, since }).find(
        (r) => r.dedupe === dedupe && r.committed && (r.status === 'ok' || r.status === 'unknown'),
      ) ?? null
    );
  }

  state(): Record<string, FnState> {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, STATE_FILE), 'utf8'));
    } catch {
      return {};
    }
  }

  private updateState(record: FnRunRecord): void {
    const all = this.state();
    const prev: FnState = all[record.fn] ?? { runs: 0, failures: 0 };
    const next: FnState = {
      ...prev,
      last_run_at: record.ts,
      last_status: record.status,
      runs: prev.runs + 1,
      failures:
        prev.failures +
        ((record.status === 'failed' && !record.refused) || record.status === 'unknown' ? 1 : 0),
    };
    if (record.status === 'ok' || record.status === 'preview' || record.status === 'paused') {
      next.last_ok_at = record.ts;
      next.last_ok_version = record.version;
    }
    if (record.status === 'ok' && record.committed) {
      next.last_commit_ok_at = record.ts;
      next.last_commit_ok_version = record.version;
    }
    all[record.fn] = next;
    const file = path.join(this.dir, STATE_FILE);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, file);
  }
}
