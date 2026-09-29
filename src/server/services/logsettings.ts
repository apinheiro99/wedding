import { getSetting } from "./settings";
import { setLogRuntime } from "../log";

/** Lê nível/retenção de logs salvos no painel e aplica neste processo (web ou worker). */
export async function applyLogSettings() {
  const [level, retainDays] = await Promise.all([getSetting("log_level"), getSetting("log_retain_days")]);
  setLogRuntime({ level, retainDays });
}

/** Reaplica de tempos em tempos para que mudanças no painel cheguem ao outro processo. */
export function watchLogSettings(everyMs = 60_000) {
  const t = setInterval(() => { applyLogSettings().catch(() => {}); }, everyMs);
  t.unref();
  applyLogSettings().catch(() => {});
}
