# Layered checks after a fix

When a bug came from bad data, you have found where the data went wrong and fixed it there. One guard at that spot can seem like enough, but it is not. Another code path can reach the same operation without going through your guard. Next month's refactor can move the guard or delete it. A mock in a test can replace the function that held it. So put a check at every layer the data passes through. One guard means this instance of the bug is fixed; a check at each layer means the bug cannot happen again.

## Where to put the checks

1. **Follow the data.** Note where the bad value is created and every place it is used. If you have just traced the bug with [root-cause-tracing.md](root-cause-tracing.md), you already have this list.
2. **Map every checkpoint.** These are the functions, modules and process boundaries the value crosses on its way from the source to the operation that did the damage.
3. **Give each kind of layer its check**, using the table below.
4. **Prove that each layer works on its own.** Write a test that deliberately goes around the outer layer, for example by calling the inner function directly or by using a mock that skips the entry point. That test should show the next layer stopping the bad value.

| Layer | Its job | What it catches that the others miss |
|---|---|---|
| Entry point | Refuse input that is plainly invalid at the API boundary | Most bad calls, as early as possible |
| Business logic | Check that the value makes sense for this specific operation | Edge cases, and callers that bypass the entry point (internal calls, mocks) |
| Environment guard | Refuse an operation that is dangerous in the current context | Harm that only happens in certain contexts (a test run touching a developer's database, a staging job touching prod) |
| Debug instrumentation | Record the context just before the risky step | Whatever the other three layers still let through, with enough evidence to explain it afterwards |

## The four layers in code

The example: a nightly job deletes expired login sessions. One night it deleted every session and logged out all users. The deploy had dropped `SESSION_TTL_DAYS` from the config, the scheduler computed the cutoff as an Invalid Date, and the query builder silently left out a filter it could not serialize. The root-cause fix restored the config key and made the config loader fail on a missing key. The layers below stop the next bad cutoff, whatever produces it.

The data flow: config → `PurgeJob.run()` → `SessionService.purgeExpired(cutoff)` → `SessionRepo.deleteOlderThan(cutoff)` → `DELETE` statement.

**Entry point:** the job refuses a TTL that is not a positive whole number, and a cutoff that is not a real date in the past.

```typescript
class PurgeJob {
  run(now = new Date()) {
    const days = Number(config.get('SESSION_TTL_DAYS'));
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error(`PurgeJob: SESSION_TTL_DAYS must be a positive integer, got "${config.get('SESSION_TTL_DAYS')}"`);
    }
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    if (Number.isNaN(cutoff.getTime()) || cutoff >= now) throw new Error(`PurgeJob: bad cutoff ${cutoff}`);
    return this.sessions.purgeExpired(cutoff);
  }
}
```

**Business logic:** whoever calls it, the service will not purge sessions that could still be in use.

```typescript
const MIN_AGE_MS = 60 * 60 * 1000; // a session idle for less than an hour may still be in use

purgeExpired(cutoff: Date) {
  if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) {
    throw new Error('purgeExpired: cutoff must be a valid Date');
  }
  if (Date.now() - cutoff.getTime() < MIN_AGE_MS) {
    throw new Error(`purgeExpired: cutoff ${cutoff.toISOString()} would remove live sessions`);
  }
  return this.repo.deleteOlderThan(cutoff);
}
```

**Environment guard:** outside local development, the repository counts the rows first and refuses a delete that would remove most of the table.

```typescript
async deleteOlderThan(cutoff: Date) {
  if (process.env.NODE_ENV !== 'development') {
    const [doomed, total] = await Promise.all([this.countOlderThan(cutoff), this.countAll()]);
    if (total > 0 && doomed / total > 0.5) {
      throw new Error(`Refusing to delete ${doomed} of ${total} sessions in ${process.env.NODE_ENV}`);
    }
  }
  return this.db('sessions').where('last_seen', '<', cutoff).del();
}
```

**Debug instrumentation:** just before the delete, record where the cutoff came from.

```typescript
log.warn('session purge', {
  cutoff: cutoff.toISOString(),
  ttlSource: config.sourceOf('SESSION_TTL_DAYS'),
  env: process.env.NODE_ENV,
  stack: new Error().stack,
});
```

## Why one layer is never enough

While the layers were being added, each one caught a case the others missed:

- An admin command, `sessions:purge --days 0`, calls `SessionService` directly. It never runs `PurgeJob`, so the entry check never saw it. The business check refused the cutoff.
- A guest-session cleanup job talks to `SessionRepo` directly, and its unit tests replace the service with a stub. Only the environment guard stopped its oversized delete in staging.
- The read replica runs an older database driver that drops a filter it cannot serialize instead of throwing, so the delete there had no filter at all. Only the row-count guard caught it.
- The debug log showed that one region's deploy file spelled the key `SESSION_TTL_DAY`. That was structural misuse, which none of the checks would have explained.

All four layers were needed. Do not stop after the first check. Add one at every layer the data crosses. Once they were all in, every test passed and the mass logout could no longer be reproduced.
