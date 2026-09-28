import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { abs } from "../storage";
import { log } from "../log";

export type Mail = { to: string; subject: string; text: string; html: string };
export interface EmailProvider { send(m: Mail): Promise<void> }

/** In-memory outbox for tests. */
export const memoryOutbox: Mail[] = [];
const memory: EmailProvider = { async send(m) { memoryOutbox.push(m); } };

/** Dev: writes messages to storage/temp/mail so they are visible at /dev/mail. Never used in production. */
const devFile: EmailProvider = {
  async send(m) {
    const dir = abs("temp/mail");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify({ ...m, at: new Date().toISOString() }));
  },
};

const resend: EmailProvider = {
  async send(m) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config().RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config().EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
  },
};

export function provider(): EmailProvider {
  const p = config().EMAIL_PROVIDER;
  if (p === "resend") return resend;
  if (p === "memory") return memory;
  if (config().NODE_ENV === "production") throw new Error("dev email provider not allowed in production");
  return devFile;
}

async function send(m: Mail) {
  try { await provider().send(m); log.info("email.sent", { subject: m.subject }); }
  catch (e) { log.error("email.failed", { subject: m.subject, error: (e as Error).message }); throw e; }
}

const wrap = (body: string) => `<div style="font-family:Inter,system-ui,sans-serif;background:#F7F3EE;padding:32px"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;padding:32px;color:#24211F">${body}</div></div>`;

export function sendOtp(to: string, code: string) {
  return send({
    to, subject: `Seu código de acesso: ${code}`,
    text: `Seu código é ${code}. Ele vale por ${config().OTP_TTL_MINUTES} minutos.`,
    html: wrap(`<p style="color:#6F6964;margin:0 0 8px">Seu código de acesso</p><p style="font-size:36px;letter-spacing:8px;font-weight:600;margin:0 0 16px">${code}</p><p style="color:#6F6964">Vale por ${config().OTP_TTL_MINUTES} minutos. Se não foi você, ignore este e-mail.</p>`),
  });
}

export type DigestLine = { name: string; photos: number; videos: number; others: number; bytes: number };
export function sendNewMediaDigest(to: string, lines: DigestLine[], fmtBytes: (n: number) => string) {
  const desc = (l: DigestLine) => {
    const parts = [l.photos && `${l.photos} foto${l.photos > 1 ? "s" : ""}`, l.videos && `${l.videos} vídeo${l.videos > 1 ? "s" : ""}`, l.others && `${l.others} outro${l.others > 1 ? "s" : ""}`].filter(Boolean);
    return `${l.name} adicionou ${parts.join(", ")} (${fmtBytes(l.bytes)})`;
  };
  const url = config().APP_BASE_URL + "/photos";
  return send({
    to, subject: "Novas fotos no álbum",
    text: lines.map(desc).join("\n") + `\n\nAbrir: ${url}`,
    html: wrap(`<p style="font-size:18px;margin:0 0 16px">Tem novidade no álbum</p><ul style="padding-left:18px;color:#24211F">${lines.map((l) => `<li style="margin-bottom:6px">${escapeHtml(desc(l))}</li>`).join("")}</ul><p style="margin-top:24px"><a href="${url}" style="background:#B86F59;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">Abrir o álbum</a></p>`),
  });
}

export function sendAdminDailyReport(to: string, rows: [string, string][]) {
  return send({
    to, subject: `Relatório diário — ${new Date().toISOString().slice(0, 10)}`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    html: wrap(`<p style="font-size:18px;margin:0 0 16px">Relatório diário</p><table style="width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#6F6964;padding:4px 0">${escapeHtml(k)}</td><td style="text-align:right">${escapeHtml(v)}</td></tr>`).join("")}</table>`),
  });
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
