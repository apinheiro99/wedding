import fs from "node:fs/promises";
import { db, schemaStatus } from "../db";
import { bootError, ensureBooted } from "../bootstrap";
import { abs, diskFree } from "../storage";

export async function readiness() {
  const checks: Record<string, { ok: boolean; detail?: unknown }> = {};
  try { await ensureBooted(); checks.bootstrap = { ok: true }; }
  catch { checks.bootstrap = { ok: false, detail: bootError() }; }
  try { await db().query("SELECT 1"); checks.database = { ok: true }; }
  catch (e) { checks.database = { ok: false, detail: (e as Error).message }; }
  try { const s = await schemaStatus(); checks.migrations = { ok: s.applied >= s.expected, detail: s }; }
  catch (e) { checks.migrations = { ok: false, detail: (e as Error).message }; }
  try { await fs.access(abs("originals"), fs.constants.W_OK); checks.storage = { ok: true, detail: await diskFree() }; }
  catch (e) { checks.storage = { ok: false, detail: (e as Error).message }; }
  return { ready: Object.values(checks).every((c) => c.ok), checks };
}
