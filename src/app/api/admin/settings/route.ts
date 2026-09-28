import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { updateSettings } from "@/server/services/admin";
const Body = z.object({ notificationsEnabled: z.boolean().optional(), eventTitle: z.string().max(100).optional() });
export const PATCH = handle(async (req) => { await requireAdmin(); await updateSettings(await readJson(req, Body.parse)); return Response.json({ ok: true }); });
