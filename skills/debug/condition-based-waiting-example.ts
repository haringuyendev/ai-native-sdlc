// Condition-based waiting for a background job queue, as used in tests.
// Each helper polls the queue's live state every 10 ms and gives up with a
// descriptive error once its timeout runs out. No helper sleeps for a guessed duration.
// The interfaces below stand in for whatever queue your project actually has.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  result?: unknown;
}

export interface JobQueue {
  /** Returns a fresh snapshot of every job on each call. */
  list(): Job[];
}

const POLL_EVERY_MS = 10;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Shared core: calls `probe` until it returns something truthy, then resolves
 * with that value. If `timeoutMs` passes first, rejects with a message built
 * from `describe`. `describe` is called only at that point, so it can report
 * the latest state.
 */
function pollUntil<T>(
  probe: () => T | undefined | null | false,
  describe: () => string,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  return new Promise<T>((resolve, reject) => {
    const tick = () => {
      const hit = probe(); // re-read the queue on every pass; never cache it
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) {
        return reject(new Error(`Gave up after ${timeoutMs}ms waiting for ${describe()}`));
      }
      setTimeout(tick, POLL_EVERY_MS);
    };
    tick();
  });
}

/**
 * Resolves with the job once it reaches `status`.
 *
 *   const job = await waitForJobStatus(queue, 'job-42', 'done');
 */
export function waitForJobStatus(
  queue: JobQueue,
  jobId: string,
  status: JobStatus,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Job> {
  return pollUntil(
    () => queue.list().find((j) => j.id === jobId && j.status === status),
    () => {
      const now = queue.list().find((j) => j.id === jobId);
      return `${jobId} to be ${status} (currently ${now ? now.status : 'absent'})`;
    },
    timeoutMs,
  );
}

/**
 * Resolves with the jobs of `kind` once at least `count` of them are `done`.
 *
 *   // a batch import fans out into three thumbnail jobs
 *   await waitForDoneCount(queue, 'thumbnail', 3);
 */
export function waitForDoneCount(
  queue: JobQueue,
  kind: string,
  count: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Job[]> {
  const finished = () => queue.list().filter((j) => j.kind === kind && j.status === 'done');
  return pollUntil(
    () => {
      const jobs = finished();
      return jobs.length >= count ? jobs : undefined;
    },
    () => `${count} finished ${kind} jobs (have ${finished().length})`,
    timeoutMs,
  );
}

/**
 * Resolves with the first job that satisfies `match`. Use it when the job's
 * kind or status alone does not identify the job, for example when the result
 * payload matters.
 *
 *   await waitForJobMatching(
 *     queue,
 *     (j) => j.kind === 'invoice' && (j.result as { total?: number })?.total === 120,
 *     'invoice job with total 120',
 *   );
 */
export function waitForJobMatching(
  queue: JobQueue,
  match: (job: Job) => boolean,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Job> {
  return pollUntil(() => queue.list().find(match), () => label, timeoutMs);
}

// How a flaky test changes with these helpers.
//
// Flaky version, guessing at durations:
//   await importer.importBatch(['a.png', 'b.png', 'c.png']);
//   await new Promise((r) => setTimeout(r, 400));   // "thumbnails are usually done by now"
//   importer.cancelPending();
//   await new Promise((r) => setTimeout(r, 100));   // "cancellation settles quickly"
//   expect(gallery.thumbnails()).toHaveLength(3);   // red whenever CI is busy
//
// Reliable version, waiting on observable state:
//   await importer.importBatch(['a.png', 'b.png', 'c.png']);
//   await waitForDoneCount(queue, 'thumbnail', 3);  // returns the moment the third job finishes
//   importer.cancelPending();
//   await waitForJobMatching(queue, (j) => j.kind === 'cleanup' && j.status === 'done', 'cleanup after cancel');
//   expect(gallery.thumbnails()).toHaveLength(3);   // passes under any load
//
// The reliable version is also faster, because no step waits longer than its condition takes.
