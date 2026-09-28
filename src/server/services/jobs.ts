import os from "node:os";
import { db, type Queryable } from "../db";

export type JobType =
  | "FINALIZE_UPLOAD" | "MEDIA_PROCESS" | "PACKAGE_BUILD" | "DIGEST" | "DAILY_REPORT" | "CLEANUP";

export type Job = { id: number; type: JobType; payload: any; attempts: number; max_attempts: number };

/**
 * Enqueue a job. With a dedupeKey, at most one PENDING job exists per key; a repeated
 * enqueue just pushes its available_at (debounce).
 */
export async function enqueue(type: JobType, payload: object, opts: { dedupeKey?: string; delaySec?: number; priority?: number } = {}, q: Queryable = db()) {
  await q.query(
    `INSERT INTO jobs (type, payload, dedupe_key, priority, available_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
     ON CONFLICT (dedupe_key) WHERE state = 'PENDING' AND dedupe_key IS NOT NULL
     DO UPDATE SET available_at = GREATEST(jobs.available_at, EXCLUDED.available_at)`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.priority ?? 100, opts.delaySec ?? 0],
  );
}

export const workerId = () => `${os.hostname()}:${process.pid}`;

/** Transactional claim with FOR UPDATE SKIP LOCKED. Also recovers jobs stuck RUNNING > 30 min. */
export async function claim(types: JobType[] | null, q: Queryable = db()): Promise<Job | null> {
  await q.query(
    `UPDATE jobs SET state = 'PENDING', locked_at = NULL, locked_by = NULL, last_error = 'lease expired'
     WHERE state = 'RUNNING' AND locked_at < now() - interval '30 minutes'`,
  );
  const r = await q.query(
    `UPDATE jobs SET state = 'RUNNING', locked_at = now(), locked_by = $2, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs WHERE state = 'PENDING' AND available_at <= now()
         AND ($1::text[] IS NULL OR type = ANY($1))
       ORDER BY priority, available_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, type, payload, attempts, max_attempts`,
    [types, workerId()],
  );
  return r.rows[0] ?? null;
}

export async function complete(id: number, q: Queryable = db()) {
  await q.query("UPDATE jobs SET state = 'DONE', completed_at = now(), locked_at = NULL WHERE id = $1", [id]);
}

/** Retry with exponential backoff until max_attempts, then FAILED. */
export async function fail(job: Job, err: string, q: Queryable = db()) {
  const final = job.attempts >= job.max_attempts;
  await q.query(
    `UPDATE jobs SET state = $2, last_error = $3, locked_at = NULL, locked_by = NULL,
       available_at = now() + make_interval(secs => $4), completed_at = CASE WHEN $2 = 'FAILED' THEN now() END
     WHERE id = $1`,
    [job.id, final ? "FAILED" : "PENDING", err.slice(0, 2000), Math.min(3600, 5 * 4 ** job.attempts)],
  ).catch(async (e) => {
    // a PENDING duplicate with the same dedupe key already exists: this one is redundant
    if (e.code === "23505") await q.query("UPDATE jobs SET state = 'DONE', completed_at = now(), last_error = $2 WHERE id = $1", [job.id, err]);
    else throw e;
  });
}

export async function retryJob(id: number) {
  await db().query(
    "UPDATE jobs SET state = 'PENDING', attempts = 0, available_at = now(), last_error = NULL WHERE id = $1 AND state = 'FAILED'",
    [id],
  ).catch((e) => { if (e.code !== "23505") throw e; });
}
