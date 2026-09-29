import { ensureBooted } from "../bootstrap";
import { getSetting } from "./settings";
import { config } from "../config";
import { heroVersions } from "./branding";

export async function publicInfo() {
  await ensureBooted();
  return {
    eventTitle: (await getSetting("event_title")) ?? config().EVENT_TITLE,
    motto: "Nosso dia, por todos os olhares.",
    subtitle: "Envie suas fotos e veja as lembranças que cada pessoa guardou desse dia.",
    heroes: await heroVersions(),
  };
}
