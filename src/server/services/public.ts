import { ensureBooted } from "../bootstrap";
import { getSetting } from "./settings";
import { config } from "../config";
import { heroVersions } from "./branding";

export async function publicInfo() {
  await ensureBooted();
  return {
    eventTitle: (await getSetting("event_title")) ?? config().EVENT_TITLE,
    motto: "Um dia, muitos olhares.",
    subtitle: "Envie suas fotos e reviva com a gente as lembranças desse dia.",
    heroes: await heroVersions(),
  };
}
