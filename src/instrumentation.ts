export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureBooted } = await import("./server/bootstrap");
    await ensureBooted().catch(() => {
      /* surfaced by /ready */
    });
  }
}
