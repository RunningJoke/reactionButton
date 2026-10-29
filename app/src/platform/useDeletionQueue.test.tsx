// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryResultStorage } from "../results/resultStore";
import { useResults } from "../results/results";
import { usePlatformSettings } from "./settings";
import { useDeletionQueue } from "./useDeletionQueue";

const ORG = "0199f0c4-0000-7000-8000-000000000001";
const ATHLETE = "0199f0c4-0000-7000-8000-0000000000a1";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** Records every request; GET /v1/me answers the claimed profile, DELETE and POST with ok. */
function stubPlatform() {
  const calls: { method: string; url: string }[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: input });
    if (input.endsWith("/v1/me")) return json({ id: "u1", email: "mia@example.org", locale: "en", athleteProfiles: [{ athleteId: ATHLETE, orgId: ORG, name: "Mia" }] });
    return json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

beforeEach(() => {
  useResults.setState({
    loaded: true,
    athletes: [],
    sessions: [],
    reports: [],
    sets: {},
    deletedAthletes: [],
    platformDeletes: [{ id: "m1", kind: "myAthlete", orgId: ORG, platformId: ATHLETE }],
    storage: new MemoryResultStorage(true),
    durable: true,
  });
  usePlatformSettings.setState({ baseUrl: "https://api.example.org", token: "", orgId: ORG, autoUpload: false, claimedAthleteIds: undefined });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("deletion queue on sign-in", () => {
  it("does nothing while signed out", async () => {
    const calls = stubPlatform();
    renderHook(() => useDeletionQueue());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
    expect(useResults.getState().platformDeletes).toHaveLength(1);
  });

  it("runs the queued deletions right after sign-in, with auto upload switched off, and reads the claimed profiles", async () => {
    const calls = stubPlatform();
    renderHook(() => useDeletionQueue());
    expect(calls).toEqual([]);

    usePlatformSettings.setState({ token: "tok" }); // what the sign-in page does
    await waitFor(() => expect(useResults.getState().platformDeletes).toEqual([]));
    expect(calls).toContainEqual({ method: "DELETE", url: `https://api.example.org/v1/orgs/${ORG}/me/athletes/${ATHLETE}` });
    expect(calls.some((c) => c.method === "POST")).toBe(false); // uploads follow the auto-upload setting
    await waitFor(() => expect(usePlatformSettings.getState().claimedAthleteIds).toEqual([ATHLETE]));
  });

  it("runs the queue at app start when already signed in", async () => {
    const calls = stubPlatform();
    usePlatformSettings.setState({ token: "tok" });
    renderHook(() => useDeletionQueue());
    await waitFor(() => expect(useResults.getState().platformDeletes).toEqual([]));
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });
});
