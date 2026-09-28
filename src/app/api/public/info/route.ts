import { publicInfo } from "@/server/services/public";
import { handle } from "@/server/http";
export const dynamic = "force-dynamic";
export const GET = handle(async () => Response.json(await publicInfo()));
