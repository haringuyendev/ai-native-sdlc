# Waiting on conditions instead of clocks

A test that sleeps for a fixed time is guessing how long the system needs. The guess holds on your laptop. It fails on a loaded CI runner, or when the suite runs in parallel, and that is how a flaky test is born: a race between the sleep and the work. Wait for the thing you actually need to be true, and stop waiting as soon as it is.

## Is this the right tool?

Look at what the test is waiting for, and pick a row:

| What the test waits for | What to do |
|---|---|
| Async work to finish: a job, a message, a file, a state change | Poll for that condition, with a timeout |
| Time itself, because the behavior under test is timed (a debounce window, a throttle interval, a retry back-off) | A fixed delay is fine. Explain the duration in a comment |

Signs that you are in the first row: `setTimeout`, `sleep` or `time.sleep()` calls whose numbers someone tuned by hand. Tests that pass on their own but fail under load. Tests that time out only when the suite runs in parallel. Any wait that exists so that "the async part finishes".

A fixed delay without a comment explaining it is never acceptable, even in the second row.

## The swap

```typescript
// Flaky: hopes the export finishes within 200 ms
await exporter.start(reportId);
await new Promise((r) => setTimeout(r, 200));
expect(storage.has(`${reportId}.csv`)).toBe(true);

// Reliable: returns as soon as the file exists, and fails with a clear message if it never appears
await exporter.start(reportId);
await waitFor(() => storage.has(`${reportId}.csv`), `export ${reportId}.csv to be written`);
expect(storage.has(`${reportId}.csv`)).toBe(true);
```

## A general poller

```typescript
async function waitFor<T>(
  probe: () => T | null | undefined | false,
  what: string,
  timeoutMs = 5000,
  everyMs = 10,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();          // read fresh state on every pass
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`Gave up waiting for ${what} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
```

Most waits fit one of these shapes:

| You need | Probe |
|---|---|
| An event to arrive | `() => bus.history.find((e) => e.name === 'export.done')` |
| A state to be reached | `() => conn.status === 'open'` |
| Enough items | `() => inbox.messages.length >= 3` |
| A file on disk | `() => existsSync(lockPath)` |
| Several things at once | `() => cache.warm && cache.size > 100` |

For helpers built around one domain (wait for a job to reach a status, wait for N jobs to finish, wait for a job matching a predicate), see [condition-based-waiting-example.ts](condition-based-waiting-example.ts).

## Getting the poller right

- **Poll interval.** Use about 10 ms. Polling every 1 ms burns CPU and gains you nothing.
- **Timeout.** Always set one, and make the error say what was being waited for. A loop with no timeout hangs the run when the condition never comes true.
- **Fresh state.** Read the state inside the probe, on every pass. If you copy the state into a variable before the loop, the loop keeps checking that stale copy and never sees the change.

## When a fixed delay is the right call

Sometimes the timing is exactly what the test checks. Say a search box debounces keystrokes for `SEARCH_DEBOUNCE_MS` (300 ms) and the test must prove that a burst of typing sends a single request, not one per key:

```typescript
search.type('desk lamp');
await waitFor(() => search.hasPendingQuery, 'keystrokes to arm the debounce timer'); // 1. the trigger first
await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS));                          // 2. then the timed behavior
// The debounce timer was armed before this one, with the same duration, so it has fired by now.
expect(api.searchCalls).toEqual(['desk lamp']);
```

A fixed delay like this is acceptable only when all three of these hold:

1. You first wait for the condition that starts the timed behavior.
2. The length of the delay comes from a known interval in the code, not from trial and error.
3. A comment next to the delay explains why it is there.

Converting the sleeps in a flaky suite this way usually makes it both reliable and faster: each wait ends as soon as its condition holds, instead of always sitting through the worst-case delay.
