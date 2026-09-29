/**
 * Tail of the queue of calls per tab. Parallel agents each work in their own
 * tab; two calls on the SAME tab (a navigate during a snapshot, two input
 * sequences) would interleave at every await, so they run one at a time.
 * Different tabs, and calls that name no tab, stay parallel.
 */
const tabQueues = new Map<number, Promise<unknown>>();

export function runExclusiveForTab<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const previous = tabQueues.get(tabId) ?? Promise.resolve();
  // A failed call must not poison the calls queued behind it.
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
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
