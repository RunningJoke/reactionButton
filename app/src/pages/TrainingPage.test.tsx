// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "../i18n";
import { DEFAULT_FILES } from "../defaults";
import { MemoryResultStorage } from "../results/resultStore";
import { useResults } from "../results/results";
import { SimulatedPod } from "../pod/simulated/SimulatedPod";
import { SimulatedTransport } from "../pod/simulated/SimulatedTransport";
import { connectPod, disconnectPod, usePodSessions } from "../pod/session";
import { TrainingPage } from "./TrainingPage";

async function endAll() {
  for (const entry of usePodSessions.getState().entries) await entry.store.getState().disconnect();
  usePodSessions.setState({ entries: [], activeId: null });
}

/** The demo pod behind a session (a SimulatedTransport). */
function podOf(index: number): SimulatedPod {
  const entry = usePodSessions.getState().entries[index]!;
  return (entry.store.getState().client!.transport as SimulatedTransport).pod;
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

  it("shows one card per connected set, with the demo sets side by side", async () => {
    await connectPod("simulated");
    await connectPod("simulated");
    renderPage();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[1]!).getByRole("heading", { name: "Halle 2" })).toBeTruthy();
    // the last connected set is the active one (the Pod tab shows it)
    expect(within(cards[1]!).getByText("Active")).toBeTruthy();
    expect(within(cards[0]!).queryByText("Active")).toBeNull();
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

    fireEvent.click(within(card).getByRole("button", { name: /Continue/ }));
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

  it("removes a set from the view when it is disconnected", async () => {
    await connectPod("simulated");
    await connectPod("simulated");
    const first = usePodSessions.getState().entries[0]!.id;
    renderPage();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await disconnectPod(first);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
  });

  it("explains an old firmware without the reports feature", async () => {
    const oldPod = new SimulatedPod({ files: DEFAULT_FILES, programFormat: 2 });
    await connectPod("simulated", { transport: new SimulatedTransport(oldPod) });
    renderPage();
    expect(screen.getByText(/cannot send results yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
  });
});
