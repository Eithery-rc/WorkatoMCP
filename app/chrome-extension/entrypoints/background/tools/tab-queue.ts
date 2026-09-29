/**
 * Tail of the queue of calls per tab. Parallel agents each work in their own
 * tab; two calls on the SAME tab (a navigate during a snapshot, two input
 * sequences) would interleave at every await, so they run one at a time.
 * Different tabs, and calls that name no tab, stay parallel.
 */
const tabQueues = new Map<number, Promise<unknown>>();

/**
 * Longest a call may hold its tab before the next queued call starts anyway.
 * A call stuck on a page that never answers must not make the tab unusable
 * for every later call (the bridge gives up at 120 s, the extension task may
 * never settle). The stuck call keeps running and still answers its own caller.
 */
export const TAB_QUEUE_MAX_HOLD_MS = 60_000;

export function runExclusiveForTab<T>(
  tabId: number,
  task: () => Promise<T>,
  maxHoldMs: number = TAB_QUEUE_MAX_HOLD_MS,
): Promise<T> {
  const previous = tabQueues.get(tabId) ?? Promise.resolve();
  // A failed call must not poison the calls queued behind it.
  const run = previous.catch(() => undefined).then(task);
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const released = new Promise<void>((resolve) => {
    // Armed when the task actually starts, so waiting in line does not count.
    previous
      .catch(() => undefined)
      .then(() => {
        holdTimer = setTimeout(() => {
          console.warn(
            `[tab-queue] a call held tab ${tabId} for over ${maxHoldMs} ms; letting the next call run`,
          );
          resolve();
        }, maxHoldMs);
      });
  });
  const tail = Promise.race([run.catch(() => undefined), released]).finally(() => {
    if (holdTimer) clearTimeout(holdTimer);
  });
  tabQueues.set(tabId, tail);
  tail.then(() => {
    if (tabQueues.get(tabId) === tail) tabQueues.delete(tabId);
  });
  return run;
}

/** Tabs with calls queued or running (for tests and diagnostics). */
export function busyTabs(): number[] {
  return Array.from(tabQueues.keys());
}
