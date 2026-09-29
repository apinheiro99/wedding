export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installProcessHandlers, log } = await import("./server/log");
    installProcessHandlers("web");
    log.info("web.starting", { node: process.version, env: process.env.NODE_ENV, logLevel: process.env.LOG_LEVEL ?? "default", logDir: process.env.LOG_DIR ?? "./logs" });
    const { watchLogSettings } = await import("./server/services/logsettings");
    const { ensureBooted } = await import("./server/bootstrap");
    await ensureBooted().catch(() => {
      /* surfaced by /ready */
    });
    watchLogSettings();
  }
}
