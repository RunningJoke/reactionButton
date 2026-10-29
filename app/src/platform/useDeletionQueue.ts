import { useEffect } from "react";
import { useResults } from "../results/results";
import { PlatformError } from "./api";
import { isSignedIn, platformClient, usePlatformSettings } from "./settings";
import { runPlatformDeletes } from "./upload";

/** Forgets the sign-in when the platform says so (401). */
function signedOut(e: unknown) {
  if (e instanceof PlatformError && e.status === 401) usePlatformSettings.getState().update({ token: "" });
}

/**
 * Runs the queue of platform deletions when signed in and online: right after a sign-in, at app start
 * and when deletions are queued. Independent of the auto-upload setting (uploads still follow it, #48).
 * Also reads the athlete profiles the user claimed (`claimedAthleteIds`), so that a profile deleted on
 * this phone is removed with the self-delete.
 */
export function useDeletionQueue() {
  const token = usePlatformSettings((s) => s.token);
  const baseUrl = usePlatformSettings((s) => s.baseUrl);
  const loaded = useResults((s) => s.loaded);
  const queued = useResults((s) => s.platformDeletes.length);

  useEffect(() => {
    if (!loaded) return;
    const s = usePlatformSettings.getState();
    if (!isSignedIn(s)) return;
    const runQueue = () => {
      if (navigator.onLine === false) return;
      const current = usePlatformSettings.getState();
      if (!isSignedIn(current)) return;
      const client = platformClient(current);
      void runPlatformDeletes(client).then((outcome) => {
        if (outcome.unauthorized) usePlatformSettings.getState().update({ token: "" });
      });
    };
    runQueue();
    const onOnline = () => runQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // a sign-in changes the token; the queue is read again then
  }, [token, baseUrl, loaded, queued]);

  useEffect(() => {
    if (!loaded) return;
    const s = usePlatformSettings.getState();
    if (!isSignedIn(s) || navigator.onLine === false) return;
    let live = true;
    platformClient(s)
      .me()
      .then((me) => {
        if (live && me.athleteProfiles) usePlatformSettings.getState().update({ claimedAthleteIds: me.athleteProfiles.map((p) => p.athleteId) });
      })
      .catch(signedOut);
    return () => {
      live = false;
    };
  }, [token, baseUrl, loaded]);
}
