// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "../i18n";
import { DEFAULT_FILES } from "../defaults";
import { MemoryResultStorage } from "../results/resultStore";
import { useResults } from "../results/results";
import { PodError } from "../pod/protocol";
import { SimulatedPod } from "../pod/simulated/SimulatedPod";
import { SimulatedTransport } from "../pod/simulated/SimulatedTransport";
import { connectPod, disconnectPod, usePodSessions } from "../pod/session";
import { ERROR_CODES, TrainingPage } from "./TrainingPage";

async function endAll() {
  for (const entry of usePodSessions.getState().entries) await entry.store.getState().disconnect();
  usePodSessions.setState({ entries: [], activeId: null });
}

/** The demo pod behind a session (a SimulatedTransport). */
function podOf(index: number): SimulatedPod {
  const entry = usePodSessions.getState().entries[index]!;
  return (entry.store.getState().client!.transport as SimulatedTransport).pod;
}

/** Reads the status of the first set again (the demo pod changes its state without an event here). */
async function refresh() {
  await usePodSessions.getState().entries[0]!.store.getState().refreshStatus();
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TrainingPage />
    </MemoryRouter>,
  );
}

describe("training view", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    await endAll();
    useResults.setState({ loaded: false, athletes: [], sessions: [], reports: [], sets: {}, storage: new MemoryResultStorage(true), durable: true });
  });
  afterEach(async () => {
    cleanup();
    await endAll();
  });

  it("shows a card for the connected set; a new connection replaces it", async () => {
    await connectPod("simulated");
    renderPage();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await connectPod("simulated");
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    // no way to add a second set from the view (several sets at once are on hold)
    expect(screen.queryByRole("button", { name: /add a set/i })).toBeNull();
  });

  it("offers Continue, Repeat, Stop and Pause, and applies changed values together with Continue", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5); // the game waits at the report block
    renderPage();
    const card = screen.getByRole("article");
    await waitFor(() => expect(within(card).getByText("Waiting for you")).toBeTruthy());
    expect(within(card).getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Repeat/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Pause/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Stop/ })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Disconnect/ })).toBeNull();

    // the stepper changes the draft only; nothing is sent yet
    expect(within(card).getByText("12", { selector: "output" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "More: Rounds" }));
    fireEvent.click(within(card).getByRole("button", { name: "More: Rounds" }));
    expect(within(card).getByText("14", { selector: "output" })).toBeTruthy();
    expect(within(card).getByText("Changed – applied with Continue")).toBeTruthy();
    expect(pod.variables.get("MAX_LOOPS")).toBe(12);

    fireEvent.click(within(card).getByRole("button", { name: "Continue with these values" }));
    await waitFor(() => expect(pod.variables.get("MAX_LOOPS")).toBe(14));
    await waitFor(() => expect(within(card).queryByText("Waiting for you")).toBeNull());
  });

  it("stops the stepper at the range", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5);
    renderPage();
    const card = screen.getByRole("article");
    const more = await waitFor(() => within(card).getByRole("button", { name: "More: Rounds" }) as HTMLButtonElement);
    for (let i = 0; i < 60; i++) if (!more.disabled) fireEvent.click(more);
    expect(within(card).getByText("50", { selector: "output" })).toBeTruthy();
    expect(more.disabled).toBe(true);
    expect(pod.variables.get("MAX_LOOPS")).toBe(12);
  });

  it("changes the controls with the state: nothing in the menu, Start when ready, Resume when paused", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    renderPage();
    const card = screen.getByRole("article");
    expect(within(card).queryByRole("button", { name: /Continue|Start|Resume|Stop/ })).toBeNull();
    expect(within(card).getByText("No game is running. Pick one in the pod menu.")).toBeTruthy();

    pod.emitReady();
    await refresh();
    await waitFor(() => expect(within(card).getByRole("button", { name: "Start" })).toBeTruthy());
    expect(within(card).queryByRole("button", { name: /Repeat|Stop/ })).toBeNull();

    pod.state = "RUN";
    await refresh();
    await waitFor(() => expect(within(card).getByText("Round in progress – results appear here")).toBeTruthy());
    expect(within(card).getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Stop/ })).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: /Pause/ }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Resume" })).toBeTruthy());
    expect(within(card).queryByRole("button", { name: /Repeat|Stop|Pause/ })).toBeNull();
  });

  it("pauses and resumes a running game with the pause feature", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5); // state RUN
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: /Pause/ })));
    await waitFor(() => expect(pod.state).toBe("PAUSED"));
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: /Resume/ })));
    await waitFor(() => expect(pod.state).toBe("RUN"));
  });

  it("removes the set from the view when it is disconnected", async () => {
    await connectPod("simulated");
    const id = usePodSessions.getState().entries[0]!.id;
    renderPage();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await disconnectPod(id);
    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
    expect(screen.getByRole("button", { name: "Connect a set" })).toBeTruthy();
  });

  it("explains an old firmware without the reports feature", async () => {
    const oldPod = new SimulatedPod({ files: DEFAULT_FILES, programFormat: 2 });
    await connectPod("simulated", { transport: new SimulatedTransport(oldPod) });
    renderPage();
    expect(screen.getByText(/cannot send results yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
  });

  it("starts from CONFIRM: changed start values first, then start", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitReady();
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: "More: Rounds" })));
    expect(within(card).getByText("Changed – applied with Start")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Start with these values" }));
    await waitFor(() => expect(pod.state).toBe("RUN"));
    expect(pod.variables.get("MAX_LOOPS")).toBe(13);
  });

  it("starts with the pod's values when nothing was changed", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitReady();
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: "Start" })));
    await waitFor(() => expect(pod.state).toBe("RUN"));
    expect(pod.variables.get("MAX_LOOPS")).toBe(12);
  });

  it("without startVars (firmware before 2.17) there are no steppers and Start sends only start", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, firmware: "2.16" });
    await connectPod("simulated", { transport: new SimulatedTransport(pod) });
    pod.state = "CONFIRM";
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    expect(within(card).queryByRole("button", { name: /Rounds/ })).toBeNull();
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: "Start" })));
    await waitFor(() => expect(pod.state).toBe("RUN"));
  });

  it("without remote the start card says to press the main pod", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, programFormat: 4 });
    await connectPod("simulated", { transport: new SimulatedTransport(pod) });
    pod.state = "CONFIRM";
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    expect(within(card).getByText("Press the main pod to start.")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("queues Continue while nothing waits and sends it when a block waits", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.state = "RUN";
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: /Continue/ })));
    await waitFor(() => expect(within(card).getByText("Queued: Continue")).toBeTruthy());
    expect(pod.waiting).toBeNull();
    pod.emitSampleReport(() => 0.5); // the block waits: the queued continue goes out
    await waitFor(() => expect(pod.waiting).toBeNull());
    await waitFor(() => expect(within(card).queryByText(/Queued:/)).toBeNull());
    expect(pod.state).toBe("RUN");
  });

  it("a newer queued press replaces the older one; Cancel removes it, nothing is sent", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.state = "RUN";
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: /Continue/ })));
    fireEvent.click(within(card).getByRole("button", { name: /Stop/ }));
    await waitFor(() => expect(within(card).getByText("Queued: Stop")).toBeTruthy());
    expect(within(card).queryByText(/Queued: Continue/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(card).queryByText(/Queued:/)).toBeNull());
    pod.emitSampleReport(() => 0.5);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pod.waiting).not.toBeNull();
    expect(pod.state).toBe("RUN");
  });

  it("does not show a timed-out command as failed; the card shows the real state", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5);
    const client = usePodSessions.getState().entries[0]!.store.getState().client!;
    const request = client.request.bind(client);
    vi.spyOn(client, "request").mockImplementation(((op: string, fields?: Record<string, unknown>) =>
      op === "command" ? Promise.reject(new PodError("timeout", "no response from the pod")) : request(op, fields)) as typeof client.request);
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: /Continue/ })));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(card).queryByRole("alert")).toBeNull();
    expect(within(card).queryByText("The pod did not answer.")).toBeNull();
    vi.restoreAllMocks();
  });

  it("shows best and average of the last round in large figures, with the change to the round before", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5); // all reactions 350 ms
    renderPage();
    const card = screen.getByRole("article");
    await waitFor(() => expect(card.textContent).toContain("Best"));
    expect(card.textContent).toContain("Average");
    expect(card.textContent).toContain("0.35 s");
    expect(within(card).getByRole("link", { name: /All rounds today/ })).toBeTruthy();
    pod.emitSampleReport(() => 0.9); // all reactions 438 ms
    await waitFor(() => expect(card.textContent).toContain("0.09 s slower than the round before"));
  });

  it("asks for an athlete until one is chosen; the chips pick and release", async () => {
    await connectPod("simulated");
    const mia = await useResults.getState().addAthlete("Mia");
    renderPage();
    const card = screen.getByRole("article");
    expect(within(card).getByText("Results are only saved for a named athlete.")).toBeTruthy();
    const chip = await waitFor(() => within(card).getByRole("button", { name: "Mia" }));
    expect(within(card).getByRole("button", { name: /Add athlete/ })).toBeTruthy();
    fireEvent.click(chip);
    await waitFor(() => expect(within(card).queryByText("Results are only saved for a named athlete.")).toBeNull());
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(podOf(0).athlete).toBe(mia.id);
    fireEvent.click(chip);
    await waitFor(() => expect(within(card).getByText("Results are only saved for a named athlete.")).toBeTruthy());
  });

  it("shows four athletes and the rest behind More", async () => {
    await connectPod("simulated");
    for (const name of ["A", "B", "C", "D", "E", "F"]) await useResults.getState().addAthlete(name);
    renderPage();
    const card = screen.getByRole("article");
    await waitFor(() => expect(within(card).getByRole("button", { name: "More (2)" })).toBeTruthy());
    expect(within(card).getAllByRole("button").filter((b) => /^[A-F]$/.test(b.textContent ?? ""))).toHaveLength(4);
    fireEvent.click(within(card).getByRole("button", { name: "More (2)" }));
    expect(within(card).getAllByRole("button").filter((b) => /^[A-F]$/.test(b.textContent ?? ""))).toHaveLength(6);
  });

  it("without a set it guides the connection in three steps and keeps the hint until dismissed", async () => {
    localStorage.removeItem("reactpod.hint.keepOpen");
    renderPage();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Connect a set" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(localStorage.getItem("reactpod.hint.keepOpen")).toBe("1");
    cleanup();
    renderPage();
    expect(screen.queryByRole("note")).toBeNull();
    localStorage.removeItem("reactpod.hint.keepOpen");
  });

  it("has a text for every error code the app can show", () => {
    for (const code of ERROR_CODES) expect(i18n.t(`training.errors.${code}`), code).not.toBe(`training.errors.${code}`);
  });
});
