import { useEffect } from "react";
import { useResults } from "../results/results";
import { canUpload, platformClient, usePlatformSettings } from "./settings";
import { uploadNow } from "./upload";

const DELAY_MS = 3000;

/** Uploads pending results when signed in, online and auto upload is on: at start, when online again and after new reports. */
export function useAutoUpload() {
  const settings = usePlatformSettings();
  const enabled = settings.autoUpload && canUpload(settings);
  const reports = useResults((s) => s.reports);
  const loaded = useResults((s) => s.loaded);

  useEffect(() => {
    if (!enabled || !loaded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        const s = usePlatformSettings.getState();
        if (!canUpload(s)) return;
        void uploadNow({ client: platformClient(s), orgId: s.orgId! }).then((summary) => {
          if (summary?.unauthorized) usePlatformSettings.getState().update({ token: "" });
        });
      }, DELAY_MS);
    };
    run();
    window.addEventListener("online", run);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", run);
    };
  }, [enabled, loaded, reports]);
}
