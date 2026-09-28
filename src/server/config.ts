import { z } from "zod";
import path from "node:path";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  EVENT_TITLE: z.string().default("Nosso Casamento"),
  PG_HOST: z.string().min(1),
  PG_PORT: z.coerce.number().int().default(5432),
  PG_USER: z.string().min(1),
  PG_PASSWORD: z.string().min(1),
  PG_MAINTENANCE_DB: z.string().default("postgres"),
  PG_APP_DB: z.string().regex(/^[a-z_][a-z0-9_]*$/, "invalid database name"),
  PG_POOL_MAX: z.coerce.number().int().default(10),
  STORAGE_ROOT: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  FAMILY_BOOTSTRAP_LOGIN: z.string().min(1),
  FAMILY_BOOTSTRAP_PASSWORD: z.string().min(6),
  ADMIN_EMAIL: z.string().email().transform((s) => s.toLowerCase()),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12),
  EMAIL_PROVIDER: z.enum(["dev", "memory", "resend"]).default("dev"),
  EMAIL_FROM: z.string().default("Fotos <fotos@example.com>"),
  RESEND_API_KEY: z.string().optional(),
  PACKAGE_TARGET_BYTES: z.coerce.number().int().positive().default(2 * 1024 ** 3),
  UPLOAD_CHUNK_BYTES: z.coerce.number().int().positive().default(8 * 1024 ** 2),
  DIGEST_QUIET_MINUTES: z.coerce.number().positive().default(15),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  OTP_TTL_MINUTES: z.coerce.number().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  if (parsed.data.EMAIL_PROVIDER === "resend" && !parsed.data.RESEND_API_KEY) {
    throw new Error("Invalid configuration: RESEND_API_KEY required for resend provider");
  }
  return { ...parsed.data, STORAGE_ROOT: path.resolve(parsed.data.STORAGE_ROOT) };
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

export function setConfigForTests(c: Config) {
  cached = c;
}
