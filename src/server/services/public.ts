import { ensureBooted } from "../bootstrap";
import { getSetting } from "./settings";
import { config } from "../config";

export async function publicInfo() {
  await ensureBooted();
  return {
    eventTitle: (await getSetting("event_title")) ?? config().EVENT_TITLE,
    motto: "As fotos de todo mundo, em um só lugar.",
    subtitle: "Envie as suas. Baixe as de todo mundo. Sem perder o original.",
  };
}
