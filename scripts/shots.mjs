// Dev helper: screenshots of main pages (desktop + mobile) logged in as admin.
import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3000";
const out = process.env.OUT ?? "/tmp";
const pages = (process.env.PAGES ?? "/,/photos,/upload,/downloads,/account,/admin").split(",");
const browser = await chromium.launch();
for (const [label, vp] of [["desk", { width: 1440, height: 900 }], ["mob", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.request.post(base + "/api/admin/auth/login", { data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, headers: { "x-requested-with": "fetch" } });
  for (const path of pages) {
    await p.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(Number(process.env.WAIT ?? 1200));
    await p.screenshot({ path: `${out}/${label}${path.replace(/\//g, "_") || "_root"}.png`, fullPage: process.env.FULL === "1" });
  }
  await ctx.close();
}
await browser.close();
