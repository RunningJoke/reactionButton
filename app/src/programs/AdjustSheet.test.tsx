// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "../i18n";
import { DEFAULT_FILES } from "../defaults";
import { usePodSession } from "../pod/session";
import { MemoryStorage } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { AdjustSheet, type AdjustTarget } from "./AdjustSheet";

const STERN = "/prog/stern.json";
const POD_PROGRAM = { name: "Pod drill", peripherals: 1, variables: { MAX_LOOPS: 5, PAUSE_MS: 1000 }, include: ["/prog/lib/loop.json", "/prog/lib/star.json"], start: "StartLoop" };

function show(target: AdjustTarget, onClose = () => {}) {
  return render(
    <MemoryRouter>
      <AdjustSheet target={target} onClose={onClose} />
    </MemoryRouter>,
  );
}

function connectPod(role: "central" | "peripheral") {
  const files = { ...DEFAULT_FILES, "/prog/drill.json": JSON.stringify(POD_PROGRAM) };
  usePodSession.setState({ state: "connected", role, files, info: { programFormat: 2, setId: "set1" } as never, list: null });
}

describe("Adjust sheet", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useWorkspace.setState({ loaded: true, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
    usePodSession.setState({ state: "disconnected", role: null, files: {}, info: null, list: null });
  });
  afterEach(cleanup);

  it("changes a shipped program's rounds and saves them as a local copy with the same path", async () => {
    let closed = false;
    show({ source: "shipped", path: STERN }, () => (closed = true));
    expect(screen.getByText(/Saving makes your own copy/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Rounds" }).textContent).toContain("12");
    const save = screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    expect(screen.getByRole("group", { name: "Rounds" }).textContent).toContain("13");
    expect(screen.getByRole("button", { name: /Save and try/ })).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(closed).toBe(true));
    const [doc] = useWorkspace.getState().programs;
    expect(doc).toMatchObject({ path: STERN, origin: "default" });
    expect((doc!.json.variables as Record<string, number>).MAX_LOOPS).toBe(13);
    expect(DEFAULT_FILES[STERN]).toContain('"MAX_LOOPS": 12'); // the shipped file is unchanged
  });

  it("shows times in seconds and hides counters the program changes itself", () => {
    connectPod("central");
    show({ source: "pod", path: "/prog/drill.json" });
    expect(screen.getByText(/The program on the pod stays as it is until you push/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Pause" }).textContent).toContain("1 s");
    expect(screen.queryByRole("group", { name: "Round counter" })).toBeNull(); // RUNS from lib/loop
    expect(screen.queryByRole("group", { name: "Selected pod" })).toBeNull();
    expect(screen.queryByText(/not the central/)).toBeNull();
  });

  it("says before saving that a copy from a read-only pod stays on this phone", async () => {
    connectPod("peripheral");
    show({ source: "pod", path: "/prog/drill.json" });
    expect(screen.getByRole("note").textContent).toContain("It cannot be pushed to this pod");
    fireEvent.click(screen.getByRole("button", { name: "Less: Rounds" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(useWorkspace.getState().programs).toHaveLength(1));
    const [doc] = useWorkspace.getState().programs;
    expect(doc).toMatchObject({ path: "/prog/drill.json", origin: "pod" });
    expect((doc!.json.variables as Record<string, number>).MAX_LOOPS).toBe(4);
    // the pod's program is untouched
    expect(JSON.parse(usePodSession.getState().files["/prog/drill.json"]!).variables.MAX_LOOPS).toBe(5);
  });

  it("changes my existing copy instead of making another one", async () => {
    const mine = await useWorkspace.getState().add(JSON.parse(DEFAULT_FILES[STERN]!), "default", { path: STERN });
    show({ source: "shipped", path: STERN });
    expect(screen.getByText(/You already have a copy/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect((useWorkspace.getState().programs[0]!.json.variables as Record<string, number>).MAX_LOOPS).toBe(13));
    expect(useWorkspace.getState().programs.map((p) => p.id)).toEqual([mine.id]);
  });
});
