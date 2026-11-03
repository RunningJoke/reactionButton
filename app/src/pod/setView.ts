/** What the "This set" page derives from the status: health of a pod and when "Find" works. */
import { LOW_BATTERY_PERCENT } from "./battery";
import type { BatteryLevel } from "./protocol";

export type PodHealth = "online" | "low" | "offline";

/** A pod that does not answer is offline; an unknown battery (missing) is never "low". */
export function podHealth(alive: boolean, battery?: BatteryLevel): PodHealth {
  if (!alive) return "offline";
  return battery !== undefined && battery.percent < LOW_BATTERY_PERCENT ? "low" : "online";
}

/** `blink` works only before the game starts (config-api.md §5: MENU / DISCOVERY / CONFIRM). */
export function canFind(state: string | undefined): boolean {
  return state === undefined || state === "MENU" || state === "DISCOVERY" || state === "CONFIRM";
}
