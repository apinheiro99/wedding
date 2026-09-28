/// <reference lib="webworker" />
import { createSHA256 } from "hash-wasm";

// Incremental SHA-256 in chunks: bounded memory, UI thread stays free.
self.onmessage = async (e: MessageEvent<{ id: string; file: File }>) => {
  const { id, file } = e.data;
  try {
    const h = await createSHA256();
    h.init();
    const CH = 8 * 1024 * 1024;
    for (let off = 0; off < file.size; off += CH) {
      const buf = new Uint8Array(await file.slice(off, off + CH).arrayBuffer());
      h.update(buf);
      (self as unknown as Worker).postMessage({ id, progress: Math.min(1, (off + CH) / file.size) });
    }
    (self as unknown as Worker).postMessage({ id, sha256: h.digest("hex") });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
