import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const FAMILY_LOGIN = process.env.E2E_FAMILY_LOGIN ?? "familia";
const FAMILY_PASSWORD = process.env.E2E_FAMILY_PASSWORD!;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const H = { "x-requested-with": "fetch" };

const seen = new Set<string>();
async function latestCode(req: APIRequestContext, email: string) {
  for (let i = 0; i < 30; i++) {
    const r = await (await req.get("/api/dev/mail")).json();
    const m = r.mails.find((x: { to: string; subject: string }) => x.to === email);
    const code = m?.subject.match(/\d{6}/)?.[0];
    if (code && !seen.has(code)) { for (const x of r.mails) { const c = x.subject.match(/\d{6}/)?.[0]; if (c) seen.add(c); } return code as string; }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no OTP mail");
}

async function typeCode(page: Page, code: string) {
  await page.getByLabel("Dígito 1").fill(code);
}

function tmpFile(name: string, bytes = crypto.randomBytes(3000)) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-")), name);
  fs.writeFileSync(p, bytes);
  return p;
}

const email = `e2e-${Date.now()}@example.com`;
const name = `Teste E2E ${Date.now() % 10000}`;

test.describe.serial("critical flows", () => {
  test("1. first access → OTP → in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Primeiro acesso" }).click();
    await page.getByLabel("Usuário da família").fill(FAMILY_LOGIN);
    await page.getByLabel("Senha da família").fill(FAMILY_PASSWORD);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByLabel("Seu nome").fill(name);
    await page.getByLabel("Seu e-mail pessoal").fill(email);
    await page.getByRole("button", { name: "Enviar código" }).click();
    await expect(page.getByText("Confira seu e-mail")).toBeVisible();
    await typeCode(page, await latestCode(page.request, email));
    await expect(page).toHaveURL(/\/photos/);
  });

  test("2. returning user → OTP → in; 10. rename", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Seu e-mail").fill(email);
    await page.getByRole("button", { name: "Enviar código" }).click();
    await typeCode(page, await latestCode(page.request, email));
    await expect(page).toHaveURL(/\/photos/);
    await page.goto("/account");
    await page.getByLabel("Nome de exibição").fill(name + " R");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("✓ Salvo")).toBeVisible();
    expect((await (await page.request.get("/api/me")).json()).displayName).toBe(name + " R");
  });

  test("3-8. upload, duplicate, soft delete, restore, download, package", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/login");
    await page.getByLabel("Seu e-mail").fill(email);
    await page.getByRole("button", { name: "Enviar código" }).click();
    await typeCode(page, await latestCode(page.request, email));
    await page.waitForURL(/\/photos/);

    const bytes = crypto.randomBytes(5000);
    const f1 = tmpFile("e2e-a.bin", bytes);
    await page.goto("/upload");
    await page.locator('input[type=file]').first().setInputFiles(f1);
    await expect(page.getByText("Concluído", { exact: true })).toBeVisible({ timeout: 30_000 });

    // duplicate (same bytes, different name)
    await page.locator('input[type=file]').first().setInputFiles(tmpFile("e2e-b.bin", bytes));
    await expect(page.getByText("Duplicado — já está no álbum")).toBeVisible({ timeout: 30_000 });

    // find media id via API, individual download
    const me = await (await page.request.get("/api/me")).json();
    const list = await (await page.request.get(`/api/media?uploader=${me.id}`)).json();
    const id = list.items[0].id as string;
    const dl = await page.request.get(`/api/media/${id}/original`);
    expect(dl.status()).toBe(200);
    expect(Buffer.from(await dl.body()).equals(bytes)).toBe(true);

    // soft delete
    expect((await page.request.delete(`/api/media/${id}`, { headers: H })).status()).toBe(200);
    expect((await page.request.get(`/api/media/${id}`)).status()).toBe(404);

    // restore by re-upload
    await page.goto("/upload");
    await page.locator('input[type=file]').first().setInputFiles(tmpFile("e2e-c.bin", bytes));
    await expect(page.getByText("Restaurado — já existia no servidor")).toBeVisible({ timeout: 30_000 });
    expect((await page.request.get(`/api/media/${id}`)).status()).toBe(200);

    // package becomes available (worker debounce ~45s)
    await expect.poll(async () => {
      const r = await (await page.request.get("/api/packages")).json();
      return r.uploaders.find((u: { userId: string }) => u.userId === me.id)?.packages.some((p: { available: boolean }) => p.available) ?? false;
    }, { timeout: 80_000, intervals: [3000] }).toBe(true);
    await page.goto("/downloads");
    await expect(page.getByRole("link", { name: /Baixar 01/ }).first()).toBeVisible();
    // cleanup: test artifacts must not stay visible in the family album
    expect((await page.request.delete(`/api/media/${id}`, { headers: H })).status()).toBe(200);
  });

  test("9. admin sees soft-deleted media", async ({ page }) => {
    const login = await page.request.post("/api/admin/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, headers: H });
    expect(login.status(), await login.text()).toBe(200);
    const r = await (await page.request.get("/api/admin/media?filter=deleted")).json();
    expect(Array.isArray(r.items)).toBe(true);
    await page.goto("/admin/media");
    await expect(page.getByRole("button", { name: "Excluídas" })).toBeVisible({ timeout: 30_000 });
  });

  test("download requires auth", async ({ request }) => {
    expect((await request.get("/api/media")).status()).toBe(401);
    expect((await request.get("/api/packages")).status()).toBe(401);
  });
});
