import { ensureBooted } from "../server/bootstrap";
import { claim, complete, enqueue, fail, type Job } from "../server/services/jobs";
import { finalizeUpload } from "../server/services/media";
import { processMedia } from "../server/services/processing";
import { buildPackage } from "../server/services/packages";
import { runCleanup, runDailyReport, runDigest } from "../server/services/notifications";
import { db } from "../server/db";
import { watchLogSettings } from "../server/services/logsettings";
import { installProcessHandlers, log as rootLog } from "../server/log";

const log = rootLog.child("worker");
installProcessHandlers("worker");

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 3);
let stopping = false;

async function execute(job: Job) {
  switch (job.type) {
    case "FINALIZE_UPLOAD": return finalizeUpload(job.payload.uploadId);
    case "MEDIA_PROCESS": return processMedia(job.payload.mediaId);
    case "PACKAGE_BUILD": return buildPackage(job.payload.packageId);
    case "DIGEST": return runDigest();
    case "DAILY_REPORT": return runDailyReport();
    case "CLEANUP": return runCleanup();
  }
}

async function loop(slot: number) {
  // slot 0 never takes package builds so uploads keep finalizing during long ZIP builds
  const types = slot === 0 ? (["FINALIZE_UPLOAD", "MEDIA_PROCESS", "DIGEST", "DAILY_REPORT", "CLEANUP"] as const) : null;
  while (!stopping) {
    let job: Job | null = null;
    try { job = await claim(types ? [...types] : null); } catch (e) { log.error("worker.claim_failed", { err: e }); }
    if (!job) { await sleep(1000); continue; }
    const t0 = Date.now();
    log.debug("job.start", { slot, job: job.id, type: job.type, attempt: job.attempts });
    try {
      const result = await execute(job);
      await complete(job.id);
      log.info("job.done", { job: job.id, type: job.type, ms: Date.now() - t0, result: typeof result === "string" ? result : undefined });
    } catch (e) {
      log.error("job.failed", { job: job.id, type: job.type, attempt: job.attempts, ms: Date.now() - t0, err: e });
      await fail(job, (e as Error).message).catch(() => {});
    }
  }
}

/** Periodic schedulers are just deduped jobs; safe with several worker processes. */
async function scheduler() {
  while (!stopping) {
    try {
      await enqueue("DIGEST", {}, { dedupeKey: "digest", delaySec: 60 });
      await enqueue("DAILY_REPORT", {}, { dedupeKey: "daily-report", delaySec: 300 });
      await enqueue("CLEANUP", {}, { dedupeKey: "cleanup", delaySec: 3600 });
      // recover finalize jobs lost to a crash between state change and enqueue
      const orphan = await db().query("SELECT id FROM uploads WHERE state IN ('VERIFYING','FINALIZING') AND updated_at < now() - interval '10 minutes'");
      for (const o of orphan.rows) await enqueue("FINALIZE_UPLOAD", { uploadId: o.id }, { dedupeKey: `finalize:${o.id}`, priority: 10 });
    } catch (e) { log.error("scheduler.failed", { err: e }); }
    await sleep(30_000);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await ensureBooted();
  watchLogSettings();
  log.info("worker.started", { concurrency: CONCURRENCY });
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  await Promise.all([scheduler(), ...Array.from({ length: CONCURRENCY }, (_, i) => loop(i))]);
  await db().end();
}

main().catch((e) => { log.fatal("worker.fatal", { err: e }); process.exit(1); });
