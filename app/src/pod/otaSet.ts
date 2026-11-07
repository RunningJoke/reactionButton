/**
 * Updating the whole set (#133): the central hands the image to the peripherals (op `otaDistribute`, #130) and
 * activates everything together (#131). The two firmware issues leave some names open; every assumption of the
 * app is in this file, so it can be aligned with config-api.md when the firmware docs land:
 *  - feature `otaDistribute` in `info.features` (the central can distribute; missing = update the central only)
 *  - `status.ota.pods[].state`: queued | transferring | ready | current (runs the image already) | failed |
 *    offline | refused (e.g. low battery). Only queued / transferring still move on their own.
 *  - the image stays in `status.ota.state` "ready" while it is distributed; `status.ota.pods` is present from
 *    `otaDistribute` until the activation or `otaAbort`
 *  - `otaActivate` answers `not_ready` while an expected pod is not ready; the app reads which from `status.ota.pods`
 *    (the list in the error is not needed); `{"force":true}` activates the ready pods only
 *  - after the reboot `status.pods[].firmware` is the version a pod runs ("" or missing until it has rejoined)
 */
import { compareVersions } from "./firmwareUpdate";
import type { InfoResponse, OtaPodStatus, StatusResponse } from "./protocol";

export const OTA_DISTRIBUTE_FEATURE = "otaDistribute";
/** Pods that need nothing more from the distribution. */
const DONE_STATES = ["ready", "current"];
/** Pods that still move on their own: the others wait for the user (or for the pod to power on). */
const MOVING_STATES = ["queued", "transferring"];
export const DISTRIBUTE_POLL_MS = 1000;
/** After the activation the pods rejoin by the normal claim; this long the app waits for all of them. */
export const REJOIN_WAIT_MS = 45_000;

/** The update covers the pods: the central can distribute and has pods. */
export function isSetUpdate(info: InfoResponse, status: StatusResponse): boolean {
  return status.role === "central" && !!info.features?.includes(OTA_DISTRIBUTE_FEATURE) && (status.pods?.length ?? 0) > 0;
}

export type Distribution = { allReady: boolean; stuck: boolean; ready: number };

/** `allReady`: nothing left to wait for; `stuck`: no pod is moving and some are not ready (the user decides). */
export function summarize(pods: OtaPodStatus[]): Distribution {
  const ready = pods.filter((p) => p.state === "ready").length;
  const open = pods.filter((p) => !DONE_STATES.includes(p.state));
  return {
    allReady: pods.length > 0 && open.length === 0,
    stuck: open.length > 0 && !pods.some((p) => MOVING_STATES.includes(p.state)),
    ready,
  };
}

/** What a pod runs after the reboot: the new version, the old one (rolled back or not updated), or not back. */
export type PodResult = { id: number; firmware: string; result: "updated" | "old" | "missing" };

export function podResults(status: StatusResponse, target: string): PodResult[] {
  return (status.pods ?? []).map((p) => {
    const firmware = p.firmware ?? "";
    const result = !p.alive || !firmware ? "missing" : compareVersions(firmware, target) === 0 ? "updated" : "old";
    return { id: p.id, firmware, result };
  });
}
