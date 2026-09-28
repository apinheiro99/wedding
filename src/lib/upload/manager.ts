"use client";
// Client transfer queue. It only orchestrates bytes and shows what the backend decides:
// dedupe/restore/finalize outcomes always come from the API.
import { api, ApiError } from "../api";
import * as store from "./store";

export type ItemState =
  | "HASH_WAIT" | "HASHING" | "CHECKING" | "QUEUED" | "UPLOADING" | "PAUSED" | "RETRY_WAIT" | "VERIFYING"
  | "COMPLETE" | "DUPLICATE" | "RESTORED" | "FAILED" | "CANCELLED" | "NEEDS_FILE";

export type Item = {
  key: string; name: string; relPath: string; size: number; type: string; lastModified: number; file: File | null;
  state: ItemState; sent: number; hashProgress: number; sha256: string | null; uploadId: string | null;
  reason: string | null; attempts: number; retryAt: number; addedAt: number;
};

export const TERMINAL: ItemState[] = ["COMPLETE", "DUPLICATE", "RESTORED", "FAILED", "CANCELLED"];
const CLIENT_HASH_MAX = 1024 ** 3; // larger files: server hashes (still deduped server-side)
const fingerprint = (f: { name: string; size: number; lastModified: number; relPath: string }) => `${f.relPath || f.name}|${f.size}|${f.lastModified}`;

export type Snapshot = {
  items: Item[]; paused: boolean; online: boolean;
  totals: { total: number; complete: number; duplicate: number; restored: number; failed: number; cancelled: number; pending: number; needsFile: number; bytesTotal: number; bytesDone: number };
  speed: number; eta: number | null; version: number;
};

export class UploadManager {
  items: Item[] = [];
  private byKey = new Map<string, Item>();
  private byUpload = new Map<string, Item>();
  paused = false;
  online = typeof navigator === "undefined" ? true : navigator.onLine;
  private concurrency: number;
  private active = new Map<string, AbortController>();
  private hashing = 0;
  private hashWorker: Worker | null = null;
  private listeners = new Set<(s: Snapshot) => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private samples: { t: number; b: number }[] = [];
  private speedHistory: number[] = [];
  private version = 0;
  private chunkSize = 8 * 1024 * 1024;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const mobile = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || /Mobi|Android|iPhone/i.test(navigator.userAgent));
    this.concurrency = mobile ? 4 : 6;
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => { this.online = true; this.retryWaitingNow(); this.pump(); this.emit(); });
      window.addEventListener("offline", () => { this.online = false; this.emit(); });
      this.pollTimer = setInterval(() => this.pollVerifying(), 5000);
    }
  }

  subscribe(fn: (s: Snapshot) => void) { this.listeners.add(fn); fn(this.snapshot()); return () => { this.listeners.delete(fn); }; }

  async restore() {
    const rows = await store.all().catch(() => []);
    for (const r of rows.sort((a, b) => a.addedAt - b.addedAt)) {
      if (this.byKey.has(r.key)) continue;
      const hasFile = !!r.file;
      let state = r.state as ItemState;
      if (!TERMINAL.includes(state) && state !== "VERIFYING") state = hasFile ? (r.sha256 || r.size > CLIENT_HASH_MAX ? "QUEUED" : "HASH_WAIT") : "NEEDS_FILE";
      const it: Item = { key: r.key, name: r.name, relPath: r.relPath, size: r.size, type: r.type, lastModified: r.lastModified, file: r.file ?? null,
        state, sent: 0, hashProgress: 0, sha256: r.sha256 ?? null, uploadId: r.uploadId ?? null, reason: r.reason ?? null, attempts: 0, retryAt: 0, addedAt: r.addedAt };
      if (TERMINAL.includes(state)) it.sent = it.size;
      this.add(it);
    }
    this.emit(); this.pump(); this.pollVerifying();
  }

  private add(it: Item) {
    this.items.push(it); this.byKey.set(it.key, it);
    if (it.uploadId) this.byUpload.set(it.uploadId, it);
  }

  /** Adds files incrementally in slices so 50k selections don't freeze the UI. */
  async addFiles(files: File[]) {
    const now = Date.now();
    const batch: Item[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
      if (f.name.startsWith(".") || f.name === "Thumbs.db" || f.name === "desktop.ini") continue; // OS junk inside folders
      const key = fingerprint({ name: f.name, size: f.size, lastModified: f.lastModified, relPath });
      const existing = this.byKey.get(key);
      if (existing) {
        // re-selected after a browser restart: reattach the file and resume from the server offset
        if (existing.state === "NEEDS_FILE" || existing.state === "FAILED" || existing.state === "CANCELLED") {
          existing.file = f; existing.state = existing.sha256 || f.size > CLIENT_HASH_MAX ? "QUEUED" : "HASH_WAIT"; existing.reason = null; existing.attempts = 0;
          this.touch(existing);
        }
        continue;
      }
      const it: Item = { key, name: f.name, relPath, size: f.size, type: f.type, lastModified: f.lastModified, file: f,
        state: f.size > CLIENT_HASH_MAX ? "QUEUED" : "HASH_WAIT", sent: 0, hashProgress: 0, sha256: null, uploadId: null,
        reason: null, attempts: 0, retryAt: 0, addedAt: now + i };
      this.add(it); batch.push(it); this.dirty.add(key);
      if (i % 2000 === 1999) { this.emit(); await new Promise((r) => setTimeout(r, 0)); }
    }
    this.schedulePersist(); this.emit(); this.pump();
  }

  pause() { this.paused = true; for (const [k, c] of this.active) { c.abort(); const it = this.byKey.get(k); if (it && it.state === "UPLOADING") { it.state = "PAUSED"; this.touch(it); } } this.emit(); }
  resume() { this.paused = false; for (const it of this.items) if (it.state === "PAUSED") { it.state = "QUEUED"; this.touch(it); } this.pump(); this.emit(); }
  pauseItem(key: string) { const it = this.byKey.get(key); if (!it) return; this.active.get(key)?.abort(); if (!TERMINAL.includes(it.state) && it.state !== "VERIFYING") { it.state = "PAUSED"; this.touch(it); this.emit(); this.pump(); } }
  resumeItem(key: string) { const it = this.byKey.get(key); if (it?.state === "PAUSED") { it.state = "QUEUED"; this.touch(it); this.emit(); this.pump(); } }
  retryFailed() {
    for (const it of this.items) if (it.state === "FAILED" && it.file) { it.state = it.sha256 || it.size > CLIENT_HASH_MAX ? "QUEUED" : "HASH_WAIT"; it.attempts = 0; it.reason = null; if (it.uploadId && it.reason === "SIZE_MISMATCH") it.uploadId = null; this.touch(it); }
    this.pump(); this.emit();
  }
  async cancelPending() {
    const toCancel = this.items.filter((it) => !TERMINAL.includes(it.state) && it.state !== "VERIFYING");
    for (const it of toCancel) {
      this.active.get(it.key)?.abort();
      if (it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: "DELETE" }).catch(() => {});
      it.state = "CANCELLED"; this.touch(it);
    }
    this.emit();
  }
  async clearFinished() {
    const keys = this.items.filter((it) => TERMINAL.includes(it.state)).map((it) => it.key);
    this.items = this.items.filter((it) => !TERMINAL.includes(it.state));
    for (const k of keys) { const it = this.byKey.get(k); this.byKey.delete(k); if (it?.uploadId) this.byUpload.delete(it.uploadId); }
    await store.removeMany(keys).catch(() => {});
    this.emit();
  }

  /** Backend-pushed upload state (SSE). */
  onServerUpload(uploadId: string, state: string, reason?: string | null) {
    const it = this.byUpload.get(uploadId);
    if (!it) return;
    if (["COMPLETE", "DUPLICATE", "RESTORED", "FAILED", "CANCELLED"].includes(state)) {
      it.state = state as ItemState; it.reason = reason ?? null; it.sent = it.size; this.touch(it); this.emit();
    }
  }

  private async pollVerifying() {
    const ids = this.items.filter((i) => i.state === "VERIFYING" && i.uploadId).map((i) => i.uploadId!).slice(0, 500);
    if (!ids.length || !this.online) return;
    try {
      const r = await api<{ uploads: { id: string; state: string; reason: string | null }[] }>("/api/uploads/status", { method: "POST", json: { ids } });
      for (const u of r.uploads) this.onServerUpload(u.id, u.state, u.reason);
    } catch { /* next tick */ }
  }

  private touch(it: Item) { this.dirty.add(it.key); this.schedulePersist(); }
  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null;
      const rows = [...this.dirty].map((k) => this.byKey.get(k)).filter(Boolean).map((it) => ({
        key: it!.key, name: it!.name, size: it!.size, type: it!.type, lastModified: it!.lastModified, relPath: it!.relPath,
        state: it!.state, uploadId: it!.uploadId, sha256: it!.sha256, reason: it!.reason, file: it!.file, addedAt: it!.addedAt,
      }));
      this.dirty.clear();
      await store.putMany(rows).catch(() => {});
    }, 800);
  }

  private retryWaitingNow() { for (const it of this.items) if (it.state === "RETRY_WAIT") it.retryAt = 0; }

  private pump() {
    if (typeof window === "undefined") return;
    // hashing lane (1 worker, sequential, cheap on memory)
    if (this.hashing === 0) {
      const next = this.items.find((i) => i.state === "HASH_WAIT" && i.file);
      if (next) void this.hash(next);
    }
    if (this.paused || !this.online) return;
    const now = Date.now();
    while (this.active.size < this.concurrency) {
      const next = this.items.find((i) => (i.state === "QUEUED" || (i.state === "RETRY_WAIT" && i.retryAt <= now)) && i.file && !this.active.has(i.key));
      if (!next) break;
      void this.upload(next);
    }
    const waiting = this.items.find((i) => i.state === "RETRY_WAIT");
    if (waiting) setTimeout(() => this.pump(), Math.max(500, waiting.retryAt - now));
  }

  private worker() {
    if (!this.hashWorker) this.hashWorker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    return this.hashWorker;
  }

  private hash(it: Item): Promise<void> {
    this.hashing++;
    it.state = "HASHING"; this.emit();
    return new Promise((resolve) => {
      const w = this.worker();
      const onMsg = async (e: MessageEvent) => {
        if (e.data.id !== it.key) return;
        if (e.data.progress != null) { it.hashProgress = e.data.progress; this.emit(); return; }
        w.removeEventListener("message", onMsg);
        this.hashing--;
        if (e.data.sha256) {
          it.sha256 = e.data.sha256; it.state = "CHECKING"; this.touch(it); this.emit();
          try {
            const r = await api<{ status: string }>("/api/uploads/check", { method: "POST", json: { sha256: it.sha256 } });
            if (r.status === "DUPLICATE_ACTIVE") { it.state = "DUPLICATE"; it.sent = it.size; }
            else if (r.status === "RESTORED") { it.state = "RESTORED"; it.sent = it.size; }
            else it.state = "QUEUED";
          } catch { it.state = "QUEUED"; } // server will dedupe on finalize anyway
        } else it.state = "QUEUED";
        this.touch(it); this.emit(); this.pump(); resolve();
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ id: it.key, file: it.file });
    });
  }

  private async upload(it: Item) {
    const ctrl = new AbortController();
    this.active.set(it.key, ctrl);
    it.state = "UPLOADING"; this.emit();
    try {
      if (!it.uploadId) {
        const c = await api<{ id: string; offset: number; chunkSize: number }>("/api/uploads", {
          method: "POST", json: { filename: it.name, size: it.size, mime: it.type || null, lastModified: it.lastModified, fingerprint: it.key, sha256: it.sha256 },
        });
        it.uploadId = c.id; it.sent = c.offset; this.chunkSize = c.chunkSize; this.byUpload.set(c.id, it); this.touch(it);
      } else {
        const s = await api<{ state: string; offset: number; reason: string | null }>(`/api/uploads/${it.uploadId}`);
        if (s.state !== "UPLOADING") { this.onServerUpload(it.uploadId, s.state, s.reason); if (s.state === "VERIFYING" || s.state === "FINALIZING") it.state = "VERIFYING"; return; }
        it.sent = s.offset;
      }
      while (it.sent < it.size) {
        if (ctrl.signal.aborted) return;
        const end = Math.min(it.size, it.sent + this.chunkSize);
        const res = await fetch(`/api/uploads/${it.uploadId}`, {
          method: "PATCH", body: it.file!.slice(it.sent, end), signal: ctrl.signal,
          headers: { "upload-offset": String(it.sent), "content-type": "application/offset+octet-stream", "tus-resumable": "1.0.0", "x-requested-with": "fetch" },
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 && typeof j.offset === "number") { it.sent = j.offset; continue; }
        if (res.status === 404) { it.uploadId = null; throw new Error("upload expired"); }
        if (!res.ok) throw new ApiError(res.status, j.error ?? "HTTP", j.message ?? `HTTP ${res.status}`);
        this.sample(end - it.sent);
        it.sent = j.offset; it.attempts = 0;
        this.emit();
      }
      if (it.size === 0 || it.sent >= it.size) { it.state = "VERIFYING"; this.touch(it); }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const permanent = e instanceof ApiError && [400, 401, 403, 413].includes(e.status);
      it.attempts++;
      if (permanent || it.attempts > 8) { it.state = "FAILED"; it.reason = e instanceof ApiError ? e.message : "Falha de rede"; }
      else { it.state = "RETRY_WAIT"; it.retryAt = Date.now() + Math.min(60_000, 1500 * 2 ** it.attempts); }
      this.touch(it);
    } finally {
      this.active.delete(it.key);
      this.emit(); this.pump();
    }
  }

  private sample(bytes: number) {
    const t = Date.now();
    this.samples.push({ t, b: bytes });
    while (this.samples.length && this.samples[0]!.t < t - 8000) this.samples.shift();
  }

  private emit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.version++; const s = this.snapshot(); for (const l of this.listeners) l(s); }, 120);
  }

  snapshot(): Snapshot {
    const t = { total: 0, complete: 0, duplicate: 0, restored: 0, failed: 0, cancelled: 0, pending: 0, needsFile: 0, bytesTotal: 0, bytesDone: 0 };
    for (const it of this.items) {
      t.total++;
      if (it.state === "COMPLETE") t.complete++;
      else if (it.state === "DUPLICATE") t.duplicate++;
      else if (it.state === "RESTORED") t.restored++;
      else if (it.state === "FAILED") t.failed++;
      else if (it.state === "CANCELLED") t.cancelled++;
      else if (it.state === "NEEDS_FILE") t.needsFile++;
      else t.pending++;
      if (it.state !== "CANCELLED") { t.bytesTotal += it.size; t.bytesDone += Math.min(it.sent, it.size); }
    }
    const now = Date.now();
    const win = this.samples.filter((s) => s.t > now - 8000);
    const speed = win.length ? win.reduce((a, s) => a + s.b, 0) / Math.max(1, (now - win[0]!.t) / 1000 + 0.5) : 0;
    this.speedHistory.push(speed); if (this.speedHistory.length > 20) this.speedHistory.shift();
    // only show ETA when speed is stable (coefficient of variation < 35%)
    const mean = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    const sd = Math.sqrt(this.speedHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / this.speedHistory.length);
    const stable = this.speedHistory.length >= 10 && mean > 0 && sd / mean < 0.35;
    const eta = stable && t.pending ? (t.bytesTotal - t.bytesDone) / mean : null;
    return { items: this.items, paused: this.paused, online: this.online, totals: t, speed, eta, version: this.version };
  }
}

let singleton: UploadManager | null = null;
/** One manager per tab, kept alive across page navigation so uploads continue while browsing. */
export function manager() {
  if (!singleton) { singleton = new UploadManager(); void singleton.restore(); }
  return singleton;
}
