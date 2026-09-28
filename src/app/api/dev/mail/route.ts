import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/server/config";
import { abs } from "@/server/storage";
import { handle, notFound } from "@/server/http";
export const dynamic = "force-dynamic";
/** Dev-only outbox viewer. Disabled unless EMAIL_PROVIDER=dev and not production. */
export const GET = handle(async () => {
  if (config().EMAIL_PROVIDER !== "dev" || config().NODE_ENV === "production") throw notFound();
  const dir = abs("temp/mail");
  const files = (await fs.readdir(dir).catch(() => [] as string[])).sort().reverse().slice(0, 30);
  const mails = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8"))));
  return Response.json({ mails });
});
