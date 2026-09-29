import fs from "node:fs";
import path from "node:path";
import { requestContext } from "./context";

/**
 * Logger estruturado para depuração.
 *
 * Níveis (do mais verboso ao mais grave): trace < debug < info < warn < error < fatal
 *   LOG_LEVEL   nível mínimo. Padrão: debug em development, info em production, warn em test.
 *   LOG_FORMAT  "pretty" (colorido, uma linha legível) ou "json". Padrão: pretty em dev, json em prod.
 *   LOG_DIR     pasta dos arquivos diários app-YYYY-MM-DD.log (tudo) e error-YYYY-MM-DD.log (warn+).
 *               Padrão: ./logs (fora de test). LOG_DIR= (vazio) desliga o arquivo. Falha ao gravar
 *               nunca derruba o app.
 *   LOG_RETAIN_DAYS  dias de arquivos mantidos (padrão 7). Rotação diária (novo arquivo à meia-noite UTC).
 *
 * Nível e retenção também podem ser alterados em tempo real pelo painel (Configurações → Logs):
 * o valor fica na tabela settings e é aplicado por setLogRuntime() em web e worker.
 *   LOG_DEBUG   lista de escopos separados por vírgula que ignoram LOG_LEVEL e logam em debug
 *               (ex.: LOG_DEBUG=upload,worker) — liga o detalhe só onde está o problema.
 *
 * Nunca passe códigos OTP, senhas ou tokens: chaves sensíveis são mascaradas, mas não confie só nisso.
 */

export const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
export type Level = keyof typeof LEVELS;
type Data = Record<string, unknown>;

const env = () => process.env;
const isTest = () => env().NODE_ENV === "test";
const isProd = () => env().NODE_ENV === "production";

/** Sobrescritas vindas do painel; têm prioridade sobre as variáveis de ambiente. */
const runtime: { level?: Level; retainDays?: number } = {};
export function setLogRuntime(r: { level?: string | null; retainDays?: number | null }) {
  runtime.level = r.level && r.level in LEVELS ? (r.level as Level) : undefined;
  runtime.retainDays = r.retainDays && r.retainDays > 0 ? Math.floor(r.retainDays) : undefined;
  lastDay = ""; // força nova poda com a retenção atual
}
export const logRuntime = () => ({ level: runtime.level ?? null, retainDays: runtime.retainDays ?? null });

function minLevel(): number {
  const l = (runtime.level ?? env().LOG_LEVEL?.toLowerCase()) as Level | undefined;
  if (l && l in LEVELS) return LEVELS[l];
  return isTest() ? LEVELS.warn : isProd() ? LEVELS.info : LEVELS.debug;
}
const debugScopes = () => new Set((env().LOG_DEBUG ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const pretty = () => (env().LOG_FORMAT ? env().LOG_FORMAT === "pretty" : !isProd());

const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|otp|api[_-]?key|hash$/i;
const MAX_STR = 2000;

function redact(v: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (v instanceof Error) return serializeError(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…(+${v.length - MAX_STR})` : v;
  if (!v || typeof v !== "object") return v;
  if (seen.has(v)) return "[circular]";
  if (depth > 5) return "[depth]";
  seen.add(v);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1, seen));
  const out: Data = {};
  for (const [k, val] of Object.entries(v as Data)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(val, depth + 1, seen);
  return out;
}

export function serializeError(e: unknown): Data {
  if (!(e instanceof Error)) return { message: String(e) };
  const out: Data = { name: e.name, message: e.message, stack: e.stack };
  const x = e as Error & { code?: unknown; cause?: unknown; detail?: unknown; constraint?: unknown; status?: unknown };
  for (const k of ["code", "detail", "constraint", "status"] as const) if (x[k] !== undefined) out[k] = x[k];
  if (x.cause !== undefined) out.cause = serializeError(x.cause);
  return out;
}

// ---- arquivos -------------------------------------------------------------
const streams = new Map<string, fs.WriteStream>();
let lastDay = "";
let fileBroken = false;

function today() { return new Date().toISOString().slice(0, 10); }

function stream(name: string, dir: string): fs.WriteStream {
  const file = path.join(dir, name);
  let s = streams.get(file);
  if (!s) {
    s = fs.createWriteStream(file, { flags: "a" });
    s.on("error", () => { fileBroken = true; });
    streams.set(file, s);
  }
  return s;
}

function prune(dir: string) {
  const keep = runtime.retainDays ?? (Number(env().LOG_RETAIN_DAYS) || 7);
  const limit = Date.now() - keep * 86_400_000;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^(app|error)-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
    }
  } catch { /* melhor esforço */ }
}

function logDir(): string | null {
  if (env().LOG_DIR !== undefined) return env().LOG_DIR || null;
  return isTest() ? null : path.join(process.cwd(), "logs");
}

function toFile(level: number, line: string) {
  const dir = logDir();
  if (!dir || fileBroken) return;
  try {
    const day = today();
    if (day !== lastDay) {
      fs.mkdirSync(dir, { recursive: true });
      for (const s of streams.values()) s.end();
      streams.clear();
      lastDay = day;
      prune(dir);
    }
    stream(`app-${day}.log`, dir).write(line + "\n");
    if (level >= LEVELS.warn) stream(`error-${day}.log`, dir).write(line + "\n");
  } catch { fileBroken = true; }
}

// ---- saída ------------------------------------------------------------------
const COLOR: Record<Level, string> = { trace: "\x1b[90m", debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m", fatal: "\x1b[1;41m" };
const DIM = "\x1b[2m", RESET = "\x1b[0m";

function fmtPretty(level: Level, t: string, scope: string | undefined, msg: string, data: Data) {
  const { stack, err, ...rest } = data as Data & { stack?: unknown; err?: Data };
  const kv = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
  const head = `${DIM}${t.slice(11, 23)}${RESET} ${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET}${scope ? ` ${DIM}[${scope}]${RESET}` : ""} ${msg}`;
  const trace = err?.stack ?? stack;
  const errLine = err ? ` ${COLOR.error}${String(err.name ?? "Error")}: ${String(err.message ?? "")}${RESET}` : "";
  return `${head}${errLine}${kv ? ` ${DIM}${kv}${RESET}` : ""}${trace ? `\n${DIM}${String(trace)}${RESET}` : ""}`;
}

function emit(level: Level, scope: string | undefined, ctx: Data, msg: string, data?: Data) {
  const num = LEVELS[level];
  if (num < minLevel() && !(scope && num >= LEVELS.debug && debugScopes().has(scope))) return;
  const t = new Date().toISOString();
  const rc = requestContext();
  const who = rc ? { rid: rc.rid, ip: rc.ip, ua: rc.ua, uid: rc.uid, user: rc.user, role: rc.role } : {};
  const payload = redact({ ...who, ...ctx, ...data }) as Data;
  const record = { t, level, ...(scope ? { scope } : {}), msg, ...payload };
  const json = JSON.stringify(record);
  toFile(num, json);
  const line = pretty() ? fmtPretty(level, t, scope, msg, payload) : json;
  if (num >= LEVELS.warn) console.error(line);
  else console.log(line);
}

export interface Logger {
  trace(m: string, d?: Data): void;
  debug(m: string, d?: Data): void;
  info(m: string, d?: Data): void;
  warn(m: string, d?: Data): void;
  error(m: string, d?: Data): void;
  fatal(m: string, d?: Data): void;
  /** Novo logger com escopo e/ou contexto fixo (ex.: rid, userId) anexado a toda linha. */
  child(scope: string, ctx?: Data): Logger;
  /** Mede um trecho: loga "<msg>" com ms no fim (debug) ou como warn/error se falhar. */
  time<T>(msg: string, fn: () => Promise<T>, d?: Data): Promise<T>;
}

function make(scope: string | undefined, ctx: Data): Logger {
  const at = (level: Level) => (m: string, d?: Data) => emit(level, scope, ctx, m, d);
  const self: Logger = {
    trace: at("trace"), debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), fatal: at("fatal"),
    child: (s, c) => make(scope ? `${scope}.${s}` : s, { ...ctx, ...c }),
    async time(msg, fn, d) {
      const t0 = Date.now();
      try {
        const r = await fn();
        emit("debug", scope, ctx, msg, { ...d, ms: Date.now() - t0 });
        return r;
      } catch (e) {
        emit("error", scope, ctx, `${msg}.failed`, { ...d, ms: Date.now() - t0, err: e });
        throw e;
      }
    },
  };
  return self;
}

export const log: Logger = make(undefined, {});

let hooked = false;
/** Registra handlers globais para que erros não capturados apareçam no log com stack. */
export function installProcessHandlers(scope = "process") {
  if (hooked) return;
  hooked = true;
  const l = log.child(scope);
  process.on("uncaughtException", (e) => { l.fatal("uncaught_exception", { err: e }); });
  process.on("unhandledRejection", (e) => { l.error("unhandled_rejection", { err: e }); });
}
