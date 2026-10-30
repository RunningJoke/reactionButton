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

  it("offers Continue, Repeat, Stop and the editable values while a communicate block waits", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5); // the game waits at the report block
    renderPage();
    const card = screen.getByRole("article");
    await waitFor(() => expect(within(card).getByText("Waiting for you")).toBeTruthy());
    expect(within(card).getByRole("button", { name: /Continue/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Repeat/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Stop/ })).toBeTruthy();

    const input = within(card).getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("12");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(within(card).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(pod.variables.get("MAX_LOOPS")).toBe(20));

    // the buttons are disabled while the last request runs
    const cont = within(card).getByRole("button", { name: /Continue/ }) as HTMLButtonElement;
    await waitFor(() => expect(cont.disabled).toBe(false));
    fireEvent.click(cont);
    await waitFor(() => expect(within(card).queryByText("Waiting for you")).toBeNull());
  });

  it("refuses a value outside the range without sending it", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitSampleReport(() => 0.5);
    renderPage();
    const card = screen.getByRole("article");
    const input = await waitFor(() => within(card).getByRole("spinbutton") as HTMLInputElement);
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(within(card).getByRole("button", { name: "Set" }));
    expect(within(card).getByRole("alert").textContent).toContain("1 to 50");
    expect(pod.variables.get("MAX_LOOPS")).toBe(12);
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
    const input = (await waitFor(() => within(card).getByRole("spinbutton"))) as HTMLInputElement;
    expect(input.value).toBe("12");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(within(card).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(pod.state).toBe("RUN"));
    expect(pod.variables.get("MAX_LOOPS")).toBe(20);
  });

  it("refuses a start value outside the range and sends nothing", async () => {
    await connectPod("simulated");
    const pod = podOf(0);
    pod.emitReady();
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.change(await waitFor(() => within(card).getByRole("spinbutton")), { target: { value: "99" } });
    fireEvent.click(within(card).getByRole("button", { name: "Start" }));
    expect(within(card).getByRole("alert").textContent).toContain("1 to 50");
    expect(pod.state).toBe("CONFIRM");
  });

  it("without startVars (firmware before 2.17) there are no steppers and Start sends only start", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, firmware: "2.16" });
    await connectPod("simulated", { transport: new SimulatedTransport(pod) });
    pod.state = "CONFIRM";
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    expect(within(card).queryByRole("spinbutton")).toBeNull();
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: "Start" })));
    await waitFor(() => expect(pod.state).toBe("RUN"));
  });

  it("without remote the start card says to press the central", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES, programFormat: 4 });
    await connectPod("simulated", { transport: new SimulatedTransport(pod) });
    pod.state = "CONFIRM";
    await refresh();
    renderPage();
    const card = screen.getByRole("article");
    expect(within(card).getByText("Press the central to start.")).toBeTruthy();
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

  it("shows the last and the average value of the main metric in large figures", async () => {
    await connectPod("simulated");
    podOf(0).emitSampleReport(() => 0.5); // all reactions 350 ms
    renderPage();
    const card = screen.getByRole("article");
    fireEvent.click(await waitFor(() => within(card).getByRole("button", { name: /Big numbers/ })));
    expect(card.textContent).toContain("Average");
    expect(card.textContent).toContain("350");
  });

  it("has a text for every error code the app can show", () => {
    for (const code of ERROR_CODES) expect(i18n.t(`training.errors.${code}`), code).not.toBe(`training.errors.${code}`);
  });
});
