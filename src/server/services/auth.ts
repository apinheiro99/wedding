import { setContextUser } from "../context";
import { cookies } from "next/headers";
import { config } from "../config";
import { db, tx, type Queryable } from "../db";
import { hmac, otpCode, randomToken, sha256Hex, verifyPassword, hashPassword, safeEqual } from "../crypto";
import { evaluateOtp, isValidEmail, normalizeEmail } from "../domain/otp";
import { HttpError, badRequest, forbidden, unauthorized } from "../http";
import { sendOtp } from "../email";
import { getSetting, setSetting } from "./settings";
import { userFolderName } from "../storage";
import { log } from "../log";

export const USER_COOKIE = "wp_sid";
export const ADMIN_COOKIE = "wp_asid";
export const ONBOARD_COOKIE = "wp_og";

export type SessionUser = { id: string; email: string; displayName: string; role: "USER" | "ADMIN"; sessionKind: "USER" | "ADMIN" };

const otpHash = (email: string, code: string) => hmac(config().SESSION_SECRET, `otp:${normalizeEmail(email)}:${code}`);

function cookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: maxAgeSec,
    secure: config().NODE_ENV === "production",
  };
}

// ---------- family gate ----------

export async function checkFamilyCredential(login: string, password: string): Promise<string> {
  const expectedLogin = (await getSetting("family_login")) ?? "";
  const hash = await getSetting("family_password_hash");
  const loginOk = safeEqual(login.trim().toLowerCase(), expectedLogin);
  const passOk = hash ? await verifyPassword(hash, password) : false;
  if (!loginOk || !passOk) {
    log.warn("auth.family_failed", { attemptedLogin: login.trim().slice(0, 60), loginMatched: loginOk });
    throw new HttpError(401, "INVALID_FAMILY_CREDENTIAL", "Usuário ou senha da família incorretos.");
  }
  log.info("auth.family_ok");
  const token = randomToken();
  await db().query("INSERT INTO onboarding_grants (token_hash, expires_at) VALUES ($1, now() + interval '30 minutes')", [sha256Hex(token)]);
  return token;
}

export async function hasOnboardingGrant(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const r = await db().query("SELECT 1 FROM onboarding_grants WHERE token_hash = $1 AND expires_at > now()", [sha256Hex(token)]);
  return r.rowCount === 1;
}

export async function setFamilyCredential(login: string, password: string) {
  log.info("admin.family_credential_changed", { login: login.trim().toLowerCase() });
  if (password.length < 6) throw badRequest("A senha precisa ter ao menos 6 caracteres.");
  await setSetting("family_login", login.trim().toLowerCase());
  await setSetting("family_password_hash", await hashPassword(password));
}

// ---------- OTP ----------

/** Creates a new challenge, superseding any open one for the same e-mail. Returns the code (caller must not log it). */
export async function createOtp(email: string, purpose: "SIGNUP" | "LOGIN", displayName: string | null, q: Queryable = db()) {
  const code = otpCode();
  await q.query(
    "UPDATE otp_challenges SET superseded_at = now() WHERE lower(email) = $1 AND consumed_at IS NULL AND superseded_at IS NULL",
    [email],
  );
  await q.query(
    `INSERT INTO otp_challenges (email, purpose, code_hash, display_name, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [email, purpose, otpHash(email, code), displayName, config().OTP_TTL_MINUTES],
  );
  return code;
}

export async function startSignup(rawEmail: string, rawName: string) {
  const email = normalizeEmail(rawEmail);
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!isValidEmail(email)) throw badRequest("E-mail inválido.");
  if (name.length < 1 || name.length > 60) throw badRequest("Informe um nome de até 60 caracteres.");
  const exists = await db().query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
  if (exists.rowCount) throw new HttpError(409, "EMAIL_EXISTS", "Este e-mail já tem acesso. Use “Já tenho acesso”.");
  const code = await createOtp(email, "SIGNUP", name);
  await sendOtp(email, code);
  log.info("auth.otp_sent", { email, purpose: "SIGNUP", name });
}

export async function startLogin(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw badRequest("E-mail inválido.");
  const r = await db().query("SELECT status FROM users WHERE lower(email) = $1", [email]);
  if (!r.rowCount) {
    log.warn("auth.login_unknown_email", { email });
    throw new HttpError(404, "EMAIL_NOT_FOUND", "Não encontramos este e-mail. É seu primeiro acesso?");
  }
  if (r.rows[0].status !== "ACTIVE") throw forbidden("Acesso desativado. Fale com o administrador.");
  const code = await createOtp(email, "LOGIN", null);
  await sendOtp(email, code);
  log.info("auth.otp_sent", { email, purpose: "LOGIN" });
}

/** Verifies the latest open challenge. On success returns the (possibly newly created) user id. */
export async function verifyOtp(rawEmail: string, code: string): Promise<string> {
  const email = normalizeEmail(rawEmail);
  return tx(async (c) => {
    const r = await c.query(
      `SELECT * FROM otp_challenges WHERE lower(email) = $1 AND superseded_at IS NULL
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email],
    );
    const ch = r.rows[0];
    if (!ch) throw new HttpError(400, "OTP_EXPIRED", "Código expirado. Peça um novo.");
    const matches = /^\d{6}$/.test(code) && safeEqual(ch.code_hash, otpHash(email, code));
    const d = evaluateOtp(
      { attempts: ch.attempts, expiresAt: ch.expires_at, consumedAt: ch.consumed_at, supersededAt: ch.superseded_at },
      matches, new Date(), config().OTP_MAX_ATTEMPTS,
    );
    if (d === "WRONG") {
      await c.query("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1", [ch.id]);
      const left = config().OTP_MAX_ATTEMPTS - ch.attempts - 1;
      // commit the attempt increment, then report
      throw Object.assign(new HttpError(400, "OTP_WRONG", left > 0 ? `Código incorreto. ${left} tentativa(s) restante(s).` : "Código incorreto. Peça um novo código."), { commit: true });
    }
    if (d === "EXPIRED" || d === "USED") throw new HttpError(400, "OTP_EXPIRED", "Código expirado. Peça um novo.");
    if (d === "TOO_MANY_ATTEMPTS") throw new HttpError(400, "OTP_LOCKED", "Muitas tentativas. Peça um novo código.");
    await c.query("UPDATE otp_challenges SET consumed_at = now() WHERE id = $1", [ch.id]);

    if (ch.purpose === "SIGNUP") {
      const ins = await c.query(
        `WITH nid AS (SELECT gen_random_uuid() AS id)
         INSERT INTO users (id, email, display_name, email_verified_at, folder_name)
         SELECT id, $1, $2, now(), $3 || '__' || left(id::text, 8) FROM nid
         ON CONFLICT DO NOTHING RETURNING id`,
        [email, ch.display_name, userFolderName(ch.display_name, "x").replace(/__x$/, "")],
      );
      if (ins.rowCount) {
        await c.query("INSERT INTO audit_events (type, user_id) VALUES ('USER_CREATED', $1)", [ins.rows[0].id]);
        log.info("auth.signup", { email, userId: ins.rows[0].id, name: ch.display_name });
        return ins.rows[0].id as string;
      }
    }
    const u = await c.query("SELECT id, status FROM users WHERE lower(email) = $1", [email]);
    if (!u.rowCount || u.rows[0].status !== "ACTIVE") throw forbidden("Acesso desativado.");
    await c.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [u.rows[0].id]);
    return u.rows[0].id as string;
  }).catch(async (e) => {
    // wrong-code attempts must persist even though the transaction rolled back
    if (e?.commit) await db().query(
      `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = (
         SELECT id FROM otp_challenges WHERE lower(email) = $1 AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1)`,
      [email]);
    throw e;
  });
}

// ---------- sessions ----------

export async function createSession(userId: string, kind: "USER" | "ADMIN", userAgent: string | null, q: Queryable = db()) {
  log.info("auth.session_created", { userId, kind });
  const token = randomToken();
  const ttlDays = kind === "ADMIN" ? 1 : config().SESSION_TTL_DAYS;
  await q.query(
    `INSERT INTO sessions (token_hash, user_id, kind, expires_at, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5)`,
    [sha256Hex(token), userId, kind, ttlDays, userAgent?.slice(0, 200) ?? null],
  );
  return { token, maxAge: ttlDays * 86400 };
}

export async function sessionFromToken(token: string | undefined, kind: "USER" | "ADMIN"): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await db().query(
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.email, u.display_name, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.kind = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256Hex(token), kind],
  );
  const row = r.rows[0];
  if (!row || row.status !== "ACTIVE") return null;
  if (kind === "ADMIN" && row.role !== "ADMIN") return null;
  // sliding renewal at most once per hour
  if (Date.now() - new Date(row.last_seen_at).getTime() > 3600_000) {
    const days = kind === "ADMIN" ? 1 : config().SESSION_TTL_DAYS;
    await db().query("UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1", [row.sid, days]);
  }
  const su: SessionUser = { id: row.id, email: row.email, displayName: row.display_name, role: row.role, sessionKind: kind };
  setContextUser(su);
  return su;
}

export async function revokeSession(token: string | undefined) {
  log.info("auth.logout");
  if (token) await db().query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [sha256Hex(token)]);
}

/** Current user: personal session, or an admin session (admin may use the site as a user). */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return (await sessionFromToken(jar.get(USER_COOKIE)?.value, "USER")) ?? (await sessionFromToken(jar.get(ADMIN_COOKIE)?.value, "ADMIN"));
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return u;
}

/** Participante comum (sessão USER). O admin vê tudo, mas não envia fotos nem tem conta pessoal. */
export async function requireMember(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role === "ADMIN") throw forbidden("O administrador não envia fotos nem tem conta pessoal.");
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const jar = await cookies();
  const u = await sessionFromToken(jar.get(ADMIN_COOKIE)?.value, "ADMIN");
  if (!u) throw unauthorized("Login administrativo necessário.");
  return u;
}

export async function setSessionCookie(kind: "USER" | "ADMIN", token: string, maxAge: number) {
  (await cookies()).set(kind === "ADMIN" ? ADMIN_COOKIE : USER_COOKIE, token, cookieOpts(maxAge));
}
export async function setOnboardingCookie(token: string) {
  (await cookies()).set(ONBOARD_COOKIE, token, cookieOpts(1800));
}
export async function clearCookie(name: string) {
  (await cookies()).delete(name);
}

export async function adminLogin(rawEmail: string, password: string) {
  const email = normalizeEmail(rawEmail);
  const r = await db().query("SELECT id, password_hash FROM users WHERE lower(email) = $1 AND role = 'ADMIN' AND status = 'ACTIVE'", [email]);
  const ok = r.rows[0]?.password_hash ? await verifyPassword(r.rows[0].password_hash, password) : false;
  if (!ok) {
    log.warn("admin.login_failed", { email, knownAdmin: !!r.rowCount });
    throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
  }
  log.info("admin.login", { email, userId: r.rows[0].id });
  return r.rows[0].id as string;
}

export async function renameUser(userId: string, rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw badRequest("Informe um nome de até 60 caracteres.");
  await db().query("UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1", [userId, name]);
}
